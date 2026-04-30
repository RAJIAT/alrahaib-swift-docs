import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { EmptyState } from "@/components/EmptyState";
import { AgentFormDialog, type AgentFormValues } from "@/components/AgentFormDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useLang } from "@/i18n/LanguageProvider";
import {
  canDeleteAgents,
  createAgent, deleteAgent, getAgents, getCurrentUser, refreshCurrentUser,
  subscribeAgents, updateAgent, type Agent, type AuthUser,
} from "@/services/api";

export const Route = createFileRoute("/agents")({
  component: AdminAgents,
});

function AdminAgents() {
  const { t, dir } = useLang();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; mode: "create" | "edit"; target?: Agent }>({
    open: false, mode: "create",
  });
  const [confirmTarget, setConfirmTarget] = useState<Agent | null>(null);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const isSupervisor = user?.role === "supervisor";
  const lockedBranch = isSupervisor ? user?.branch : undefined;
  const canDelete = canDeleteAgents(user);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u || (u.role !== "admin" && u.role !== "supervisor")) { navigate({ to: "/login" }); return; }
    setUser(u);
    let alive = true;
    const refresh = () => {
      getAgents().then((list) => {
        if (!alive) return;
        const filtered = u.role === "supervisor" && u.branch
          ? list.filter((a) => a.branch === u.branch)
          : list;
        setAgents(filtered);
        setLoading(false);
      });
    };
    refreshCurrentUser().then((fresh) => {
      if (!alive) return;
      if (!fresh || (fresh.role !== "admin" && fresh.role !== "supervisor")) { navigate({ to: "/login" }); return; }
      setUser(fresh);
      refresh();
    });
    const off = subscribeAgents(refresh);
    return () => { alive = false; off(); };
  }, [navigate]);

  const onCreate = async (v: AgentFormValues) => {
    await createAgent({
      id: v.agentId, name: v.name, email: v.email,
      branch: lockedBranch ?? v.branch,
    });
    toast.success(t.agents.created);
  };

  const onEdit = async (v: AgentFormValues) => {
    if (!dialog.target) return;
    await updateAgent(dialog.target.id, {
      name: v.name,
      branch: lockedBranch ?? v.branch,
      email: v.email,
    });
    toast.success(t.agents.updated);
  };

  const onToggle = async (a: Agent) => {
    await updateAgent(a.id, { active: !a.active });
    toast.success(t.agents.updated);
  };

  const onDelete = (a: Agent) => {
    setConfirmTarget(a);
  };

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    await deleteAgent(confirmTarget.id);
    toast.success(t.agents.deleted);
  };

  return (
    <DashboardShell role="admin" title={t.agents.title}>
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
          {t.agents.add}
        </button>
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
            ) : agents.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-8">
                <EmptyState icon={<Users className="h-7 w-7" />} title={t.agents.empty} />
              </td></tr>
            ) : agents.map((a) => (
              <tr key={a.userId ?? a.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-5 py-4 font-semibold text-foreground">{a.name}</td>
                <td className="px-5 py-4 text-muted-foreground">{a.id}</td>
                <td className="px-5 py-4 text-muted-foreground">{a.email ?? "—"}</td>
                <td className="px-5 py-4 text-muted-foreground">{a.branch ?? "—"}</td>
                <td className="px-5 py-4">
                  <StatusPill active={a.active} t={t} />
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-2">
                    <IconBtn label={t.agents.edit} onClick={() => setDialog({ open: true, mode: "edit", target: a })}>
                      <Pencil className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn label={a.active ? t.agents.suspend : t.agents.activate} onClick={() => onToggle(a)}>
                      <Power className="h-4 w-4" />
                    </IconBtn>
                    {canDelete ? (
                      <IconBtn danger label={t.agents.delete} onClick={() => onDelete(a)}>
                        <Trash2 className="h-4 w-4" />
                      </IconBtn>
                    ) : (
                      <IconBtn
                        danger
                        disabledLook
                        label={t.agents.supervisorNoDelete}
                        onClick={() => toast.error(t.agents.supervisorNoDelete)}
                      >
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
        {!loading && agents.length === 0 ? (
          <EmptyState icon={<Users className="h-7 w-7" />} title={t.agents.empty} />
        ) : agents.map((a) => (
          <div key={a.userId ?? a.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-foreground">{a.name}</div>
                <div className="text-xs text-muted-foreground">{a.id} · {a.branch ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{a.email ?? "—"}</div>
              </div>
              <StatusPill active={a.active} t={t} />
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <IconBtn label={t.agents.edit} onClick={() => setDialog({ open: true, mode: "edit", target: a })}>
                <Pencil className="h-4 w-4" />
              </IconBtn>
              <IconBtn label={a.active ? t.agents.suspend : t.agents.activate} onClick={() => onToggle(a)}>
                <Power className="h-4 w-4" />
              </IconBtn>
              {canDelete ? (
                <IconBtn danger label={t.agents.delete} onClick={() => onDelete(a)}>
                  <Trash2 className="h-4 w-4" />
                </IconBtn>
              ) : (
                <IconBtn
                  danger
                  disabledLook
                  label={t.agents.supervisorNoDelete}
                  onClick={() => toast.error(t.agents.supervisorNoDelete)}
                >
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

function StatusPill({ active, t }: { active: boolean; t: any }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
      active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
    }`}>
      {active ? t.agents.active : t.agents.suspended}
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
