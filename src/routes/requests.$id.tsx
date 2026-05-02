import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, RotateCcw, FileText, Loader2, X, Mail, Send, Link2, MessageSquare, AlertTriangle, CheckCircle2 } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { StatusBadge } from "@/components/StatusBadge";
import { useLang } from "@/i18n/LanguageProvider";
import { isPdfDataUrl } from "@/lib/imageUtils";
import {
  getCurrentUser, refreshCurrentUser, getRequest, updateRequestStatus, resolveAssetUrl,
  addRequestNote, resolveRequestNote, subscribeRequests,
  type AuthUser, type InsuranceRequest, type RequestStatus, type RequestNoteKind,
} from "@/services/api";

export const Route = createFileRoute("/requests/$id")({
  component: RequestDetails,
});

type SavingAction = "quote" | "sold" | "reupload" | "linkSent" | "select" | null;

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /:([^;]+);/.exec(meta)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function RequestDetails() {
  const { t, dir, lang } = useLang();
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const [req, setReq] = useState<InsuranceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<SavingAction>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [zoomMime, setZoomMime] = useState<string>("");
  const [zoomFilename, setZoomFilename] = useState<string>("file");
  const [zipping, setZipping] = useState(false);

  // Read role once on mount; avoids re-running auth checks every render.
  const [user] = useState<AuthUser | null>(() => getCurrentUser());
  const role = user?.role ?? "agent";

  useEffect(() => {
    if (!user) { navigate({ to: "/login" }); return; }
    refreshCurrentUser().then((fresh) => {
      if (!fresh) navigate({ to: "/login" });
    });
    let alive = true;
    const refreshRequest = () => {
      getRequest(id).then((r) => { if (alive) { setReq(r); setLoading(false); } });
    };
    refreshRequest();
    const unsubscribe = subscribeRequests(refreshRequest);
    return () => { alive = false; unsubscribe(); };
    // run once per id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const setStatus = async (s: RequestStatus, action: SavingAction) => {
    if (!req || savingAction) return;
    if (req.status === s) return; // no-op guard
    const previous = req.status;
    setReq({ ...req, status: s }); // optimistic
    setSavingAction(action);
    try {
      const updated = await updateRequestStatus(req.id, s);
      setReq(updated);
      toast.success(t.common.statusUpdatedSuccess);
    } catch {
      setReq({ ...req, status: previous });
      toast.error(t.common.statusUpdateFailed);
    } finally {
      setSavingAction(null);
    }
  };

  const saving = savingAction !== null;
  void role;

  // Build a flat list of all assets for ZIP download.
  const allAssets = useMemo(() => {
    if (!req) return [] as { url: string; baseName: string }[];
    const list: { url: string; baseName: string }[] = [];
    (req.images.registration ?? []).forEach((u, i) =>
      list.push({ url: u, baseName: i === 0 ? "registration_front" : i === 1 ? "registration_back" : `registration_${i + 1}` }),
    );
    (req.images.license ?? []).forEach((u, i) =>
      list.push({ url: u, baseName: i === 0 ? "license_front" : i === 1 ? "license_back" : `license_${i + 1}` }),
    );
    (req.images.emirates ?? []).forEach((u, i) =>
      list.push({ url: u, baseName: i === 0 ? "emirates_front" : i === 1 ? "emirates_back" : `emirates_${i + 1}` }),
    );
    if (req.images.inspection) list.push({ url: req.images.inspection, baseName: "inspection" });
    (req.images.vehicleMedia ?? []).forEach((m, i) => {
      if (m.kind === "image") list.push({ url: m.url, baseName: `vehicle_${i + 1}` });
    });
    return list;
  }, [req]);

  const buildZipBlob = async (): Promise<Blob | null> => {
    if (!req) return null;
    const zip = new JSZip();
    for (const a of allAssets) {
      const { url, mime } = await resolveAssetUrl(a.url);
      if (!url) continue;
      let blob: Blob;
      if (url.startsWith("data:")) {
        blob = dataUrlToBlob(url);
      } else if (url.startsWith("blob:") || url.startsWith("http")) {
        blob = await (await fetch(url)).blob();
      } else {
        continue;
      }
      const ext = extFromMime(mime || blob.type);
      zip.file(`${a.baseName}.${ext}`, blob);
    }
    return await zip.generateAsync({ type: "blob" });
  };

  const downloadAllZip = async () => {
    if (!req || zipping) return;
    setZipping(true);
    try {
      const out = await buildZipBlob();
      if (!out) return;
      triggerDownload(out, `${req.id}.zip`);
      toast.success(t.details.downloadStarted);
    } catch {
      toast.error(t.details.downloadFailed);
    } finally {
      setZipping(false);
    }
  };

  const [sharing, setSharing] = useState(false);
  const shareByEmail = async () => {
    if (!req || sharing) return;
    setSharing(true);
    try {
      const subject = `${t.details.shareEmailSubject} — ${req.id}`;
      const body = `${t.details.shareEmailBody}\n\n${t.table.agent}: ${req.agentName}\n${t.table.branch}: ${req.branch}\n${t.details.title}: ${req.id}`;
      const to = req.customerEmail ?? "";
      const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailto;
    } catch {
      toast.error(t.details.downloadFailed);
    } finally {
      setSharing(false);
    }
  };

  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const backTo = role === "agent" ? "/agent" : "/admin";

  return (
    <DashboardShell role={["admin", "supervisor", "agent"]} title={t.details.title}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          <Back className="h-4 w-4" />
          {t.details.back}
        </Link>
        {req && (
          <div className="flex flex-wrap items-center gap-2">
            {allAssets.length > 0 && (
              <>
                <button
                  onClick={shareByEmail}
                  disabled={sharing || zipping}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground shadow-soft transition hover:bg-muted active:scale-95 disabled:opacity-60"
                >
                  {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {t.details.shareEmail}
                </button>
                <button
                  onClick={downloadAllZip}
                  disabled={zipping || sharing}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-soft transition active:scale-95 disabled:opacity-60"
                >
                  {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {t.details.downloadAll}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {loading || !req ? (
        <p className="py-12 text-center text-muted-foreground">…</p>
      ) : (
        <div className="animate-fade-in">
          {/* Top info */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-bold text-foreground">{req.id}</h2>
                  <StatusBadge status={req.status} />
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-3">
                  <div><span className="font-medium text-foreground">{t.table.agent}:</span> {req.agentName}</div>
                  <div><span className="font-medium text-foreground">{t.table.branch}:</span> {req.branch}</div>
                  <div><span className="font-medium text-foreground">{t.table.date}:</span>{" "}
                    {new Date(req.createdAt).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
                      dateStyle: "medium", timeStyle: "short",
                    })}
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{t.details.changeStatus}</span>
                <span className="relative">
                  <select
                    value={req.status}
                    onChange={(e) => setStatus(e.target.value as RequestStatus, "select")}
                    disabled={saving}
                    className="h-10 rounded-xl border border-input bg-surface px-3 pe-9 text-sm font-medium text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {(["new", "processing", "sold", "rejected", "reupload"] as RequestStatus[]).map((s) => (
                      <option key={s} value={s}>{t.status[s]}</option>
                    ))}
                  </select>
                  {savingAction === "select" && (
                    <Loader2 className="pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </span>
              </label>
            </div>
          </div>

          {/* Customer KYC */}
          {(req.customerName || req.customerEmail || req.customerPhone) && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-card">
              <h3 className="mb-3 text-sm font-bold text-foreground">{t.details.customer}</h3>
              <div className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
                {req.customerName && (
                  <div><span className="font-medium text-foreground">{t.details.customerName}:</span> {req.customerName}</div>
                )}
                {req.customerEmail && (
                  <div dir="ltr" className="truncate"><span className="font-medium text-foreground">{t.details.customerEmail}:</span> {req.customerEmail}</div>
                )}
                {req.customerPhone && (
                  <div dir="ltr" className="truncate"><span className="font-medium text-foreground">{t.details.customerPhone}:</span> {req.customerPhone}</div>
                )}
              </div>
            </div>
          )}

          {/* Image cards: registration (front + back), license, emirates (front + back) */}
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {(req.images.registration ?? []).map((url, i) => (
              <ImgCard
                key={`reg-${i}`}
                label={i === 0 ? t.details.registrationFront : i === 1 ? t.details.registrationBack : `${t.details.registration} ${i + 1}`}
                baseName={i === 0 ? "registration_front" : i === 1 ? "registration_back" : `registration_${i + 1}`}
                url={url}
                onZoom={(u, m, n) => { setZoom(u); setZoomMime(m); setZoomFilename(n); }}
                pdfLabel={t.details.pdfDocument}
                downloadLabel={t.details.download}
              />
            ))}
            {(req.images.license ?? []).map((url, i) => (
              <ImgCard
                key={`lic-${i}`}
                label={i === 0 ? t.details.licenseFront : i === 1 ? t.details.licenseBack : `${t.details.license} ${i + 1}`}
                baseName={i === 0 ? "license_front" : i === 1 ? "license_back" : `license_${i + 1}`}
                url={url}
                onZoom={(u, m, n) => { setZoom(u); setZoomMime(m); setZoomFilename(n); }}
                pdfLabel={t.details.pdfDocument}
                downloadLabel={t.details.download}
              />
            ))}
            {(req.images.emirates ?? []).map((url, i) => (
              <ImgCard
                key={`eid-${i}`}
                label={i === 0 ? t.details.emiratesFront : i === 1 ? t.details.emiratesBack : `${t.details.emirates} ${i + 1}`}
                baseName={i === 0 ? "emirates_front" : i === 1 ? "emirates_back" : `emirates_${i + 1}`}
                url={url}
                onZoom={(u, m, n) => { setZoom(u); setZoomMime(m); setZoomFilename(n); }}
                pdfLabel={t.details.pdfDocument}
                downloadLabel={t.details.download}
              />
            ))}
          </div>

          {/* Optional: vehicle inspection */}
          {req.images.inspection && (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <ImgCard label={t.details.inspection} baseName="inspection" url={req.images.inspection} onZoom={(u, m, n) => { setZoom(u); setZoomMime(m); setZoomFilename(n); }} pdfLabel={t.details.pdfDocument} downloadLabel={t.details.download} />
            </div>
          )}

          {/* Vehicle media: photos + video metadata */}
          {req.images.vehicleMedia && req.images.vehicleMedia.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-bold text-foreground">{t.details.vehiclePhotos}</h3>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                {req.images.vehicleMedia.map((m, idx) => {
                  if (m.kind === "image") {
                    return (
                      <ImgCard
                        key={idx}
                        label={`${t.details.vehiclePhotos} ${idx + 1}`}
                        baseName={`vehicle_${idx + 1}`}
                        url={m.url}
                        onZoom={(u, mm, n) => { setZoom(u); setZoomMime(mm); setZoomFilename(n); }}
                        pdfLabel={t.details.pdfDocument}
                        downloadLabel={t.details.download}
                      />
                    );
                  }
                  return (
                    <div
                      key={idx}
                      className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4 shadow-card"
                    >
                      <span className="text-xs font-semibold text-muted-foreground">{t.details.vehicleVideo}</span>
                      <span className="truncate text-sm font-medium text-foreground" title={m.name}>{m.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {(m.size / (1024 * 1024)).toFixed(1)} MB · {m.type || "video"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Missing docs uploaded by the customer (separate from agent's attachments) */}
          {req.images.missingAttachments && req.images.missingAttachments.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                <span className="inline-flex h-5 items-center rounded-full bg-warning/20 px-2 text-[11px] font-semibold text-warning-foreground">
                  {t.details.noteKindMissing}
                </span>
                {t.details.missingAttachments}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {req.images.missingAttachments.map((a, idx) => (
                  <a
                    key={idx}
                    href={a.url}
                    download={a.name}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3 shadow-soft transition hover:bg-warning/10"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning-foreground">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground" title={a.name}>{a.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {(a.size / 1024).toFixed(0)} KB · {a.type || "file"}
                      </div>
                    </div>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Other attachments */}
          {req.images.attachments && req.images.attachments.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-bold text-foreground">{t.details.attachments}</h3>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {req.images.attachments.map((a, idx) => (
                  <a
                    key={idx}
                    href={a.url}
                    download={a.name}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-soft transition hover:bg-muted"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground" title={a.name}>{a.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {(a.size / 1024).toFixed(0)} KB · {a.type || "file"}
                      </div>
                    </div>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Notes & missing items (copy link button is inside the section header) */}
          <NotesSection
            req={req}
            onUpdated={(r) => setReq(r)}
          />

          {/* Actions */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              onClick={() => setStatus("linkSent", "linkSent")}
              disabled={saving}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm font-semibold text-foreground shadow-soft transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingAction === "linkSent" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t.details.markLinkSent}
            </button>
            <button
              onClick={() => setStatus("processing", "quote")}
              disabled={saving}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingAction === "quote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {t.details.createQuote}
            </button>
            <button
              onClick={() => setStatus("sold", "sold")}
              disabled={saving}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-success text-sm font-semibold text-success-foreground shadow-soft transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingAction === "sold" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t.details.markSold}
            </button>
            <button
              onClick={() => setStatus("reupload", "reupload")}
              disabled={saving}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-purple text-sm font-semibold text-purple-foreground shadow-soft transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingAction === "reupload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {t.details.reupload}
            </button>
          </div>
        </div>
      )}

      {/* Zoom modal */}
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-foreground/85 p-4"
          onClick={() => { setZoom(null); setZoomMime(""); }}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                try {
                  let blob: Blob;
                  if (zoom.startsWith("data:")) blob = dataUrlToBlob(zoom);
                  else { window.open(zoom, "_blank"); return; }
                  const ext = extFromMime(zoomMime || blob.type);
                  triggerDownload(blob, `${zoomFilename}.${ext}`);
                } catch { toast.error(t.details.downloadFailed); }
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-sm font-semibold text-foreground shadow-soft transition hover:bg-muted"
            >
              <Download className="h-4 w-4" />
              {t.details.download}
            </button>
            <button
              onClick={() => { setZoom(null); setZoomMime(""); }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface text-foreground shadow-soft transition hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {isPdfDataUrl(zoom) || zoomMime === "application/pdf" ? (
            <iframe
              src={zoom}
              title="PDF"
              className="h-[90vh] w-full max-w-4xl animate-scale-in rounded-xl bg-white"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={zoom}
              alt="Zoom"
              className="max-h-[90vh] max-w-full animate-scale-in rounded-xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </DashboardShell>
  );
}

/**
 * Resolves a stored asset reference to a renderable URL. For Directus assets,
 * fetches the binary with an Authorization header and returns a `blob:` URL
 * so the bearer token never appears in the URL bar, server logs or Referer.
 */
function useAssetUrl(url: string): { src: string; mime: string; loading: boolean } {
  const [src, setSrc] = useState<string>("");
  const [mime, setMime] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) { setSrc(""); setMime(""); return; }
    if (!url.startsWith("storage:")) {
      setSrc(url);
      setMime(url.startsWith("data:application/pdf") ? "application/pdf" : "");
      return;
    }
    setLoading(true);
    resolveAssetUrl(url)
      .then((res) => { setSrc(res.url); setMime(res.mime); })
      .finally(() => setLoading(false));
  }, [url]);

  return { src, mime, loading };
}

function ImgCard({
  label, baseName, url, onZoom, pdfLabel, downloadLabel,
}: {
  label: string; baseName: string; url: string;
  onZoom: (u: string, mime: string, filename: string) => void;
  pdfLabel: string; downloadLabel: string;
}) {
  const { src, mime, loading } = useAssetUrl(url);
  const pdf = isPdfDataUrl(src) || mime === "application/pdf";
  const onDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!src) return;
    try {
      let blob: Blob;
      if (src.startsWith("data:")) blob = dataUrlToBlob(src);
      else { window.open(src, "_blank"); return; }
      const ext = extFromMime(mime || blob.type);
      triggerDownload(blob, `${baseName}.${ext}`);
    } catch { /* noop */ }
  };
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-border bg-card text-start shadow-card transition hover:shadow-elevated"
    >
      <button
        type="button"
        onClick={() => src && onZoom(src, mime, baseName)}
        className="block w-full text-start active:scale-[0.99]"
      >
        <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
          {pdf ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-primary-soft/40 text-primary">
              <FileText className="h-12 w-12" />
              <span className="text-xs font-semibold">{pdfLabel}</span>
            </div>
          ) : src ? (
            <img src={src} alt={label} className="h-full w-full object-cover transition group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              {loading ? "…" : "—"}
            </div>
          )}
        </div>
        <div className="px-4 py-3">
          <div className="text-sm font-semibold text-foreground">{label}</div>
        </div>
      </button>
      {src && (
        <button
          type="button"
          onClick={onDownload}
          aria-label={downloadLabel}
          title={downloadLabel}
          className="absolute top-2 end-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface/95 text-foreground shadow-soft transition hover:bg-muted active:scale-95"
        >
          <Download className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function NotesSection({
  req,
  onUpdated,
}: {
  req: InsuranceRequest;
  onUpdated: (r: InsuranceRequest) => void;
}) {
  const { t, lang } = useLang();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<RequestNoteKind>("comment");
  const [busy, setBusy] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const me = getCurrentUser();
  const canResolve = me?.role === "admin" || me?.role === "supervisor" || me?.role === "agent";

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const updated = await addRequestNote(req.id, { text: trimmed, kind });
      onUpdated(updated);
      setText("");
      toast.success(
        kind === "missing"
          ? (lang === "ar" ? "تم تسجيل النقص" : "Missing item recorded")
          : (lang === "ar" ? "تمت إضافة الكومنت" : "Comment added"),
      );
    } catch (e) {
      console.error(e);
      toast.error(lang === "ar" ? "تعذر حفظ الملاحظة، حاول مرة أخرى" : "Could not save the note, please try again");
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (noteId: string) => {
    setResolvingId(noteId);
    try {
      const updated = await resolveRequestNote(req.id, noteId);
      onUpdated(updated);
    } catch {
      toast.error(lang === "ar" ? "تعذر تحديث الملاحظة" : "Could not update the note");
    } finally {
      setResolvingId(null);
    }
  };

  const copyReuploadLink = async () => {
    const url = `${window.location.origin}/r/${encodeURIComponent(req.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t.details.reuploadLinkCopied);
    } catch {
      window.prompt(t.details.copyReuploadLink, url);
    }
  };

  const notes = req.notes ?? [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    });

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">{t.details.notesTitle}</h3>
        </div>
        <button
          onClick={copyReuploadLink}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground shadow-soft transition hover:bg-muted active:scale-95"
        >
          <Link2 className="h-3.5 w-3.5" />
          {t.details.copyReuploadLink}
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.details.notesEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const isMissing = n.kind === "missing";
            const resolved = !!n.resolvedAt;
            return (
              <li
                key={n.id}
                className={`rounded-xl border p-3 text-sm ${
                  isMissing && !resolved
                    ? "border-warning/30 bg-warning/10"
                    : resolved
                      ? "border-success/30 bg-success/5"
                      : "border-border bg-muted/40"
                }`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                    isMissing ? "bg-warning/20 text-warning-foreground" : "bg-primary/10 text-primary"
                  }`}>
                    {isMissing ? <AlertTriangle className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                    {isMissing ? t.details.noteKindMissing : t.details.noteKindComment}
                  </span>
                  <span className="text-foreground">{n.authorName}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{fmt(n.createdAt)}</span>
                  {resolved && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-success">
                      <CheckCircle2 className="h-3 w-3" />
                      {t.details.noteResolved}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-foreground">{n.text}</p>
                {isMissing && !resolved && canResolve && (
                  <button
                    onClick={() => resolve(n.id)}
                    disabled={resolvingId === n.id}
                    className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline disabled:opacity-60"
                  >
                    {resolvingId === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    {t.details.noteResolve}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setKind("comment")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
              kind === "comment"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            <MessageSquare className="h-3 w-3" />
            {t.details.noteAdd}
          </button>
          <button
            type="button"
            onClick={() => setKind("missing")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
              kind === "missing"
                ? "bg-warning text-warning-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            <AlertTriangle className="h-3 w-3" />
            {t.details.missingAdd}
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={kind === "missing" ? t.details.missingPlaceholder : t.details.notePlaceholder}
          className="w-full rounded-xl border border-input bg-surface p-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <div className="flex justify-end">
          <button
            onClick={submit}
            disabled={!text.trim() || busy}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-soft transition active:scale-95 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {kind === "missing" ? t.details.missingAdd : t.details.noteAdd}
          </button>
        </div>
      </div>
    </section>
  );
}
