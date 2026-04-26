import { Globe } from "lucide-react";
import { useLang } from "@/i18n/LanguageProvider";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { toggle, t } = useLang();
  return (
    <button
      onClick={toggle}
      className={`inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-foreground shadow-soft transition hover:bg-primary-soft hover:text-primary ${className}`}
      aria-label="Switch language"
    >
      <Globe className="h-4 w-4" />
      {t.langSwitch}
    </button>
  );
}
