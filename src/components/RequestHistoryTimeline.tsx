import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  FilePlus,
  FileX,
  History,
  MessageSquare,
  Send,
  Sparkles,
  UserPlus,
  RotateCcw,
  RefreshCw,
} from "lucide-react";
import { fetchRequestHistory, subscribeAudit, type AuditEntry } from "@/services/audit";
import { useLang } from "@/i18n/LanguageProvider";
import { translations } from "@/i18n/translations";

type FilterKey = "all" | "status" | "transfer" | "docs" | "notes";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "request.created": Sparkles,
  "request.status_changed": CheckCircle2,
  "request.reassigned": ArrowRightLeft,
  "request.assigned_to_underwriter": UserPlus,
  "request.returned_to_sales": RotateCcw,
  "request.underwriter_changed": RefreshCw,
  "request.sales_changed": RefreshCw,
  "request.document_uploaded": FilePlus,
  "request.document_removed": FileX,
  "request.reupload_requested": ClipboardList,
  "request.note_added": MessageSquare,
  "request.quote_uploaded": FileText,
  "request.quote_removed": FileX,
  "request.shared_with_customer": Send,
};

function statusLabel(key: any, ar: boolean): string {
  if (!key) return "—";
  const map = (ar ? translations.ar : translations.en).status as Record<string, string>;
  return map[key as string] ?? String(key);
}

function labelFor(action: string, ar: boolean, before?: any, after?: any, meta?: any): string {
  const fromTo = (b: any, a: any) =>
    `${b ?? "—"} → ${a ?? "—"}`;
  switch (action) {
    case "request.created":
      return ar ? "تم إنشاء الطلب من العميل" : "Request created by customer";
    case "request.status_changed": {
      const b = statusLabel(before?.status, ar);
      const a = statusLabel(after?.status, ar);
      if (meta?.manual) {
        return ar
          ? `تغيير الحالة يدويًا: ${b} → ${a}`
          : `Status changed manually: ${b} → ${a}`;
      }
      return ar
        ? `تغيّرت حالة الطلب: ${b} → ${a}`
        : `Status changed: ${b} → ${a}`;
    }
    case "request.assigned_to_underwriter":
      return ar
        ? `تم تعيين الطلب إلى الأندر رايتر ${after?.agentName ?? "—"}`
        : `Request assigned to underwriter ${after?.agentName ?? "—"}`;
    case "request.returned_to_sales":
      return meta?.auto
        ? (ar
            ? `أرجع النظام الطلب تلقائيًا إلى السيلز ${after?.agentName ?? "—"} بعد رفع عرض السعر`
            : `Auto-returned to sales ${after?.agentName ?? "—"} after quote upload`)
        : (ar
            ? `أرجع الأندر رايتر ${before?.agentName ?? "—"} الطلب إلى السيلز ${after?.agentName ?? "—"}`
            : `Underwriter ${before?.agentName ?? "—"} returned to sales ${after?.agentName ?? "—"}`);
    case "request.underwriter_changed":
      return ar
        ? `تغيّر الأندر رايتر: ${fromTo(before?.agentName, after?.agentName)}`
        : `Underwriter changed: ${fromTo(before?.agentName, after?.agentName)}`;
    case "request.sales_changed":
      return ar
        ? `تغيّر السيلز: ${fromTo(before?.agentName, after?.agentName)}`
        : `Sales changed: ${fromTo(before?.agentName, after?.agentName)}`;
    case "request.reassigned":
      return ar
        ? `أُعيد تعيين الطلب: ${fromTo(before?.agentName, after?.agentName)}`
        : `Reassigned: ${fromTo(before?.agentName, after?.agentName)}`;
    case "request.document_uploaded": {
      const c = meta?.count ?? 1;
      return ar ? `تم رفع ${c} مستند/مستندات` : `Uploaded ${c} document${c === 1 ? "" : "s"}`;
    }
    case "request.document_removed":
      return ar ? `تم حذف مستند: ${meta?.fileName ?? ""}` : `Document removed: ${meta?.fileName ?? ""}`;
    case "request.reupload_requested":
      return ar ? "طلب إعادة رفع مستندات ناقصة" : "Reupload of missing documents requested";
    case "request.note_added":
      return ar ? "تمت إضافة ملاحظة" : "Note added";
    case "request.quote_uploaded": {
      const c = meta?.count ?? 1;
      return ar ? `تم رفع عرض السعر (${c} ملف)` : `Quote uploaded (${c} file${c === 1 ? "" : "s"})`;
    }
    case "request.quote_removed":
      return ar ? `تم حذف عرض سعر: ${meta?.name ?? ""}` : `Quote removed: ${meta?.name ?? ""}`;
    case "request.shared_with_customer":
      return ar ? "تمت مشاركة عرض السعر مع العميل" : "Shared with customer";
    default:
      return action;
  }
}

function categoryOf(action: string): FilterKey {
  if (action === "request.status_changed") return "status";
  if (
    action.startsWith("request.assigned_to_") ||
    action === "request.returned_to_sales" ||
    action === "request.underwriter_changed" ||
    action === "request.sales_changed" ||
    action === "request.reassigned"
  )
    return "transfer";
  if (action.startsWith("request.document_") || action === "request.reupload_requested" || action.startsWith("request.quote_")) return "docs";
  if (action === "request.note_added") return "notes";
  return "all";
}

function roleLabel(role: string | null | undefined, ar: boolean): string {
  if (!role) return "";
  if (role === "admin") return ar ? "أدمن" : "Admin";
  if (role === "supervisor") return ar ? "مشرف" : "Supervisor";
  if (role === "agent") return ar ? "موظف" : "Agent";
  if (role === "anonymous") return ar ? "العميل" : "Customer";
  return role;
}

export function RequestHistoryTimeline({ requestId, showAdvanced = false }: { requestId: string; showAdvanced?: boolean }) {
  const { lang, dir } = useLang();
  const ar = lang === "ar";
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchRequestHistory(requestId).then((rows) => {
        if (!alive) return;
        setItems(rows);
        setLoading(false);
      });
    };
    load();
    const unsub = subscribeAudit(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [requestId]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((e) => categoryOf(e.action) === filter);
  }, [items, filter]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(ar ? "ar-AE" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });

  const filters: { key: FilterKey; label: string }[] = [
    { key: "all", label: ar ? "الكل" : "All" },
    { key: "transfer", label: ar ? "التحويلات" : "Transfers" },
    { key: "status", label: ar ? "الحالة" : "Status" },
    { key: "docs", label: ar ? "المستندات" : "Documents" },
    { key: "notes", label: ar ? "الملاحظات" : "Notes" },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card" dir={dir}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {ar ? "سجل الطلب" : "Request history"}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {ar
                ? "كل الأحداث التي مرّ بها هذا الطلب."
                : "Every event for this request."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition " +
                (filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-muted")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل..." : "Loading..."}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {ar ? "لا توجد أحداث مسجّلة بعد." : "No events recorded yet."}
        </p>
      ) : (
        <ol className="relative space-y-3">
          {filtered.map((e, i) => {
            const Icon = ICONS[e.action] ?? History;
            const open = !!expanded[e.id];
            const hasDetails =
              !!e.before || !!e.after || (e.meta && Object.keys(e.meta).length > 0);
            return (
              <li
                key={e.id}
                className="relative flex gap-3 rounded-xl border border-border bg-surface p-3 shadow-soft"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {labelFor(e.action, ar, e.before, e.after, e.meta)}
                    </p>
                    <time className="text-[11px] text-muted-foreground" title={e.ts}>
                      {fmt(e.ts)}
                    </time>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {e.actorName ?? (ar ? "النظام" : "System")}
                    {e.actorRole ? ` · ${roleLabel(e.actorRole, ar)}` : ""}
                    {e.actorBranch ? ` · ${e.actorBranch}` : ""}
                  </p>

                  {hasDetails && showAdvanced && (
                    <button
                      type="button"
                      onClick={() => setExpanded((p) => ({ ...p, [e.id]: !open }))}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                    >
                      {open
                        ? (ar ? "إخفاء التفاصيل" : "Hide details")
                        : (ar ? "عرض التفاصيل" : "Show details")}
                      {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  )}

                  {open && hasDetails && showAdvanced && (
                    <pre
                      dir="ltr"
                      className="mt-2 max-h-60 overflow-auto rounded-lg bg-muted p-2 text-[10px] leading-relaxed text-foreground"
                    >
{JSON.stringify({ before: e.before, after: e.after, meta: e.meta }, null, 2)}
                    </pre>
                  )}
                </div>
                {i < filtered.length - 1 && (
                  <span className="pointer-events-none absolute bottom-[-12px] start-[28px] block h-3 w-px bg-border" />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
