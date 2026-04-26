import { useLang } from "@/i18n/LanguageProvider";
import type { RequestStatus } from "@/services/api";

const STYLES: Record<RequestStatus, string> = {
  new: "bg-info/10 text-info ring-info/20",
  processing: "bg-warning/15 text-warning-foreground ring-warning/30",
  sold: "bg-success/10 text-success ring-success/20",
  rejected: "bg-destructive/10 text-destructive ring-destructive/20",
  reupload: "bg-purple/10 text-purple ring-purple/20",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useLang();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t.status[status]}
    </span>
  );
}
