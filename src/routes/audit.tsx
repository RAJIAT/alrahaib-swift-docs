import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Download, ScrollText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useLang } from "@/i18n/LanguageProvider";
import { getCurrentUser, type AuthUser } from "@/services/api";
import {
  clearAudit, fetchAudit, subscribeAudit,
  type AuditEntry, type AuditAction, type AuditEntityType,
} from "@/services/audit";

export const Route = createFileRoute("/audit")({
  component: AuditPage,
});

function useFilterOptions(t: ReturnType<typeof useLang>["t"]) {
  const ACTION_FILTERS: Array<{ value: "" | AuditAction; label: string }> = [
    { value: "", label: t.audit.filterAllActions },
    { value: "request.status_changed", label: t.audit.actionRequestStatus },
    { value: "agent.created", label: t.audit.actionUserCreated },
    { value: "agent.pending_created", label: t.audit.actionUserPending },
    { value: "agent.approved", label: t.audit.actionUserApproved },
    { value: "agent.updated", label: t.audit.actionUserUpdated },
    { value: "agent.deleted", label: t.audit.actionUserDeleted },
    { value: "settings.approval_changed", label: t.audit.actionApprovalToggle },
    { value: "auth.login", label: t.audit.actionAuthLogin },
    { value: "auth.logout", label: t.audit.actionAuthLogout },
  ];
  const ENTITY_FILTERS: Array<{ value: "" | AuditEntityType; label: string }> = [
    { value: "", label: t.audit.filterAllEntities },
    { value: "request", label: t.audit.entityRequests },
    { value: "agent", label: t.audit.entityAgents },
    { value: "auth", label: t.audit.entityAuth },
  ];
  return { ACTION_FILTERS, ENTITY_FILTERS };
}

function AuditPage() {
  const { dir, t } = useLang();
  const { ACTION_FILTERS, ENTITY_FILTERS } = useFilterOptions(t);
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState<"" | AuditAction>("");
  const [entityType, setEntityType] = useState<"" | AuditEntityType>("");
  const [confirmClear, setConfirmClear] = useState(false);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  useEffect(() => {
    const u = getCurrentUser();
    if (!u || (u.role !== "admin" && u.role !== "supervisor")) {
      navigate({ to: "/login" });
      return;
    }
    setUser(u);
    const refresh = () => {
      fetchAudit({
        branch: u.role === "supervisor" ? u.branch : undefined,
        action: action || undefined,
        entityType: entityType || undefined,
        limit: 500,
      }).then((rows) => setEntries(rows)).catch(() => {});
    };
    refresh();
    const off = subscribeAudit(refresh);
    return () => off();
  }, [navigate, action, entityType]);

  const isSupervisor = user?.role === "supervisor";

  const exportCsv = () => {
    const headers = ["timestamp", "actor", "role", "actor_branch", "action", "entity_type", "entity_id", "entity_label", "branch", "details"];
    const rows = entries.map((e) => [
      e.ts,
      e.actorName ?? "",
      e.actorRole,
      e.actorBranch ?? "",
      e.action,
      e.entityType,
      e.entityId ?? "",
      e.entityLabel ?? "",
      e.branch ?? "",
      JSON.stringify({ before: e.before, after: e.after, meta: e.meta }),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t.audit.exported);
  };

  const onClear = async () => {
    await clearAudit();
    setConfirmClear(false);
    toast.success(t.audit.cleared);
  };

  const summary = useMemo(() => entries.length, [entries]);

  return (
    <DashboardShell role={["admin"]} title={t.audit.title}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/admin" })}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <Back className="h-4 w-4" />
            {t.audit.back}
          </button>
          <p className="hidden text-sm text-muted-foreground sm:block">
            {t.audit.subtitle}
            {isSupervisor && user?.branch ? ` — ${user.branch}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={entries.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {t.audit.exportCsv}
          </button>
          {!isSupervisor && (
            <button
              onClick={() => setConfirmClear(true)}
              disabled={entries.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-destructive/30 px-3 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t.audit.clear}
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as "" | AuditAction)}
          className="h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
        >
          {ACTION_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value as "" | AuditEntityType)}
          className="h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
        >
          {ENTITY_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="flex h-10 items-center justify-end rounded-xl border border-border bg-surface px-3 text-sm text-muted-foreground">
          {t.audit.count}: <span className="ms-1 font-semibold text-foreground">{summary}</span>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={<ScrollText className="h-7 w-7" />} title={t.audit.empty} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className={dir === "rtl" ? "text-right" : "text-left"}>
                <th className="px-4 py-3 font-semibold">{t.audit.when}</th>
                <th className="px-4 py-3 font-semibold">{t.audit.actor}</th>
                <th className="px-4 py-3 font-semibold">{t.audit.action}</th>
                <th className="px-4 py-3 font-semibold">{t.audit.entity}</th>
                <th className="px-4 py-3 font-semibold">{t.audit.details}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border align-top hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-foreground">{e.actorName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.actorRole}{e.actorBranch ? ` · ${e.actorBranch}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      {e.action}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{e.entityLabel ?? e.entityId ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.entityType}{e.branch ? ` · ${e.branch}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <DiffCell entry={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        destructive
        title={t.audit.clearTitle}
        body={t.audit.clearBody}
        confirmLabel={t.audit.clearCta}
        cancelLabel={t.audit.cancel}
        onConfirm={onClear}
        onClose={() => setConfirmClear(false)}
      />
    </DashboardShell>
  );
}

function DiffCell({ entry }: { entry: AuditEntry }) {
  const { before, after, meta } = entry;
  if (entry.action === "request.status_changed" && before && after) {
    const b = (before as { status?: string }).status;
    const a = (after as { status?: string }).status;
    return <span><b className="text-foreground">{b}</b> → <b className="text-foreground">{a}</b></span>;
  }
  if (entry.action === "agent.updated" && meta && Array.isArray((meta as any).changed)) {
    return <span>{((meta as any).changed as string[]).join(", ")}</span>;
  }
  if (entry.action === "agent.created" || entry.action === "agent.deleted") {
    const obj = (after ?? before) as { branch?: string; email?: string } | undefined;
    return <span>{obj?.email ?? ""}{obj?.branch ? ` · ${obj.branch}` : ""}</span>;
  }
  return <span>—</span>;
}
