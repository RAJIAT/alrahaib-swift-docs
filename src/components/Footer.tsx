import { ShieldCheck } from "lucide-react";
import { useLang } from "@/i18n/LanguageProvider";

export function Footer() {
  const { t, lang } = useLang();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-border bg-surface/50">
      <div className="mx-auto max-w-6xl px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="flex flex-col items-center justify-center gap-1.5 text-center sm:flex-row sm:gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-primary" />
            {lang === "ar" ? "اتصال مشفّر" : "Encrypted connection"}
          </span>
          <span className="hidden text-muted-foreground sm:inline">·</span>
          <p className="text-xs font-medium text-muted-foreground">
            {t.footer.rights(year)}
          </p>
        </div>
      </div>
    </footer>
  );
}
