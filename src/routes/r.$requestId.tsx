import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { MultiUploadCard } from "@/components/MultiUploadCard";
import { useLang } from "@/i18n/LanguageProvider";

export const Route = createFileRoute("/r/$requestId")({
  component: ReuploadPage,
});

type MissingNote = { id: string; text: string; createdAt: string };
type ReuploadInfo = {
  found: boolean;
  id?: string;
  display?: string;
  customerName?: string | null;
  missing?: MissingNote[];
};

function ReuploadPage() {
  const { t, dir, lang } = useLang();
  const { requestId } = Route.useParams();
  const [info, setInfo] = useState<ReuploadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch(
        `/api/public/reupload-request?id=${encodeURIComponent(requestId)}`,
        { cache: "no-store" },
      );
      const data: ReuploadInfo = await res.json();
      setInfo(data);
    } catch (e) {
      console.error("reupload-request failed", e);
      setInfo({ found: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/public/reupload-request?id=${encodeURIComponent(requestId)}`,
          { cache: "no-store" },
        );
        const data: ReuploadInfo = await res.json();
        if (alive) setInfo(data);
      } catch (e) {
        console.error("reupload-request failed", e);
        if (alive) setInfo({ found: false });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [requestId]);

  const onSubmit = async () => {
    if (!info?.found || files.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("id", requestId);
      for (const f of files) fd.append("file", f, f.name);
      const res = await fetch("/api/public/reupload-submit", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        const msg =
          res.status === 413
            ? lang === "ar"
              ? "حجم الملفات كبير جداً، جرّب صور أصغر أو أقل عدداً"
              : "Files too large, try smaller or fewer files"
            : (lang === "ar" ? "تعذر إرسال الملفات" : "Failed to send files");
        toast.error(msg);
        setSubmitting(false);
        return;
      }
      setDone(true);
      setFiles([]);
      await refresh();
    } catch (err) {
      console.error(err);
      toast.error(lang === "ar" ? "تعذر إرسال الملفات" : "Failed to send files");
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

  if (!info?.found) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center" dir={dir}>
        <div className="max-w-sm">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-foreground">
            {t.reuploadPage?.notFound ?? (lang === "ar" ? "الطلب غير موجود" : "Request not found")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">#{requestId}</p>
        </div>
      </div>
    );
  }

  const missing = info.missing ?? [];
  const fmt = (iso: string) =>
    iso ? new Date(iso).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "";

  return (
    <div className="bg-background animate-fade-in" dir={dir}>
      <header className="px-4 pt-5">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <LanguageSwitcher />
          <span className="text-xs text-muted-foreground">#{info.display ?? requestId}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-6 pb-10">
        <div className="flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-5 text-2xl font-bold text-foreground sm:text-3xl">
            {t.reuploadPage?.title ?? (lang === "ar" ? "إكمال المستندات الناقصة" : "Complete missing documents")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {info.customerName
              ? `${t.details.customerName}: ${info.customerName}`
              : (t.reuploadPage?.subtitle ?? "")}
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t.hero?.trust ?? ""}</span>
          </div>
        </div>

        {/* Missing items list */}
        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {t.reuploadPage?.missingHeader ?? (lang === "ar" ? "النواقص المطلوبة منك" : "Items requested from you")}
          </h2>
          {missing.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.reuploadPage?.noMissing ?? (lang === "ar" ? "لا توجد نواقص مطلوبة حالياً" : "No missing items requested at the moment")}
            </p>
          ) : (
            <ul className="space-y-2">
              {missing.map((n) => (
                <li
                  key={n.id}
                  className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-foreground"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-warning-foreground">
                      <AlertTriangle className="h-3 w-3" />
                      {t.details.noteKindMissing}
                    </span>
                    {n.createdAt && <span className="text-muted-foreground">{fmt(n.createdAt)}</span>}
                  </div>
                  <p className="whitespace-pre-wrap">{n.text}</p>
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
              {t.reuploadPage?.success ?? t.success.title}
            </>
          ) : submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t.reuploadPage?.submitting ?? t.upload.uploadingDocs}
            </>
          ) : (
            t.reuploadPage?.submit ?? t.upload.submit
          )}
        </button>
      </main>
    </div>
  );
}
