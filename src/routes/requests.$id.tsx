import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { StatusBadge } from "@/components/StatusBadge";
import { useLang } from "@/i18n/LanguageProvider";
import { isPdfDataUrl } from "@/lib/imageUtils";
import {
  getCurrentUser, refreshCurrentUser, getRequest, updateRequestStatus, resolveAssetUrl,
  type InsuranceRequest, type RequestStatus,
} from "@/services/api";

export const Route = createFileRoute("/requests/$id")({
  component: RequestDetails,
});

type SavingAction = "quote" | "sold" | "reupload" | "select" | null;

function RequestDetails() {
  const { t, dir, lang } = useLang();
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const [req, setReq] = useState<InsuranceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<SavingAction>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [zoomMime, setZoomMime] = useState<string>("");

  const user = getCurrentUser();
  const role = user?.role ?? "agent";

  useEffect(() => {
    if (!user) { navigate({ to: "/login" }); return; }
    refreshCurrentUser().then((fresh) => {
      if (!fresh) { navigate({ to: "/login" }); return; }
    });
    getRequest(id).then((r) => { setReq(r); setLoading(false); });
  }, [id, navigate, user]);

  const setStatus = async (s: RequestStatus, action: SavingAction) => {
    if (!req || savingAction) return;
    const previous = req.status;
    // Optimistic update
    setReq({ ...req, status: s });
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

  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const backTo = role === "admin" ? "/admin" : "/agent";

  return (
    <DashboardShell role={role} title={t.details.title}>
      <Link
        to={backTo}
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        <Back className="h-4 w-4" />
        {t.details.back}
      </Link>

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
          {(req.customerName || req.customerEmail) && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-card">
              <h3 className="mb-3 text-sm font-bold text-foreground">{t.details.customer}</h3>
              <div className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
                {req.customerName && (
                  <div><span className="font-medium text-foreground">{t.details.customerName}:</span> {req.customerName}</div>
                )}
                {req.customerEmail && (
                  <div dir="ltr" className="truncate"><span className="font-medium text-foreground">{t.details.customerEmail}:</span> {req.customerEmail}</div>
                )}
              </div>
            </div>
          )}

          {/* Image cards */}
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <ImgCard label={t.details.registration} url={req.images.registration} onZoom={(u, m) => { setZoom(u); setZoomMime(m); }} pdfLabel={t.details.pdfDocument} />
            <ImgCard label={t.details.license} url={req.images.license} onZoom={(u, m) => { setZoom(u); setZoomMime(m); }} pdfLabel={t.details.pdfDocument} />
            <ImgCard label={t.details.emirates} url={req.images.emirates} onZoom={(u, m) => { setZoom(u); setZoomMime(m); }} pdfLabel={t.details.pdfDocument} />
          </div>

          {/* Optional: vehicle inspection */}
          {req.images.inspection && (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <ImgCard label={t.details.inspection} url={req.images.inspection} onZoom={(u, m) => { setZoom(u); setZoomMime(m); }} pdfLabel={t.details.pdfDocument} />
            </div>
          )}

          {/* Optional: vehicle photos */}
          {req.images.vehiclePhotos && req.images.vehiclePhotos.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-bold text-foreground">{t.details.vehiclePhotos}</h3>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                {req.images.vehiclePhotos.map((url, idx) => (
                  <ImgCard
                    key={idx}
                    label={`${t.details.vehiclePhotos} ${idx + 1}`}
                    url={url}
                    onZoom={(u, m) => { setZoom(u); setZoomMime(m); }}
                    pdfLabel={t.details.pdfDocument}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
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
          <button
            onClick={() => { setZoom(null); setZoomMime(""); }}
            className="absolute top-4 right-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface text-foreground shadow-soft transition hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
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
  label, url, onZoom, pdfLabel,
}: { label: string; url: string; onZoom: (u: string, mime: string) => void; pdfLabel: string }) {
  const { src, mime, loading } = useAssetUrl(url);
  const pdf = isPdfDataUrl(src) || mime === "application/pdf";
  return (
    <button
      onClick={() => src && onZoom(src, mime)}
      className="group block overflow-hidden rounded-2xl border border-border bg-card text-start shadow-card transition hover:shadow-elevated active:scale-[0.99]"
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
  );
}
