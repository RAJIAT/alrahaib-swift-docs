import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useLang } from "@/i18n/LanguageProvider";

export function RemovalRequestDialog({
  open, agentName, onClose, onSubmit,
}: {
  open: boolean;
  agentName?: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const { t, dir } = useLang();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit(reason);
      setReason("");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" dir={dir}>
      <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-card shadow-elevated sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-foreground">
            {t.agents.requestRemovalTitle}
            {agentName ? ` — ${agentName}` : ""}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">{t.agents.requestRemovalBody}</p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{t.agents.removalReasonLabel}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.agents.removalReasonPlaceholder}
              rows={4}
              className="w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm text-foreground"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground">
              {t.agents.cancel}
            </button>
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t.agents.removalSubmit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
