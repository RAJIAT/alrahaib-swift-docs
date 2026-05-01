import { useEffect, useMemo, useState } from "react";
import { Lock, Loader2, X } from "lucide-react";
import { useLang } from "@/i18n/LanguageProvider";
import { getBranches, listAgents, listBranches, type Agent, type AgentRole } from "@/services/api";

export type AgentFormValues = {
  name: string;
  email: string;
  password: string;
  agentId: string;
  branch: string;
  role: AgentRole;
  supervisorId?: string;
};

export function AgentFormDialog({
  open, mode, initial, onClose, onSubmit, lockedBranch, lockedRole, defaultRole,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial?: Agent;
  onClose: () => void;
  onSubmit: (values: AgentFormValues) => Promise<void>;
  lockedBranch?: string;
  /** When set, hides the role selector and forces this role. */
  lockedRole?: AgentRole;
  /** Initial role for create mode (when lockedRole is not set). */
  defaultRole?: AgentRole;
}) {
  const { t, dir } = useLang();
  const [values, setValues] = useState<AgentFormValues>({
    name: "", email: "", password: "", agentId: "",
    branch: listBranches()[0] ?? "",
    role: lockedRole ?? defaultRole ?? "agent",
    supervisorId: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const supervisors = useMemo(() => listAgents().filter((a) => a.role === "supervisor"), [open]);

  const [branches, setBranches] = useState<string[]>(() => listBranches());

  useEffect(() => {
    if (!open) return;
    setError("");
    // Refresh branches when dialog opens so the dropdown is never empty.
    getBranches().then(() => setBranches(listBranches())).catch(() => {});
    setValues({
      name: initial?.name ?? "",
      email: initial?.email ?? "",
      password: "",
      agentId: initial?.id ?? "",
      branch: lockedBranch ?? initial?.branch ?? (listBranches()[0] ?? ""),
      role: lockedRole ?? initial?.role ?? defaultRole ?? "agent",
      supervisorId: initial?.supervisorId ?? "",
    });
  }, [open, initial, lockedBranch, lockedRole, defaultRole]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!values.name.trim() || !values.email.trim() || !values.agentId.trim()) {
      setError(t.agents.fillAll);
      return;
    }
    if (mode === "create" && values.password.length < 6) {
      setError(t.agents.passwordTooShort);
      return;
    }
    setLoading(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err: any) {
      setError(err?.message || t.agents.saveFailed);
    } finally {
      setLoading(false);
    }
  };

  const isSupervisorForm = (lockedRole ?? values.role) === "supervisor";
  const titleCreate = isSupervisorForm ? t.agents.addSupervisorTitle : t.agents.addTitle;
  const titleEdit = isSupervisorForm ? t.agents.editSupervisorTitle : t.agents.editTitle;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" dir={dir}>
      <div className="w-full max-w-lg overflow-hidden rounded-t-2xl bg-card shadow-elevated sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-foreground">
            {mode === "create" ? titleCreate : titleEdit}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-5">
          {lockedBranch && (
            <div
              role="note"
              className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-foreground"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="leading-relaxed">{t.agents.branchLockedNotice(lockedBranch)}</p>
            </div>
          )}
          <Field label={t.agents.fullName}>
            <input
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
            />
          </Field>

          {!lockedRole && mode === "create" && (
            <Field label={t.agents.role}>
              <select
                value={values.role}
                onChange={(e) => setValues((v) => ({ ...v, role: e.target.value as AgentRole }))}
                className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
              >
                <option value="agent">{t.agents.roleAgent}</option>
                <option value="supervisor">{t.agents.roleSupervisor}</option>
              </select>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.agents.email}>
              <input
                type="email"
                disabled={mode === "edit"}
                value={values.email}
                onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
                className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground disabled:opacity-60"
              />
            </Field>
            <Field label={t.agents.agentId}>
              <input
                disabled={mode === "edit"}
                value={values.agentId}
                onChange={(e) => setValues((v) => ({ ...v, agentId: e.target.value.toUpperCase() }))}
                placeholder="A123"
                name={`agent-id-${Math.random().toString(36).slice(2, 8)}`}
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                readOnly
                onFocus={(e) => e.currentTarget.removeAttribute("readonly")}
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground disabled:opacity-60"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.agents.branch}>
              <select
                value={values.branch}
                onChange={(e) => setValues((v) => ({ ...v, branch: e.target.value }))}
                disabled={!!lockedBranch}
                className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground disabled:opacity-60"
              >
                {branches.length === 0 && <option value="">—</option>}
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              {lockedBranch && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {t.agents.branchLockedHint}
                </p>
              )}
            </Field>
            <Field label={mode === "create" ? t.agents.password : t.agents.newPassword}>
              <input
                type="password"
                value={values.password}
                onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
                placeholder={mode === "edit" ? t.agents.leaveBlank : "••••••••"}
                className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
              />
            </Field>
          </div>

          {!isSupervisorForm && (
            <Field label={t.agents.supervisorLabel ?? "السوبرفايزر"}>
              <select
                value={values.supervisorId ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, supervisorId: e.target.value }))}
                className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-sm text-foreground"
              >
                <option value="">{t.agents.supervisorAuto ?? "تلقائي حسب الفرع"}</option>
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.branch ? ` — ${s.branch}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground"
            >
              {t.agents.cancel}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t.agents.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
