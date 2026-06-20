import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Inbox, Loader2, Sparkles, TrendingUp, X } from "lucide-react";
import * as XLSX from "xlsx";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useLang } from "@/i18n/LanguageProvider";
import { useRequestsLive } from "@/hooks/useRequestsLive";
import {
  approveAgentRemoval, dismissAgentRemoval,
  enforceActiveSession, listAgents, getAgents, listBranches,
  subscribeAgents, getApprovalRequired, setApprovalRequired, subscribeSettings,
  type Agent, type AuthUser, type RequestStatus,
} from "@/services/api";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const { t, dir, lang } = useLang();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);

  const isSupervisor = user?.role === "supervisor";
  const lockedBranch = isSupervisor ? user?.branch ?? "" : "";

  const { items, loading } = useRequestsLive(
    !user ? {} : isSupervisor ? { branch: lockedBranch } : undefined,
  );

  const [agentF, setAgentF] = useState("");
  const [branchF, setBranchF] = useState(lockedBranch);
  const [statusF, setStatusF] = useState<"" | RequestStatus>("");
  const [dateF, setDateF] = useState("");
  const [searchF, setSearchF] = useState("");
  const [isPending, startTransition] = useTransition();

  // Stable agents/branches snapshot — refreshed only on subscription change.
  const [agents, setAgents] = useState<Agent[]>(() => listAgents());
  const [approvalReq, setApprovalReq] = useState<boolean>(() => getApprovalRequired());
  const allBranches = useMemo(() => listBranches(), []);
  useEffect(() => {
    const off = subscribeSettings(() => setApprovalReq(getApprovalRequired()));
    return () => off();
  }, []);
  const pendingCount = useMemo(() => agents.filter((a) => a.pendingApproval).length, [agents]);
  const pendingRemovals = useMemo(() => agents.filter((a) => a.removalRequest), [agents]);
  const branches = useMemo(
    () => (isSupervisor && lockedBranch ? [lockedBranch] : allBranches),
    [isSupervisor, lockedBranch, allBranches],
  );

  useEffect(() => {
    enforceActiveSession(["admin", "supervisor"]).then((fresh) => {
      if (!fresh || (fresh.role !== "admin" && fresh.role !== "supervisor")) { navigate({ to: "/login" }); return; }
      setUser(fresh);
    });
    getAgents().then(setAgents).catch(() => {});
    const off = subscribeAgents(() => setAgents(listAgents()));
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Defer date input — only field that fires per keystroke.
  const deferredDate = useDeferredValue(dateF);
  const deferredSearch = useDeferredValue(searchF);

  const agentNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);

  const supervisorByAgentId = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) {
      if (a.role === "agent" && a.supervisorId) {
        const sup = agents.find((x) => x.id === a.supervisorId);
        if (sup) m.set(a.id, sup.name);
      }
    }
    return m;
  }, [agents]);

  const agentById = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const resolveUnderwriterName = (r: typeof items[number]): string => {
    const owner = agentById.get(r.agentId);
    if (owner && owner.staffType === "underwriter") return owner.name;
    const checkSales = (id?: string) => {
      if (!id) return undefined;
      const a = agentById.get(id);
      if (a && a.staffType === "sales" && a.assignedUnderwriterId) {
        const uw = agentById.get(a.assignedUnderwriterId);
        if (uw) return uw.name;
      }
      return undefined;
    };
    return checkSales(r.agentId) ?? checkSales(r.originAgentId) ?? t.table.notAssigned;
  };

  const agentOptions = useMemo(
    () => agents.map((a) => ({ value: a.id, label: a.name })),
    [agents],
  );
  const branchOptions = useMemo(
    () => branches.map((b) => ({ value: b, label: b })),
    [branches],
  );
  const statusOptions = useMemo(
    () =>
      (["new", "quoted", "linkSent", "processing", "sold", "rejected", "reupload"] as RequestStatus[]).map((s) => ({
        value: s,
        label: t.status[s],
      })),
    [t],
  );

  const filtered = useMemo(
    () =>
      items.filter((r) => {
        if (agentF && r.agentId !== agentF) return false;
        if (branchF && r.branch !== branchF) return false;
        if (statusF && r.status !== statusF) return false;
        if (deferredDate && !r.createdAt.startsWith(deferredDate)) return false;
        if (deferredSearch) {
          const q = deferredSearch.trim().toLowerCase();
          const hay = `${r.id} ${r.customerName ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [items, agentF, branchF, statusF, deferredDate, deferredSearch],
  );

  const today = new Date().toISOString().slice(0, 10);
  const stats = useMemo(
    () => ({
      total: items.length,
      newReq: items.filter((r) => r.status === "new").length,
      sales: items.filter((r) => r.status === "sold").length,
      today: items.filter((r) => r.createdAt.startsWith(today)).length,
    }),
    [items, today],
  );

  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;
  const reset = () => startTransition(() => {
    setAgentF(""); setBranchF(""); setStatusF(""); setDateF(""); setSearchF("");
  });

  const wrap = (fn: (v: string) => void) => (v: string) => startTransition(() => fn(v));

  const activeChips: { label: string; clear: () => void }[] = [];
  if (agentF) activeChips.push({ label: `${t.admin.filterAgent}: ${agentNameMap.get(agentF) ?? agentF}`, clear: () => startTransition(() => setAgentF("")) });
  if (branchF) activeChips.push({ label: `${t.admin.filterBranch}: ${branchF}`, clear: () => startTransition(() => setBranchF("")) });
  if (statusF) activeChips.push({ label: `${t.admin.filterStatus}: ${t.status[statusF]}`, clear: () => startTransition(() => setStatusF("")) });
  if (dateF) activeChips.push({ label: `${t.admin.filterDate}: ${dateF}`, clear: () => startTransition(() => setDateF("")) });

  const exportExcel = () => {
    const rows = filtered.map((r) => ({
      [t.table.requestId]: r.id,
      [t.table.customer]: r.customerName ?? "",
      [t.table.agent]: r.agentName,
      [t.table.underwriter]: resolveUnderwriterName(r),
      [t.table.branch]: r.branch,
      [t.table.date]: new Date(r.createdAt).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
        dateStyle: "medium", timeStyle: "short",
      }),
      [t.table.status]: t.status[r.status],
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Requests");
    XLSX.writeFile(wb, "requests-log-export.xlsx");
  };

  return (
    <DashboardShell role={["admin", "supervisor"]} title={isSupervisor ? `${t.admin.supervisorTitle} — ${lockedBranch}` : t.admin.title}>
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t.admin.total} value={stats.total} icon={<FileText className="h-5 w-5" />} tone="primary" />
        <StatCard label={t.admin.newReq} value={stats.newReq} icon={<Sparkles className="h-5 w-5" />} tone="info" />
        <StatCard label={t.admin.sales} value={stats.sales} icon={<TrendingUp className="h-5 w-5" />} tone="success" />
        <StatCard label={t.admin.today} value={stats.today} icon={<CalendarDays className="h-5 w-5" />} tone="warning" />
      </div>

      {!isSupervisor && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">{t.agents.requireApprovalSetting}</div>
            <div className="text-xs text-muted-foreground">{t.agents.requireApprovalHint}</div>
            {pendingCount > 0 && (
              <div className="mt-1 inline-flex items-center rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning-foreground">
                {pendingCount} {t.agents.pendingApproval}
              </div>
            )}
          </div>
          <Switch checked={approvalReq} onCheckedChange={(v) => { setApprovalReq(v); setApprovalRequired(v); }} />
        </div>
      )}

      {!isSupervisor && pendingRemovals.length > 0 && (
        <div className="mt-4 rounded-2xl border border-warning/40 bg-warning/5 p-4 shadow-card">
          <div className="mb-3">
            <div className="text-sm font-semibold text-foreground">{t.agents.pendingRemovalsTitle}</div>
            <div className="text-xs text-muted-foreground">{t.agents.pendingRemovalsHint}</div>
          </div>
          <div className="space-y-2">
            {pendingRemovals.map((a) => (
              <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="min-w-0 text-sm">
                  <div className="font-bold text-foreground">{a.name} <span className="text-xs font-normal text-muted-foreground">· {a.branch}</span></div>
                  <div className="text-xs text-muted-foreground">
                    {t.agents.requestedBy}: {a.removalRequest?.requestedByName} · {a.removalRequest && new Date(a.removalRequest.requestedAt).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-foreground"><b>{t.agents.reason}:</b> {a.removalRequest?.reason}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => { try { await dismissAgentRemoval(a.id); toast.success(t.agents.removalDismissed); } catch (e: any) { toast.error(e?.message); } }}
                    className="h-9 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    {t.agents.removalDismiss}
                  </button>
                  <button
                    onClick={async () => { try { await approveAgentRemoval(a.id); toast.success(t.agents.removalApproved); } catch (e: any) { toast.error(e?.message); } }}
                    className="h-9 rounded-lg bg-destructive px-3 text-xs font-semibold text-destructive-foreground"
                  >
                    {t.agents.removalApprove}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select value={agentF} onChange={wrap(setAgentF)} label={t.admin.filterAgent} all={t.admin.all}
            options={agentOptions} />
          <Select value={branchF} onChange={wrap(setBranchF)} label={t.admin.filterBranch} all={t.admin.all}
            options={branchOptions} disabled={isSupervisor} />
          <Select value={statusF} onChange={(v) => startTransition(() => setStatusF(v as RequestStatus | ""))} label={t.admin.filterStatus} all={t.admin.all}
            options={statusOptions} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{t.admin.filterDate}</span>
            <input
              type="date"
              value={dateF}
              onChange={(e) => setDateF(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
            />
          </label>
          <button
            onClick={reset}
            className="h-11 self-end rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted active:scale-95"
          >
            {t.admin.reset}
          </button>
        </div>
        {(activeChips.length > 0 || isPending) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeChips.length > 0 && (
              <span className="text-xs font-semibold text-muted-foreground">{t.admin.activeFilters}:</span>
            )}
            {activeChips.map((c, i) => (
              <button
                key={i}
                onClick={c.clear}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary-soft/70"
              >
                {c.label}
                <X className="h-3 w-3" />
              </button>
            ))}
            {isPending && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-xs font-semibold text-info animate-fade-in">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t.common.filtering}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="mt-6 hidden overflow-hidden rounded-2xl border border-border bg-card shadow-card md:block">
        <div className="flex items-center justify-end border-b border-border bg-muted/30 px-4 py-2">
          <button
            onClick={exportExcel}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.table.downloadExcel}
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className={dir === "rtl" ? "text-right" : "text-left"}>
              <th className="px-5 py-3 font-semibold">{t.table.requestId}</th>
              <th className="px-5 py-3 font-semibold">{t.table.customer}</th>
              <th className="px-5 py-3 font-semibold">{t.table.agent}</th>
              <th className="px-5 py-3 font-semibold">{t.table.underwriter}</th>
              <th className="px-5 py-3 font-semibold">{t.table.branch}</th>
              <th className="px-5 py-3 font-semibold">{t.table.date}</th>
              <th className="px-5 py-3 font-semibold">{t.table.status}</th>
              <th className="px-5 py-3 font-semibold">{t.table.action}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-8">
                <EmptyState
                  icon={<Inbox className="h-7 w-7" />}
                  title={t.admin.emptyTitle}
                  subtitle={t.admin.emptySubtitle}
                />
              </td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-border transition hover:bg-muted/30">
                  <td className="px-5 py-4 font-semibold text-foreground">{r.id}</td>
                  <td className="px-5 py-4 text-foreground">{r.customerName ?? "—"}</td>
                  <td className="px-5 py-4 text-foreground">
                    <div>{r.agentName}</div>
                    {!isSupervisor && supervisorByAgentId.get(r.agentId) && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t.agents.supervisorPrefix}
                        {supervisorByAgentId.get(r.agentId)}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-foreground">{resolveUnderwriterName(r)}</td>
                  <td className="px-5 py-4 text-muted-foreground">{r.branch}</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
                      dateStyle: "medium", timeStyle: "short",
                    })}
                  </td>
                  <td className="px-5 py-4"><StatusBadge status={r.status} /></td>
                  <td className="px-5 py-4">
                    <Link
                      to="/requests/$id"
                      params={{ id: r.id }}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary-soft px-3 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary-soft/70 active:scale-95"
                    >
                      {t.table.view} <Chevron className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="mt-6 space-y-3 md:hidden">
        {filtered.length === 0 && !loading ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title={t.admin.emptyTitle}
            subtitle={t.admin.emptySubtitle}
          />
        ) : (
          filtered.map((r) => (
            <Link
              key={r.id}
              to="/requests/$id"
              params={{ id: r.id }}
              className="block animate-fade-in rounded-2xl border border-border bg-card p-4 shadow-card transition active:scale-[0.99]"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground">{r.id}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-2 text-sm text-foreground">{r.agentName}</div>
              {!isSupervisor && supervisorByAgentId.get(r.agentId) && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {t.agents.supervisorPrefix}
                  {supervisorByAgentId.get(r.agentId)}
                </div>
              )}
              <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>{r.branch}</span>
                <span>{new Date(r.createdAt).toLocaleDateString(lang === "ar" ? "ar-AE" : "en-GB")}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </DashboardShell>
  );
}

function StatCard({
  label, value, icon, tone,
}: { label: string; value: number; icon: React.ReactNode; tone: "primary" | "info" | "success" | "warning" }) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning-foreground",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card transition hover:shadow-elevated">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="mt-3 text-3xl font-bold text-foreground">{value}</div>
    </div>
  );
}

function Select({
  value, onChange, label, all, options, disabled,
}: {
  value: string; onChange: (v: string) => void; label: string; all: string;
  options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
