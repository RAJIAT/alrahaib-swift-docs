import { ShieldCheck } from "lucide-react";
import { useLang } from "@/i18n/LanguageProvider";

export function Footer() {
  const { t } = useLang();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-border bg-surface/50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t.footer.dataNotice}</span>
          </div>
          <p className="max-w-2xl text-xs text-muted-foreground">
            {t.footer.tagline}
          </p>
          <p className="text-xs font-medium text-muted-foreground">
            {t.footer.rights(year)}
          </p>
        </div>
      </div>
    </footer>
  );
}
