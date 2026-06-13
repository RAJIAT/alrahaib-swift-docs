import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, RotateCcw, FileText, Loader2, X, Mail, Send, Link2, MessageSquare, AlertTriangle, CheckCircle2, Upload, Trash2, ExternalLink, Copy } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { StatusBadge } from "@/components/StatusBadge";
import { useLang } from "@/i18n/LanguageProvider";
import { isPdfDataUrl } from "@/lib/imageUtils";
import { copyToClipboard, safeMessage } from "@/lib/utils";
import {
  getCurrentUser, refreshCurrentUser, getRequest, updateRequestStatus, resolveAssetUrl,
  addRequestNote, resolveRequestNote, subscribeRequests,
  reassignRequest, listAgents, getAgents, addQuotesToRequest, removeQuoteFromRequest,
  type AuthUser, type InsuranceRequest, type RequestStatus, type RequestNoteKind, type Agent,
} from "@/services/api";
import { isDirectusAssetUrl } from "@/services/directus";
import { RequestHistoryTimeline } from "@/components/RequestHistoryTimeline";

// Build a stable signature of the parts of the request that can change while
// an agent has the page open: notes count, missing-attachment count, status,
// and attachment count. Used to skip useless re-renders during polling.
function reqSignature(r: InsuranceRequest | null): string {
  if (!r) return "";
  const notes = r.notes?.length ?? 0;
  const registration = r.images.registration?.length ?? 0;
  const license = r.images.license?.length ?? 0;
  const emirates = r.images.emirates?.length ?? 0;
  const missing = r.images.missingAttachments?.length ?? 0;
  const atts = r.images.attachments?.length ?? 0;
  const veh = r.images.vehicleMedia?.length ?? 0;
  const quotes = r.quotes?.length ?? 0;
  const inspection = r.images.inspection ? 1 : 0;
  return `${r.status}|n${notes}|r${registration}|l${license}|e${emirates}|m${missing}|a${atts}|v${veh}|i${inspection}|q${quotes}`;
}

// Download a Directus asset using the bearer token, then trigger a save dialog.
// Falls back to opening the URL directly if it isn't a Directus asset.
async function downloadAsset(url: string, filename: string): Promise<void> {
  try {
    const { url: blobUrl, mime } = await resolveAssetUrl(url);
    if (!blobUrl) { window.open(url, "_blank"); return; }
    if (blobUrl.startsWith("blob:") || blobUrl.startsWith("data:")) {
      const blob = await (await fetch(blobUrl)).blob();
      const ext = extFromMime(mime || blob.type);
      const hasExt = /\.[A-Za-z0-9]{2,5}$/.test(filename);
      triggerDownload(blob, hasExt ? filename : `${filename}.${ext}`);
      if (blobUrl.startsWith("blob:")) {
        // tiny delay so the browser starts the download before we revoke
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      }
    } else {
      window.open(blobUrl, "_blank");
    }
  } catch {
    toast.error("تعذّر تنزيل الملف");
  }
}

export const Route = createFileRoute("/requests/$id")({
  component: RequestDetails,
});

type SavingAction = "quote" | "sold" | "reupload" | "linkSent" | "rejected" | "select" | null;

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
  const myStaffType = useMemo(() => {
    if (!user?.agentId) return undefined;
    return listAgents().find((a) => a.id === user.agentId)?.staffType;
  }, [user?.agentId]);
  const isUnderwriter = myStaffType === "underwriter";
  const isSalesAgent = myStaffType === "sales";
  // Sales agents track the request lifecycle too (Sold / Payment link sent /
  // Quote created / Reupload). Only the actual quote-file upload stays
  // underwriter-only (gated inside QuotesCard).
  const canChangeStatus =
    role === "admin" || role === "supervisor" || isUnderwriter || isSalesAgent;
  const canRunFinalActions =
    role === "admin" || role === "supervisor" || isUnderwriter || isSalesAgent;
  void isSalesAgent;

  useEffect(() => {
    if (!user) { navigate({ to: "/login" }); return; }
    refreshCurrentUser().then((fresh) => {
      if (!fresh) navigate({ to: "/login" });
    });
    let alive = true;
    let lastSig = "";
    let lastMissing = -1; // -1 = not yet known
    const refreshRequest = () => {
      getRequest(id).then((r) => {
        if (!alive || !r) { if (alive) setLoading(false); return; }
        const sig = reqSignature(r);
        if (sig !== lastSig) {
          // Notify the agent if the customer just uploaded missing items.
          const newMissing = r.images.missingAttachments?.length ?? 0;
          if (lastMissing >= 0 && newMissing > lastMissing) {
            const added = newMissing - lastMissing;
            toast.success(
              lang === "ar"
                ? `وصلت ${added} ${added === 1 ? "ملف" : "ملفات"} جديدة من العميل`
                : `${added} new file${added === 1 ? "" : "s"} from the customer`,
            );
          }
          lastMissing = newMissing;
          lastSig = sig;
          setReq(r);
        } else if (lastMissing < 0) {
          lastMissing = r.images.missingAttachments?.length ?? 0;
        }
        setLoading(false);
      }).catch(() => { if (alive) setLoading(false); });
    };
    refreshRequest();
    const unsubscribe = subscribeRequests(refreshRequest);

    // Cross-browser refresh: customer uploads happen in another browser, so
    // same-tab events never fire here. Poll every 4s while the tab is visible.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (intervalId === null) intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshRequest();
    }, 4000); };
    const stop = () => { if (intervalId !== null) { clearInterval(intervalId); intervalId = null; } };
    start();
    const onVis = () => { if (typeof document !== "undefined" && !document.hidden) refreshRequest(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      unsubscribe();
      stop();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    };
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
    } catch (err) {
      setReq({ ...req, status: previous });
      const raw = err instanceof Error ? err.message : String(err);
      console.error("updateRequestStatus failed", err);
      toast.error(`${t.common.statusUpdateFailed}: ${raw}`);
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
              {canChangeStatus && (
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
              )}
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
                  <MissingAttachmentCard
                    key={idx}
                    name={a.name}
                    sizeKb={a.size}
                    type={a.type}
                    url={a.url}
                    onZoom={(u, m, n) => { setZoom(u); setZoomMime(m); setZoomFilename(n); }}
                  />
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
                  <button
                    key={idx}
                    type="button"
                    onClick={() => downloadAsset(a.url, a.name)}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-start shadow-soft transition hover:bg-muted"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground" title={a.name}>{a.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {a.size > 0 ? `${(a.size / 1024).toFixed(0)} KB · ` : ""}{a.type || "file"}
                      </div>
                    </div>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes & missing items (copy link button is inside the section header) */}
          <NotesSection
            req={req}
            onUpdated={(r) => setReq(r)}
          />

          {/* Reassign — sales transfers to underwriters; underwriters can hand off to another underwriter or return to sales. */}
          <ReassignCard req={req} user={user} onReassigned={(r) => setReq(r)} />

          {/* Quotes (underwriter uploads, sales shares with customer) */}
          <QuotesCard req={req} user={user} onUpdated={(r: InsuranceRequest) => setReq(r)} />

          {/* Actions — admin/supervisor/underwriter only. Sales agents only
              view docs, add notes, and send-to-underwriter. */}
          {canRunFinalActions && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <button
                onClick={() => setStatus("processing", "quote")}
                disabled={saving}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAction === "quote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {t.details.markProcessing}
              </button>
              <button
                onClick={() => setStatus("linkSent", "linkSent")}
                disabled={saving}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm font-semibold text-foreground shadow-soft transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAction === "linkSent" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t.details.markLinkSent}
              </button>
              <button
                onClick={() => setStatus("reupload", "reupload")}
                disabled={saving}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-purple text-sm font-semibold text-purple-foreground shadow-soft transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAction === "reupload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {t.details.awaitingMissing}
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
                onClick={() => setStatus("rejected", "rejected")}
                disabled={saving}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground shadow-soft transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAction === "rejected" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                {t.details.markRejected}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Audit timeline — visible to everyone, raw JSON only for admins */}
      {req && (
        <div className="mt-4">
          <RequestHistoryTimeline requestId={req.id} showAdvanced={role === "admin"} />
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
    // Anything that needs an Authorization header to fetch (Directus assets
    // proxied through /api/directus/assets/<id> OR the legacy storage://
    // pointer used by the old localStorage demo) must go through
    // resolveAssetUrl, which fetches with the bearer and returns a blob: URL.
    if (url.startsWith("storage:") || isDirectusAssetUrl(url)) {
      let cancelled = false;
      let lastBlob = "";
      setLoading(true);
      resolveAssetUrl(url)
        .then((res) => {
          if (cancelled) {
            if (res.url.startsWith("blob:")) URL.revokeObjectURL(res.url);
            return;
          }
          lastBlob = res.url.startsWith("blob:") ? res.url : "";
          setSrc(res.url);
          setMime(res.mime);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => {
        cancelled = true;
        if (lastBlob) URL.revokeObjectURL(lastBlob);
      };
    }
    // data: URLs and plain http(s) URLs render directly.
    setSrc(url);
    setMime(url.startsWith("data:application/pdf") ? "application/pdf" : "");
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

/**
 * Card for a missing-document file uploaded by the customer through the
 * reupload link. Renders an inline thumbnail when the file is an image so
 * the agent can see it without downloading, and falls back to a file icon
 * for PDFs / other types. Always uses the bearer-aware download helper.
 */
function MissingAttachmentCard({
  name, sizeKb, type, url, onZoom,
}: {
  name: string;
  sizeKb: number;
  type: string;
  url: string;
  onZoom: (u: string, mime: string, filename: string) => void;
}) {
  const { src, mime, loading } = useAssetUrl(url);
  const isImage = !!src && (mime.startsWith("image/") || (!mime && /\.(jpe?g|png|gif|webp|heic)$/i.test(name)));
  const isPdf = mime === "application/pdf" || isPdfDataUrl(src) || /\.pdf$/i.test(name);

  return (
    <div className="overflow-hidden rounded-xl border border-warning/30 bg-warning/5 shadow-soft">
      <button
        type="button"
        onClick={() => src && onZoom(src, mime, name.replace(/\.[^.]+$/, "") || "file")}
        className="block w-full text-start"
        aria-label={name}
      >
        <div className="aspect-[4/3] w-full overflow-hidden bg-warning/10">
          {isImage ? (
            <img src={src} alt={name} className="h-full w-full object-cover" />
          ) : isPdf ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-warning-foreground">
              <FileText className="h-10 w-10" />
              <span className="text-[11px] font-semibold">PDF</span>
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-warning-foreground">
              {loading ? "…" : <FileText className="h-10 w-10" />}
            </div>
          )}
        </div>
      </button>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground" title={name}>{name}</div>
          <div className="text-[10px] text-muted-foreground">
            {sizeKb > 0 ? `${(sizeKb / 1024).toFixed(0)} KB · ` : ""}{type || mime || "file"}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); downloadAsset(url, name); }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-foreground shadow-soft transition hover:bg-muted"
          aria-label="download"
        >
          <Download className="h-4 w-4" />
        </button>
      </div>
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
      toast.error(safeMessage(e, lang === "ar" ? "تعذر حفظ الملاحظة، حاول مرة أخرى" : "Could not save the note, please try again"));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (noteId: string) => {
    setResolvingId(noteId);
    try {
      const updated = await resolveRequestNote(req.id, noteId);
      onUpdated(updated);
    } catch (e) {
      toast.error(safeMessage(e, lang === "ar" ? "تعذر تحديث الملاحظة" : "Could not update the note"));
    } finally {
      setResolvingId(null);
    }
  };

  const copyReuploadLink = async () => {
    const url = `${window.location.origin}/r/${encodeURIComponent(req.id)}`;
    try {
      await copyToClipboard(url);
      toast.success(t.details.reuploadLinkCopied);
    } catch (e) {
      toast.error(safeMessage(e, t.details.copyReuploadLink));
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

function ReassignCard({
  req, user, onReassigned,
}: {
  req: InsuranceRequest;
  user: AuthUser | null;
  onReassigned: (r: InsuranceRequest) => void;
}) {
  const { t, lang } = useLang();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      const cached = listAgents();
      if (cached.length) setAgents(cached);
      getAgents().then((rows) => { if (alive) setAgents(rows); }).catch(() => {});
    };
    refresh();
    const off = typeof window !== "undefined"
      ? (() => { window.addEventListener("aib:agents-changed", refresh); return () => window.removeEventListener("aib:agents-changed", refresh); })()
      : () => {};
    return () => { alive = false; off(); };
  }, []);

  if (!user) return null;
  const isAdmin = user.role === "admin";
  const isBranchSup = user.role === "supervisor" && user.branch === req.branch;
  const isOwner = user.role === "agent" && user.agentId === req.agentId;
  if (!isAdmin && !isBranchSup && !isOwner) return null;

  const meAgent = agents.find((a) => a.id === user.agentId);
  const myType = meAgent?.staffType;
  const currentOwner = agents.find((a) => a.id === req.agentId);
  const ownerType = currentOwner?.staffType;

  // Base pool: active agents in same branch, not the current owner.
  const basePool = agents.filter(
    (a) => a.role === "agent" && a.branch === req.branch && a.id !== req.agentId && a.active,
  );

  // Restrict candidates by who's acting:
  // - Sales owner: only underwriters (cannot hand off to another sales).
  // - Underwriter owner: only other underwriters (return-to-sales is a separate quick action).
  // - Admin / supervisor: full pool.
  let candidates = basePool;
  if (isOwner && myType === "sales") {
    // Sales can only send to their single assigned underwriter.
    candidates = basePool.filter(
      (a) => a.staffType === "underwriter" && a.id === meAgent?.assignedUnderwriterId,
    );
  } else if (isOwner && myType === "underwriter") {
    candidates = basePool.filter((a) => a.staffType === "underwriter");
  } else if (!isOwner && (isAdmin || isBranchSup) && ownerType === "sales") {
    // Admin/Sup viewing a sales-owned request: still default to that sales' assigned UW
    // but allow picking any UW in the branch.
    const ownerAssignedUW = currentOwner?.assignedUnderwriterId;
    candidates = [...basePool].sort((a, b) => {
      if (a.id === ownerAssignedUW) return -1;
      if (b.id === ownerAssignedUW) return 1;
      return 0;
    });
  }

  const underwriters = candidates.filter((a) => a.staffType === "underwriter");
  const originSales = req.originAgentId && req.originAgentId !== req.agentId
    ? agents.find((a) => a.id === req.originAgentId && a.active)
    : undefined;

  // For underwriter owner, "return to sales" is always available if originSales exists,
  // even when there are no other underwriters in the branch.
  const canReturnToSales = isOwner && myType === "underwriter" && !!originSales;

  // Sales owner with NO valid candidate → still render the section with a
  // clear diagnostic so the user understands why the action is unavailable
  // and what to do (ask supervisor to assign an underwriter, etc.).
  const salesOwnerBlocked = isOwner && myType === "sales" && candidates.length === 0;
  if (candidates.length === 0 && !canReturnToSales && !salesOwnerBlocked) return null;

  if (salesOwnerBlocked) {
    const assigned = meAgent?.assignedUnderwriterId
      ? agents.find((a) => a.id === meAgent.assignedUnderwriterId)
      : undefined;
    const reason = !meAgent
      ? (lang === "ar"
          ? "تعذّر تحميل بيانات حسابك. أعد تحميل الصفحة."
          : "Could not load your account data. Please refresh.")
      : !meAgent.assignedUnderwriterId
        ? (lang === "ar"
            ? "لا يوجد أندررايتر معيّن لك. يرجى التواصل مع المشرف لتعيين أندررايتر."
            : "You don't have an assigned underwriter yet. Ask your supervisor to assign one.")
        : !assigned
          ? (lang === "ar"
              ? `الأندررايتر المعيّن (${meAgent.assignedUnderwriterId}) غير موجود في قائمة موظفي الفرع. تواصل مع المشرف.`
              : `Your assigned underwriter (${meAgent.assignedUnderwriterId}) is not visible in this branch. Contact your supervisor.`)
          : !assigned.active
            ? (lang === "ar"
                ? `الأندررايتر المعيّن (${assigned.name}) موقوف حالياً. اطلب من المشرف تفعيله أو تعيين أندررايتر آخر.`
                : `Your assigned underwriter (${assigned.name}) is suspended. Ask your supervisor to reactivate them or assign a different one.`)
            : assigned.branch !== req.branch
              ? (lang === "ar"
                  ? `الأندررايتر المعيّن في فرع مختلف (${assigned.branch}) عن فرع الطلب (${req.branch}).`
                  : `Your assigned underwriter is in a different branch (${assigned.branch}) than the request (${req.branch}).`)
              : (lang === "ar" ? "تعذّر تجهيز خيار التحويل." : "Could not prepare a transfer target.");
    return (
      <section className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 shadow-card">
        <h3 className="mb-1 text-sm font-bold text-foreground">
          {lang === "ar" ? "تحويل الطلب للأندررايتر" : "Send to underwriter"}
        </h3>
        <p className="text-xs text-destructive">{reason}</p>
      </section>
    );
  }

  const doReassign = async (targetId: string, label: string) => {
    if (!targetId || busy) return;
    setBusy(true);
    try {
      const updated = await reassignRequest(req.id, targetId);
      onReassigned(updated);
      toast.success(label);
      setTarget("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  // Quick action: sales → first underwriter in branch
  const showSendToUW = (isOwner && myType === "sales" && underwriters.length > 0)
    || (!isOwner && (isAdmin || isBranchSup) && ownerType === "sales" && underwriters.length > 0);
  // Quick action: underwriter → return to origin sales
  const showReturnToSales = canReturnToSales
    || (!isOwner && (isAdmin || isBranchSup) && ownerType === "underwriter" && !!originSales);
  // Quick action: underwriter owner handing off to another underwriter
  const showHandoffUW = isOwner && myType === "underwriter" && underwriters.length > 0;

  // Default the dropdown selection based on the workflow direction:
  const defaultTarget = showSendToUW
    ? underwriters[0].id
    : showHandoffUW
      ? underwriters[0].id
      : showReturnToSales && originSales
        ? originSales.id
        : "";
  const effectiveTarget = target || defaultTarget;

  const primaryLabel = showSendToUW
    ? (lang === "ar" ? "اطلب عرض السعر من الأندررايتر" : "Request quote from underwriter")
    : showHandoffUW && (!originSales || effectiveTarget !== originSales.id)
      ? (lang === "ar" ? "تحويل لأندررايتر آخر" : "Transfer to another underwriter")
      : showReturnToSales
        ? (lang === "ar" ? "إرجاع للسيلز" : "Return to sales")
        : (lang === "ar" ? "نقل" : "Transfer");
  const successLabel = showSendToUW
    ? (lang === "ar" ? "تم إرسال الطلب للأندررايتر" : "Request sent to underwriter")
    : showHandoffUW && (!originSales || effectiveTarget !== originSales.id)
      ? (lang === "ar" ? "تم تحويل الطلب لأندررايتر آخر" : "Request transferred to another underwriter")
      : showReturnToSales
        ? (lang === "ar" ? "تم إرجاع الطلب للسيلز" : "Returned to sales")
        : (lang === "ar" ? "تم نقل الطلب" : "Request reassigned");

  // Build the option list. For an underwriter owner, inject originSales so
  // "return to sales" is selectable even though sales agents are filtered out.
  const optionPool = canReturnToSales && originSales && !candidates.some((a) => a.id === originSales.id)
    ? [...candidates, originSales]
    : candidates;

  // Re-order options so the most likely target appears first.
  const ordered = [...optionPool].sort((a, b) => {
    if (showSendToUW) {
      const ua = a.staffType === "underwriter" ? 0 : 1;
      const ub = b.staffType === "underwriter" ? 0 : 1;
      if (ua !== ub) return ua - ub;
    }
    if (showReturnToSales && originSales) {
      if (a.id === originSales.id) return -1;
      if (b.id === originSales.id) return 1;
    }
    return a.name.localeCompare(b.name);
  });

  // Dedicated, prominent "Send to Assigned Underwriter" card for sales owner.
  // This is the primary routing action for sales agents and must be visually
  // separate from the generic status/transfer controls.
  const salesSendCard =
    isOwner && myType === "sales" && underwriters.length === 1 ? (
      <section className="mt-6 rounded-2xl border-2 border-primary/40 bg-primary/5 p-5 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground">
              {lang === "ar" ? "إرسال الطلب للأندررايتر المعيّن" : "Send to Assigned Underwriter"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {lang === "ar"
                ? `سيتم تحويل الطلب إلى ${underwriters[0].name} لتجهيز عرض السعر. سيبقى الطلب مرتبطاً بك كـ origin_agent.`
                : `Routes this request to ${underwriters[0].name} to prepare a quote. You remain the origin_agent.`}
            </p>
          </div>
          <button
            onClick={() =>
              doReassign(
                underwriters[0].id,
                lang === "ar" ? "تم إرسال الطلب للأندررايتر" : "Request sent to underwriter",
              )
            }
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft transition active:scale-95 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {lang === "ar" ? "إرسال للأندررايتر" : "Send to Underwriter"}
          </button>
        </div>
      </section>
    ) : null;

  // For the sales-owner happy path, render ONLY the dedicated card to avoid
  // duplicating the same action in a generic transfer panel below.
  if (salesSendCard && isOwner && myType === "sales") {
    return salesSendCard;
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <h3 className="mb-1 text-sm font-bold text-foreground">
        {lang === "ar" ? "تحويل الطلب" : "Transfer request"}
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {showSendToUW
          ? (lang === "ar" ? "اختر الأندررايتر ليجهّز عرض السعر — وسيرجع الطلب لك تلقائياً بعد رفع العرض." : "Pick an underwriter to prepare the quote — the request will return to you automatically once the quote is uploaded.")
          : showReturnToSales
            ? (lang === "ar" ? "اختر السيلز الذي تريد إرجاع الطلب له" : "Pick the sales agent to return this request to")
            : (lang === "ar" ? "اختر موظفاً لتحويل الطلب له" : "Pick an agent to transfer this request to")}
      </p>

      {(() => {
        // Sales owner: locked to a single assigned underwriter — show a fixed
        // label + button instead of a dropdown so the choice can't be changed.
        const lockToAssigned = isOwner && myType === "sales" && ordered.length === 1;
        const lockedTarget = lockToAssigned ? ordered[0] : null;
        return (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {lockedTarget ? (
              <div className="h-10 flex-1 rounded-xl border border-input bg-surface px-3 text-sm font-medium text-foreground flex items-center">
                {lockedTarget.name} · {lockedTarget.id} ({lockedTarget.staffType ?? "agent"})
              </div>
            ) : (
              <select
                value={effectiveTarget}
                onChange={(e) => setTarget(e.target.value)}
                className="h-10 flex-1 rounded-xl border border-input bg-surface px-3 text-sm font-medium text-foreground"
              >
                <option value="">{lang === "ar" ? "اختر موظفاً…" : "Pick an agent…"}</option>
                {ordered.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.id} ({a.staffType ?? "agent"})
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => doReassign(lockedTarget?.id ?? effectiveTarget, successLabel)}
              disabled={(!lockedTarget && !effectiveTarget) || busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-soft transition active:scale-95 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {primaryLabel}
            </button>
          </div>
        );
      })()}
    </section>
  );
}

function QuotesCard({
  req, user, onUpdated,
}: {
  req: InsuranceRequest;
  user: AuthUser | null;
  onUpdated: (r: InsuranceRequest) => void;
}) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [sendingToUW, setSendingToUW] = useState(false);
  const [agents, setAgents] = useState<Agent[]>(() => listAgents());

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      const cached = listAgents();
      if (cached.length) setAgents(cached);
      getAgents().then((rows) => { if (alive) setAgents(rows); }).catch(() => {});
    };
    refresh();
    const off = typeof window !== "undefined"
      ? (() => { window.addEventListener("aib:agents-changed", refresh); return () => window.removeEventListener("aib:agents-changed", refresh); })()
      : () => {};
    return () => { alive = false; off(); };
  }, []);

  if (!user) return null;

  const meAgent = agents.find((a: Agent) => a.userId === user.id || a.id === user.agentId);
  const myType = meAgent?.staffType ?? user.staffType;
  const isUW = myType === "underwriter";
  const isSales = myType === "sales";
  const isAdmin = user.role === "admin";
  const isSup = user.role === "supervisor" && user.branch === req.branch;

  // Sales owner shortcut: when no quote exists yet, surface a direct
  // "Send to assigned underwriter" button right here in the Quotes card.
  // Compare by canonical Directus user UUIDs; fall back to agent codes only
  // if UUIDs are missing on the request row.
  const isSalesOwner =
    isSales && (
      (!!req.agentUserId && req.agentUserId === user.id) ||
      (!!req.originAgentUserId && req.originAgentUserId === user.id) ||
      (!!user.agentId && (user.agentId === req.agentId || user.agentId === req.originAgentId))
    );
  const assignedUW = meAgent?.assignedUnderwriterId
    ? agents.find((a: Agent) => a.id === meAgent.assignedUnderwriterId || a.userId === meAgent.assignedUnderwriterId)
    : undefined;
  const requestAlreadyAtAssignedUW =
    !!assignedUW && (
      (!!req.agentUserId && req.agentUserId === assignedUW.userId) ||
      req.agentId === assignedUW.id ||
      req.agentId === assignedUW.userId
    );
  const canSendToUW =
    isSalesOwner &&
    !!assignedUW &&
    !requestAlreadyAtAssignedUW;
  const sendToUWDebugReason = !isSales
    ? "current user is not sales"
    : !isSalesOwner
      ? "current sales user is not request agent/origin_agent"
      : !meAgent
        ? "current agent row not loaded"
        : !meAgent.assignedUnderwriterId
          ? "sales user has no assigned_underwriter"
          : !assignedUW
            ? "assigned underwriter row not loaded or not visible"
            : requestAlreadyAtAssignedUW
              ? "request is already assigned to this underwriter"
              : "visible";


  const sendToUW = async () => {
    if (!assignedUW || sendingToUW) return;
    setSendingToUW(true);
    try {
      const updated = await reassignRequest(req.id, assignedUW.id);
      onUpdated(updated);
      toast.success(
        ar ? "تم إرسال الطلب للأندررايتر" : "Request sent to underwriter",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSendingToUW(false);
    }
  };

  const quotes = req.quotes ?? [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(ar ? "ar-AE" : "en-GB", { dateStyle: "short", timeStyle: "short" });

  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length) setFiles((prev) => [...prev, ...list]);
  };

  const upload = async () => {
    if (!files.length || busy) return;
    setBusy(true);
    try {
      const updated = await addQuotesToRequest(req.id, files);
      onUpdated(updated);
      setFiles([]);
      toast.success(ar ? "تم رفع عرض السعر" : "Quote uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (qid: string) => {
    setRemovingId(qid);
    try {
      const updated = await removeQuoteFromRequest(req.id, qid);
      onUpdated(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRemovingId(null);
    }
  };

  const shareLink = `${typeof window !== "undefined" ? window.location.origin : ""}/q/${encodeURIComponent(req.id)}`;
  const [shareOpen, setShareOpen] = useState(false);
  const markLinkSentBestEffort = async () => {
    // Only flip status forward; never overwrite a sold/rejected terminal state.
    if (req.status === "sold" || req.status === "rejected" || req.status === "linkSent") return;
    try {
      const updated = await updateRequestStatus(req.id, "linkSent");
      onUpdated(updated);
    } catch (e) {
      console.warn("[share quote] failed to mark linkSent", e);
    }
  };
  const copyShareLink = async () => {
    try {
      await copyToClipboard(shareLink);
      toast.success(ar ? "تم نسخ رابط المشاركة" : "Share link copied");
    } catch (e) {
      toast.error(safeMessage(e, ar ? "تعذر نسخ الرابط" : "Could not copy link"));
      return;
    }
    await markLinkSentBestEffort();
  };
  const emailShareLink = async () => {
    if (!req.customerEmail) {
      toast.error(ar ? "لا يوجد بريد للعميل" : "No customer email on file");
      return;
    }
    const subject = encodeURIComponent(ar ? `عرض السعر — ${req.id}` : `Insurance quote — ${req.id}`);
    const body = encodeURIComponent(
      (ar
        ? `مرحباً ${req.customerName ?? ""}،\n\nيمكنك الاطلاع على عرض السعر من الرابط التالي:\n${shareLink}`
        : `Hello ${req.customerName ?? ""},\n\nYou can view your quote here:\n${shareLink}`),
    );
    // Open the user's mail client. We do NOT claim "sent" — no SMTP is wired.
    window.open(
      `mailto:${encodeURIComponent(req.customerEmail)}?subject=${subject}&body=${body}`,
      "_self",
    );
    toast.message(ar ? "تم فتح بريدك — أكمل الإرسال يدوياً" : "Opened your email client — send manually to finish");
    await markLinkSentBestEffort();
  };
  const whatsappShareLink = async () => {
    const raw = (req.customerPhone ?? "").replace(/[^\d+]/g, "");
    const digits = raw.replace(/^\+/, "");
    if (!digits) {
      toast.error(ar ? "لا يوجد رقم هاتف للعميل" : "No customer phone on file");
      return;
    }
    const msg = ar
      ? `مرحباً ${req.customerName ?? ""}، عرض السعر جاهز. يمكنك الاطلاع عليه هنا: ${shareLink}`
      : `Hello ${req.customerName ?? ""}, your insurance quote is ready. You can view it here: ${shareLink}`;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
    await markLinkSentBestEffort();
  };
  const openShareLink = async () => {
    window.open(shareLink, "_blank", "noopener");
    await markLinkSentBestEffort();
  };

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-foreground">
          {ar ? "عروض الأسعار" : "Quotes"}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {quotes.length} {ar ? "ملف" : "file(s)"}
        </span>
      </div>

      {quotes.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {isUW
              ? (ar ? "ارفع عرض السعر هنا — سيرجع الطلب تلقائياً للسيلز ليرسله للعميل." : "Upload the quote here — the request returns to sales automatically so they can share it with the customer.")
              : isSales
                ? (ar ? "بانتظار رفع عرض السعر من الأندررايتر." : "Waiting for the underwriter to upload the quote.")
                : (ar ? "لم يتم رفع أي عرض سعر بعد." : "No quotes uploaded yet.")}
          </p>
          {canSendToUW && (
            <button
              type="button"
              onClick={sendToUW}
              disabled={sendingToUW}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-soft transition active:scale-95 disabled:opacity-60"
            >
              {sendingToUW ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {ar
                ? `إرسال إلى الأندررايتر (${assignedUW!.name})`
                : `Send to assigned underwriter (${assignedUW!.name})`}
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {quotes.map((q) => {
            const canRemove = isAdmin || q.uploadedByUserId === user.id;
            return (
              <li key={q.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground" title={q.name}>{q.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {q.size > 0 ? `${(q.size / 1024).toFixed(0)} KB · ` : ""}{q.type || "file"} · {q.uploadedByName} · {fmt(q.uploadedAt)}
                  </div>
                </div>
                <a
                  href={q.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-foreground transition hover:bg-muted"
                  aria-label="open"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                {canRemove && (
                  <button
                    type="button"
                    disabled={removingId === q.id}
                    onClick={() => remove(q.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
                    aria-label="remove"
                  >
                    {removingId === q.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(isUW || isAdmin || isSup) && (
        <div className="mt-4 rounded-xl border border-dashed border-primary/40 bg-primary-soft/30 p-3">
          <input
            type="file"
            multiple
            onChange={onFilesPicked}
            className="block w-full text-xs text-foreground file:me-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground"
          />

          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((f, idx) => (
                <li
                  key={`${f.name}-${idx}`}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground" title={f.name}>{f.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {f.size > 0 ? `${(f.size / 1024).toFixed(0)} KB` : ""}{f.type ? ` · ${f.type}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
                    aria-label={ar ? "إزالة" : "remove"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {files.length > 0 && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFiles([])}
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {ar ? "إلغاء" : "Cancel"}
              </button>
              <button
                onClick={upload}
                disabled={busy}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-soft transition active:scale-95 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {ar
                  ? `إرسال للسيلز (${files.length})`
                  : `Send to sales (${files.length})`}
              </button>
            </div>
          )}

          <p className="mt-2 text-[10px] text-muted-foreground">
            {ar
              ? "اختر الملف أولاً لتراجعه، ثم اضغط إرسال للسيلز — أو إلغاء لو بدك تغيّره."
              : "Pick the file to review it first, then press Send to sales — or Cancel to change it."}
          </p>
        </div>
      )}

      {quotes.length > 0 && (isSales || isAdmin || isSup) && (
        <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">
                {ar ? "مشاركة عرض السعر مع العميل" : "Share Quote with Customer"}
              </p>
              <p dir="ltr" className="mt-0.5 truncate text-[11px] text-muted-foreground" title={shareLink}>{shareLink}</p>
            </div>
            <button
              onClick={() => setShareOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-soft transition active:scale-95"
            >
              <Send className="h-3.5 w-3.5" />
              {ar ? "مشاركة عرض السعر مع العميل" : "Share Quote with Customer"}
            </button>
          </div>
          {shareOpen && (
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
              onClick={() => setShareOpen(false)}
            >
              <div
                className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-card"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-foreground">
                    {ar ? "مشاركة عرض السعر مع العميل" : "Share Quote with Customer"}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShareOpen(false)}
                    aria-label="close"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p dir="ltr" className="mb-3 truncate rounded-lg border border-border bg-surface px-2 py-1.5 text-[11px] text-muted-foreground" title={shareLink}>{shareLink}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setShareOpen(false); whatsappShareLink(); }}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-3 text-xs font-semibold text-white shadow-soft transition active:scale-95"
                  >
                    <MessageSquare className="h-4 w-4" />
                    {ar ? "واتساب" : "WhatsApp"}
                  </button>
                  <button
                    onClick={() => { setShareOpen(false); emailShareLink(); }}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-soft transition active:scale-95"
                  >
                    <Mail className="h-4 w-4" />
                    {ar ? "بريد إلكتروني" : "Email"}
                  </button>
                  <button
                    onClick={() => { setShareOpen(false); copyShareLink(); }}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground transition hover:bg-muted active:scale-95"
                  >
                    <Copy className="h-4 w-4" />
                    {ar ? "نسخ الرابط" : "Copy link"}
                  </button>
                  <button
                    onClick={() => { setShareOpen(false); openShareLink(); }}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground transition hover:bg-muted active:scale-95"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {ar ? "فتح الرابط" : "Open link"}
                  </button>
                </div>
                <p className="mt-3 text-[10px] text-muted-foreground">
                  {ar
                    ? "اختر طريقة المشاركة لإرسال الرابط للعميل. لن نُحدِّث الحالة كـ«تم الإرسال» إلا بعد اختيارك."
                    : "Pick a channel to share the link with the customer. Status flips to “link sent” only after you act."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
