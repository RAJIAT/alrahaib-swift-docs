import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { MultiUploadCard } from "@/components/MultiUploadCard";
import { useLang } from "@/i18n/LanguageProvider";
import {
  getRequest,
  appendAttachmentsToRequest,
  type InsuranceRequest,
} from "@/services/api";

export const Route = createFileRoute("/r/$requestId")({
  component: ReuploadPage,
});

function ReuploadPage() {
  const { t, dir } = useLang();
  const { requestId } = Route.useParams();
  const [req, setReq] = useState<InsuranceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    getRequest(requestId).then((r) => {
      if (!alive) return;
      setReq(r);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [requestId]);

  const missingNotes = useMemo(
    () => (req?.notes ?? []).filter((n) => n.kind === "missing" && !n.resolvedAt),
    [req],
  );

  const onSubmit = async () => {
    if (!req || files.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await appendAttachmentsToRequest(req.id, files);
      setDone(true);
      setFiles([]);
      // refresh to show resolved notes
      const fresh = await getRequest(req.id);
      setReq(fresh);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error && err.message === "STORAGE_QUOTA_EXCEEDED"
        ? (dir === "rtl" ? "حجم الملفات كبير جداً، جرّب صور أصغر أو أقل عدداً" : "Files too large, try smaller or fewer images")
        : (t.common?.statusUpdateFailed ?? "Failed");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!req) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t.details.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">#{requestId}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background animate-fade-in" dir={dir}>
      <header className="px-4 pt-5">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <LanguageSwitcher />
          <span className="text-xs text-muted-foreground">#{req.id}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-6 pb-10">
        <div className="flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-5 text-2xl font-bold text-foreground sm:text-3xl">
            {t.details.notesTitle}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {req.customerName ? `${t.details.customerName}: ${req.customerName}` : ""}
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t.hero?.trust ?? ""}</span>
          </div>
        </div>

        {/* Missing items list */}
        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {t.details.notesTitle}
          </h2>
          {missingNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.details.notesEmpty}</p>
          ) : (
            <ul className="space-y-2">
              {missingNotes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-foreground"
                >
                  <div className="mb-1 text-[11px] font-semibold uppercase text-warning-foreground">
                    {t.details.noteKindMissing}
                  </div>
                  {n.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Upload area */}
        <section className="mt-6">
          <MultiUploadCard
            label={t.upload.cards.attachments}
            hint={t.upload.attachmentsHint}
            files={files}
            onChange={setFiles}
            min={0}
            max={20}
            acceptAny
          />
        </section>

        <button
          disabled={files.length === 0 || submitting}
          onClick={onSubmit}
          className="mt-6 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-elevated transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {done ? (
            <>
              <Check className="h-5 w-5" />
              {t.success.title}
            </>
          ) : submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t.upload.uploadingDocs}
            </>
          ) : (
            t.upload.submit
          )}
        </button>
      </main>
    </div>
  );
}
