import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, FileText, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { useLang } from "@/i18n/LanguageProvider";
import { getRequest, type InsuranceRequest } from "@/services/api";

export const Route = createFileRoute("/q/$requestId")({
  component: QuoteSharePage,
});

function QuoteSharePage() {
  const { dir, lang } = useLang();
  const { requestId } = Route.useParams();
  const [req, setReq] = useState<InsuranceRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getRequest(requestId).then((r) => {
      if (!alive) return;
      setReq(r);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [requestId]);

  const ar = lang === "ar";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!req) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center" dir={dir}>
        <div className="max-w-sm">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-foreground">
            {ar ? "الطلب غير موجود" : "Request not found"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">#{requestId}</p>
        </div>
      </div>
    );
  }

  const quotes = req.quotes ?? [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(ar ? "ar-AE" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  const downloadQuote = (q: { url: string; name: string; type: string }) => {
    const a = document.createElement("a");
    a.href = q.url;
    a.download = q.name || "quote";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="bg-background min-h-screen animate-fade-in" dir={dir}>
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
            {ar ? "عرض السعر الخاص بك" : "Your insurance quote"}
          </h1>
          {req.customerName && (
            <p className="mt-2 text-sm text-muted-foreground">
              {ar ? `للسيد/ة ${req.customerName}` : `Prepared for ${req.customerName}`}
            </p>
          )}
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{ar ? "مشاركة آمنة" : "Secure share"}</span>
          </div>
        </div>

        {/* Customer / request info card */}
        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="mb-3 text-sm font-bold text-foreground">
            {ar ? "تفاصيل العميل" : "Customer details"}
          </h2>
          <div className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
            {req.customerName && (
              <div><span className="font-medium text-foreground">{ar ? "الاسم" : "Name"}:</span> {req.customerName}</div>
            )}
            {req.customerEmail && (
              <div dir="ltr" className="truncate"><span className="font-medium text-foreground">{ar ? "البريد" : "Email"}:</span> {req.customerEmail}</div>
            )}
            {req.customerPhone && (
              <div dir="ltr" className="truncate"><span className="font-medium text-foreground">{ar ? "الهاتف" : "Phone"}:</span> {req.customerPhone}</div>
            )}
            <div><span className="font-medium text-foreground">{ar ? "رقم الطلب" : "Request"}:</span> {req.id}</div>
            <div><span className="font-medium text-foreground">{ar ? "الفرع" : "Branch"}:</span> {req.branch}</div>
            <div><span className="font-medium text-foreground">{ar ? "التاريخ" : "Date"}:</span> {fmt(req.createdAt)}</div>
          </div>
        </section>

        {/* Quote files */}
        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="mb-3 text-sm font-bold text-foreground">
            {ar ? "ملفات عرض السعر" : "Quote files"}
          </h2>

          {quotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ar ? "لم يتم رفع عرض السعر بعد. يرجى المحاولة لاحقاً." : "No quote has been uploaded yet. Please check back later."}
            </p>
          ) : (
            <ul className="space-y-2">
              {quotes.map((q) => {
                const isPdf = q.type === "application/pdf" || /\.pdf$/i.test(q.name);
                const isImage = q.type.startsWith("image/");
                return (
                  <li key={q.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-soft">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground" title={q.name}>{q.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {q.size > 0 ? `${(q.size / 1024).toFixed(0)} KB · ` : ""}
                        {isPdf ? "PDF" : isImage ? (ar ? "صورة" : "Image") : (q.type || "file")}
                        {" · "}{fmt(q.uploadedAt)}
                      </div>
                    </div>
                    <a
                      href={q.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground shadow-soft transition hover:bg-muted"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {ar ? "فتح" : "Open"}
                    </a>
                    <button
                      type="button"
                      onClick={() => downloadQuote(q)}
                      className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-soft transition active:scale-95"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {ar ? "تنزيل" : "Download"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          {ar ? `وكيلك: ${req.agentName}` : `Your agent: ${req.agentName}`}
        </p>
      </main>
    </div>
  );
}
