import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState } from "@/components/EmptyState";
import { AgentFormDialog, type AgentFormValues } from "@/components/AgentFormDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useLang } from "@/i18n/LanguageProvider";
import {
  approveAgent,
  canDeleteAgents,
  createAgent, deleteAgent, getAgents, getBranches, getCurrentUser, listBranches, refreshCurrentUser,
  subscribeAgents, updateAgent, type Agent, type AgentRole, type AuthUser, type StaffType,
} from "@/services/api";

export const Route = createFileRoute("/agents")({
  component: AdminAgents,
});

type TabKey = "supervisor" | "underwriter" | "sales";

function AdminAgents() {
  const { t, dir } = useLang();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("underwriter");
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [dialog, setDialog] = useState<{ open: boolean; mode: "create" | "edit"; target?: Agent }>({
    open: false, mode: "create",
  });
  const [confirmTarget, setConfirmTarget] = useState<Agent | null>(null);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const isSupervisor = user?.role === "supervisor";
  const isAdmin = user?.role === "admin";
  const lockedBranch = isSupervisor ? user?.branch : undefined;
  const canDelete = canDeleteAgents(user);
  const isSelf = (a: Agent) =>
    !!user &&
    ((a.userId && a.userId === user.id) ||
      (!!a.email && !!user.email && a.email.toLowerCase() === user.email.toLowerCase()));

  // Effective tab — supervisors can't see the Supervisors tab.
  const effectiveTab: TabKey = isSupervisor && tab === "supervisor" ? "underwriter" : tab;

  const branches = useMemo(() => listBranches(), []);

  const filteredAgents = useMemo(() => {
    return allAgents.filter((a) => {
      const role = a.role ?? "agent";
      if (effectiveTab === "supervisor") {
        if (role !== "supervisor") return false;
      } else {
        if (role !== "agent") return false;
        const st = a.staffType ?? "underwriter";
        if (st !== effectiveTab) return false;
      }
      if (isAdmin && branchFilter && a.branch !== branchFilter) return false;
      return true;
    });
  }, [allAgents, effectiveTab, branchFilter, isAdmin]);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u || (u.role !== "admin" && u.role !== "supervisor")) { navigate({ to: "/login" }); return; }
    setUser(u);
    let alive = true;
    const refresh = () => {
      getAgents().then((list) => {
        if (!alive) return;
        const visible = u.role === "supervisor" && u.branch
          ? list.filter((a) => a.branch === u.branch || a.createdByUserId === u.id)
          : list;
        setAllAgents(visible);
        setLoading(false);
      });
    };
    refreshCurrentUser().then((fresh) => {
      if (!alive) return;
      if (!fresh || (fresh.role !== "admin" && fresh.role !== "supervisor")) { navigate({ to: "/login" }); return; }
      setUser(fresh);
      getBranches().catch(() => {});
      refresh();
    });
    const off = subscribeAgents(refresh);
    return () => { alive = false; off(); };
  }, [navigate]);

  const onCreate = async (v: AgentFormValues) => {
    await createAgent({
      id: v.agentId, name: v.name, email: v.email,
      password: v.password,
      branch: lockedBranch ?? v.branch,
      role: isSupervisor ? "agent" : v.role,
      staffType: (v.role === "agent" || isSupervisor) ? (v.staffType ?? (effectiveTab === "sales" ? "sales" : "underwriter")) : undefined,
      supervisorId: v.supervisorId || undefined,
    });
    toast.success(t.agents.created);
  };

  const onEdit = async (v: AgentFormValues) => {
    if (!dialog.target) return;
    try {
      await updateAgent(dialog.target.id, {
        name: v.name,
        branch: isSupervisor ? undefined : v.branch,
        email: v.email,
        staffType: v.role === "agent" ? v.staffType : undefined,
        supervisorId: v.supervisorId ? v.supervisorId : null,
        ...(v.password ? { password: v.password } : {}),
      });
      toast.success(t.agents.updated);
    } catch (e: any) {
      toast.error(e?.message ?? t.agents.saveFailed);
      throw e;
    }
  };

  const onToggle = async (a: Agent) => {
    try {
      await updateAgent(a.id, { active: !a.active });
      toast.success(t.agents.updated);
    } catch (e: any) {
      toast.error(e?.message ?? t.agents.saveFailed);
    }
  };

  const onApprove = async (a: Agent) => {
    await approveAgent(a.id);
    toast.success(t.agents.updated);
  };

  const onDelete = (a: Agent) => setConfirmTarget(a);

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    try {
      await deleteAgent(confirmTarget.id);
      toast.success(t.agents.deleted);
    } catch (e: any) {
      toast.error(e?.message ?? t.agents.saveFailed);
    }
  };

  const tabConfig: Record<TabKey, { label: string; addLabel: string; emptyLabel: string }> = {
    supervisor: { label: t.agents.tabSupervisors, addLabel: t.agents.addSupervisor, emptyLabel: t.agents.emptySupervisors },
    underwriter: { label: t.agents.tabUnderwriters, addLabel: t.agents.addUnderwriter, emptyLabel: t.agents.empty },
    sales: { label: t.agents.tabSales, addLabel: t.agents.addSales, emptyLabel: t.agents.empty },
  };
  const cur = tabConfig[effectiveTab];
  const lockedRoleForDialog: AgentRole | undefined = isSupervisor
    ? "agent"
    : (dialog.mode === "edit" ? dialog.target?.role : (effectiveTab === "supervisor" ? "supervisor" : "agent"));
  const lockedStaffTypeForDialog: StaffType | undefined =
    dialog.mode === "edit"
      ? (dialog.target?.staffType)
      : (effectiveTab === "underwriter" ? "underwriter" : effectiveTab === "sales" ? "sales" : undefined);

  const isAdminCreated = (a: Agent) => a.createdByRole === "admin" && isSupervisor;

  return (
    <DashboardShell role={["admin", "supervisor"]} title={isSupervisor ? t.agents.titleAgentsOnly : t.agents.title}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <Back className="h-4 w-4" />
            {t.agents.backToAdmin}
          </Link>
          <p className="hidden text-sm text-muted-foreground sm:block">{t.agents.subtitle}</p>
        </div>
        <button
          onClick={() => setDialog({ open: true, mode: "create" })}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft transition active:scale-95"
        >
          <Plus className="h-4 w-4" />
          {cur.addLabel}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" className="inline-flex rounded-xl border border-border bg-surface p-1 text-sm">
          {(isAdmin ? (["supervisor", "underwriter", "sales"] as TabKey[]) : (["underwriter", "sales"] as TabKey[])).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={effectiveTab === k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-4 py-2 font-semibold transition ${
                effectiveTab === k ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tabConfig[k].label}
            </button>
          ))}
        </div>

        {isAdmin && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="h-10 rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
          >
            <option value="">{t.agents.filterBranchAll}</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className={dir === "rtl" ? "text-right" : "text-left"}>
              <th className="px-5 py-3 font-semibold">{t.agents.fullName}</th>
              <th className="px-5 py-3 font-semibold">{t.agents.agentId}</th>
              <th className="px-5 py-3 font-semibold">{t.agents.email}</th>
              <th className="px-5 py-3 font-semibold">{t.agents.branch}</th>
              <th className="px-5 py-3 font-semibold">{t.agents.status}</th>
              <th className="px-5 py-3 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">…</td></tr>
            ) : filteredAgents.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-8">
                <EmptyState icon={<Users className="h-7 w-7" />} title={cur.emptyLabel} />
              </td></tr>
            ) : filteredAgents.map((a) => (
              <tr key={a.userId ?? a.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-5 py-4 font-semibold text-foreground">
                  {a.name}
                  {a.createdByRole === "admin" && (
                    <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{t.agents.adminBadge}</span>
                  )}
                </td>
                <td className="px-5 py-4 text-muted-foreground">{a.id}</td>
                <td className="px-5 py-4 text-muted-foreground">{a.email ?? "—"}</td>
                <td className="px-5 py-4 text-muted-foreground">{a.branch ?? "—"}</td>
                <td className="px-5 py-4">
                  <StatusPill agent={a} t={t} />
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-2">
                    {isAdmin && a.pendingApproval && (
                      <IconBtn label={t.agents.approve} onClick={() => onApprove(a)}>
                        <Check className="h-4 w-4" />
                      </IconBtn>
                    )}
                    {isAdminCreated(a) ? (
                      <IconBtn disabledLook label={t.agents.noEditAdminCreated} onClick={() => toast.error(t.agents.noEditAdminCreated)}>
                        <Pencil className="h-4 w-4" />
                      </IconBtn>
                    ) : (
                      <IconBtn label={t.agents.edit} onClick={() => setDialog({ open: true, mode: "edit", target: a })}>
                        <Pencil className="h-4 w-4" />
                      </IconBtn>
                    )}
                    {isSelf(a) ? (
                      <IconBtn disabledLook label={t.agents.selfNoSuspend} onClick={() => toast.error(t.agents.selfNoSuspend)}>
                        <Power className="h-4 w-4" />
                      </IconBtn>
                    ) : isAdminCreated(a) ? (
                      <IconBtn disabledLook label={t.agents.noEditAdminCreated} onClick={() => toast.error(t.agents.noEditAdminCreated)}>
                        <Power className="h-4 w-4" />
                      </IconBtn>
                    ) : (
                      <IconBtn label={a.active ? t.agents.suspend : t.agents.activate} onClick={() => onToggle(a)}>
                        <Power className="h-4 w-4" />
                      </IconBtn>
                    )}
                    {isSelf(a) ? (
                      <IconBtn danger disabledLook label={t.agents.selfNoDelete} onClick={() => toast.error(t.agents.selfNoDelete)}>
                        <Trash2 className="h-4 w-4" />
                      </IconBtn>
                    ) : isAdminCreated(a) ? (
                      <IconBtn danger disabledLook label={t.agents.noDeleteAdminCreated} onClick={() => toast.error(t.agents.noDeleteAdminCreated)}>
                        <Trash2 className="h-4 w-4" />
                      </IconBtn>
                    ) : canDelete || (isSupervisor && a.createdByUserId === user?.id) ? (
                      <IconBtn danger label={t.agents.delete} onClick={() => onDelete(a)}>
                        <Trash2 className="h-4 w-4" />
                      </IconBtn>
                    ) : (
                      <IconBtn danger disabledLook label={t.agents.supervisorNoDelete} onClick={() => toast.error(t.agents.supervisorNoDelete)}>
                        <Trash2 className="h-4 w-4" />
                      </IconBtn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {!loading && filteredAgents.length === 0 ? (
          <EmptyState icon={<Users className="h-7 w-7" />} title={cur.emptyLabel} />
        ) : filteredAgents.map((a) => (
          <div key={a.userId ?? a.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-foreground">{a.name}</div>
                <div className="text-xs text-muted-foreground">{a.id} · {a.branch ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{a.email ?? "—"}</div>
              </div>
              <StatusPill agent={a} t={t} />
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              {isAdmin && a.pendingApproval && (
                <IconBtn label={t.agents.approve} onClick={() => onApprove(a)}>
                  <Check className="h-4 w-4" />
                </IconBtn>
              )}
              <IconBtn label={t.agents.edit} onClick={() => setDialog({ open: true, mode: "edit", target: a })}>
                <Pencil className="h-4 w-4" />
              </IconBtn>
              {!isSelf(a) && !isAdminCreated(a) && (
                <IconBtn label={a.active ? t.agents.suspend : t.agents.activate} onClick={() => onToggle(a)}>
                  <Power className="h-4 w-4" />
                </IconBtn>
              )}
              {(canDelete || (isSupervisor && a.createdByUserId === user?.id)) && !isSelf(a) && !isAdminCreated(a) && (
                <IconBtn danger label={t.agents.delete} onClick={() => onDelete(a)}>
                  <Trash2 className="h-4 w-4" />
                </IconBtn>
              )}
            </div>
          </div>
        ))}
      </div>

      <AgentFormDialog
        open={dialog.open}
        mode={dialog.mode}
        initial={dialog.target}
        lockedBranch={lockedBranch}
        lockedRole={lockedRoleForDialog}
        defaultRole={effectiveTab === "supervisor" ? "supervisor" : "agent"}
        lockedStaffType={lockedStaffTypeForDialog}
        defaultStaffType={effectiveTab === "sales" ? "sales" : "underwriter"}
        onClose={() => setDialog({ open: false, mode: "create" })}
        onSubmit={dialog.mode === "create" ? onCreate : onEdit}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        destructive
        title={`${t.agents.deleteWarningTitle}${confirmTarget ? ` — ${confirmTarget.name}` : ""}`}
        body={t.agents.deleteWarningBody}
        confirmLabel={t.agents.deleteConfirmCta}
        cancelLabel={t.agents.cancel}
        onConfirm={confirmDelete}
        onClose={() => setConfirmTarget(null)}
      />
    </DashboardShell>
  );
}

function StatusPill({ agent, t }: { agent: Agent; t: any }) {
  if (agent.pendingApproval) {
    return (
      <span className="inline-flex items-center rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning-foreground">
        {t.agents.pendingApproval}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
      agent.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
    }`}>
      {agent.active ? t.agents.active : t.agents.suspended}
    </span>
  );
}

function IconBtn({
  children, onClick, label, danger, disabledLook,
}: { children: React.ReactNode; onClick: () => void; label: string; danger?: boolean; disabledLook?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition active:scale-95 ${
        disabledLook
          ? "cursor-not-allowed border-border text-muted-foreground/60 opacity-60 hover:bg-muted/40"
          : danger
            ? "border-destructive/30 text-destructive hover:bg-destructive/10"
            : "border-border text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
