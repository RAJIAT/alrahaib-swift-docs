import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Inbox, Sparkles, TrendingUp, X } from "lucide-react";
import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useLang } from "@/i18n/LanguageProvider";
import { useRequestsLive } from "@/hooks/useRequestsLive";
import {
  getCurrentUser, listAgents, listBranches,
  type RequestStatus,
} from "@/services/api";

export const Route = createFileRoute("/admin")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const { t, dir, lang } = useLang();
  const navigate = useNavigate();
  const { items, loading } = useRequestsLive();

  const [agentF, setAgentF] = useState("");
  const [branchF, setBranchF] = useState("");
  const [statusF, setStatusF] = useState<"" | RequestStatus>("");
  const [dateF, setDateF] = useState("");

  useEffect(() => {
    const u = getCurrentUser();
    if (!u || u.role !== "admin") navigate({ to: "/login" });
  }, [navigate]);

  const filtered = useMemo(
    () =>
      items.filter((r) => {
        if (agentF && r.agentId !== agentF) return false;
        if (branchF && r.branch !== branchF) return false;
        if (statusF && r.status !== statusF) return false;
        if (dateF && !r.createdAt.startsWith(dateF)) return false;
        return true;
      }),
    [items, agentF, branchF, statusF, dateF],
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
  const reset = () => { setAgentF(""); setBranchF(""); setStatusF(""); setDateF(""); };

  const agentName = (id: string) => listAgents().find((a) => a.id === id)?.name ?? id;

  const activeChips: { label: string; clear: () => void }[] = [];
  if (agentF) activeChips.push({ label: `${t.admin.filterAgent}: ${agentName(agentF)}`, clear: () => setAgentF("") });
  if (branchF) activeChips.push({ label: `${t.admin.filterBranch}: ${branchF}`, clear: () => setBranchF("") });
  if (statusF) activeChips.push({ label: `${t.admin.filterStatus}: ${t.status[statusF]}`, clear: () => setStatusF("") });
  if (dateF) activeChips.push({ label: `${t.admin.filterDate}: ${dateF}`, clear: () => setDateF("") });

  return (
    <DashboardShell role="admin" title={t.admin.title}>
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t.admin.total} value={stats.total} icon={<FileText className="h-5 w-5" />} tone="primary" />
        <StatCard label={t.admin.newReq} value={stats.newReq} icon={<Sparkles className="h-5 w-5" />} tone="info" />
        <StatCard label={t.admin.sales} value={stats.sales} icon={<TrendingUp className="h-5 w-5" />} tone="success" />
        <StatCard label={t.admin.today} value={stats.today} icon={<CalendarDays className="h-5 w-5" />} tone="warning" />
      </div>

      {/* Filters */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select value={agentF} onChange={setAgentF} label={t.admin.filterAgent} all={t.admin.all}
            options={listAgents().map((a) => ({ value: a.id, label: a.name }))} />
          <Select value={branchF} onChange={setBranchF} label={t.admin.filterBranch} all={t.admin.all}
            options={listBranches().map((b) => ({ value: b, label: b }))} />
          <Select value={statusF} onChange={(v) => setStatusF(v as RequestStatus | "")} label={t.admin.filterStatus} all={t.admin.all}
            options={(["new", "processing", "sold", "rejected", "reupload"] as RequestStatus[]).map((s) => ({ value: s, label: t.status[s] }))} />
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
            className="h-11 self-end rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground transition hover:bg-muted active:scale-95"
          >
            {t.admin.reset}
          </button>
        </div>
        {activeChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">{t.admin.activeFilters}:</span>
            {activeChips.map((c, i) => (
              <button
                key={i}
                onClick={c.clear}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary-soft/70"
              >
                {c.label}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="mt-6 hidden overflow-hidden rounded-2xl border border-border bg-card shadow-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className={dir === "rtl" ? "text-right" : "text-left"}>
              <th className="px-5 py-3 font-semibold">{t.table.requestId}</th>
              <th className="px-5 py-3 font-semibold">{t.table.agent}</th>
              <th className="px-5 py-3 font-semibold">{t.table.branch}</th>
              <th className="px-5 py-3 font-semibold">{t.table.date}</th>
              <th className="px-5 py-3 font-semibold">{t.table.status}</th>
              <th className="px-5 py-3 font-semibold">{t.table.action}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-8">
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
                  <td className="px-5 py-4 text-foreground">{r.agentName}</td>
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
  value, onChange, label, all, options,
}: {
  value: string; onChange: (v: string) => void; label: string; all: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
      >
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
