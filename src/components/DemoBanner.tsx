import { RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n/LanguageProvider";
import { isDemoMode, resetDemo } from "@/services/api";

export function DemoBanner() {
  const { t } = useLang();
  if (!isDemoMode()) return null;

  const onReset = () => {
    if (!window.confirm(t.demo.confirmReset)) return;
    resetDemo();
    toast.success(t.demo.resetDone);
    setTimeout(() => window.location.reload(), 600);
  };

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-primary/95 px-3 py-1.5 text-xs font-medium text-primary-foreground backdrop-blur supports-[backdrop-filter]:bg-primary/85">
      <span className="inline-flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        {t.demo.banner}
      </span>
      <button
        onClick={onReset}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-primary-foreground/25 active:scale-95"
      >
        <RotateCcw className="h-3 w-3" />
        {t.demo.reset}
      </button>
    </div>
  );
}
