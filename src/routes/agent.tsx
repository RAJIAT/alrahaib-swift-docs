import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Inbox } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useLang } from "@/i18n/LanguageProvider";
import { useRequestsLive } from "@/hooks/useRequestsLive";
import { getCurrentUser, type AuthUser } from "@/services/api";

export const Route = createFileRoute("/agent")({
  component: AgentDashboard,
});

function AgentDashboard() {
  const { t, dir, lang } = useLang();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u || u.role !== "agent") {
      navigate({ to: "/login" });
      return;
    }
    setUser(u);
  }, [navigate]);

  const { items, loading } = useRequestsLive({ agentId: user?.agentId });

  const stats = useMemo(
    () => ({
      total: items.length,
      newReq: items.filter((r) => r.status === "new").length,
      sales: items.filter((r) => r.status === "sold").length,
    }),
    [items],
  );

  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;

  if (!user) return null;

  return (
    <DashboardShell role="agent" title={t.nav.requests}>
      {/* Header strip */}
      <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-card animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {t.agent.welcome}, {user.name}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t.agent.yoursOnly}</div>
          </div>
          <div className="flex items-center gap-2">
            <Chip label={t.agent.statsTotal} value={stats.total} tone="primary" />
            <Chip label={t.agent.statsNew} value={stats.newReq} tone="info" />
            <Chip label={t.agent.statsSold} value={stats.sales} tone="success" />
          </div>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className={dir === "rtl" ? "text-right" : "text-left"}>
              <th className="px-5 py-3 font-semibold">{t.table.requestId}</th>
              <th className="px-5 py-3 font-semibold">{t.table.date}</th>
              <th className="px-5 py-3 font-semibold">{t.table.status}</th>
              <th className="px-5 py-3 font-semibold">{t.table.action}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-5 py-12 text-center text-muted-foreground">…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-8">
                <EmptyState
                  icon={<Inbox className="h-7 w-7" />}
                  title={t.agent.emptyTitle}
                  subtitle={t.agent.emptySubtitle}
                />
              </td></tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="border-t border-border transition hover:bg-muted/30">
                  <td className="px-5 py-4 font-semibold text-foreground">{r.id}</td>
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
      <div className="space-y-3 md:hidden">
        {loading ? (
          <p className="py-8 text-center text-muted-foreground">…</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title={t.agent.emptyTitle}
            subtitle={t.agent.emptySubtitle}
          />
        ) : (
          items.map((r) => (
            <Link
              key={r.id}
              to="/requests/$id"
              params={{ id: r.id }}
              className="flex animate-fade-in items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card transition active:scale-[0.99]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-foreground">{r.id}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
                    dateStyle: "medium", timeStyle: "short",
                  })}
                </div>
              </div>
              <Chevron className="h-5 w-5 text-muted-foreground" />
            </Link>
          ))
        )}
      </div>
    </DashboardShell>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone: "primary" | "info" | "success" }) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      <span className="opacity-80">{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  );
}
