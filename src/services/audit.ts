/**
 * Audit log — DEMO MODE (localStorage).
 *
 * Records who did what and when. Mirrors the schema we'll use later when we
 * move to a real backend (see docs/audit-schema.sql), so the migration is
 * almost a copy/paste.
 */

import { getCurrentUser, type Role } from "./api";

export type AuditAction =
  // Requests
  | "request.status_changed"
  | "request.created"
  // Agents
  | "agent.created"
  | "agent.updated"
  | "agent.activated"
  | "agent.deactivated"
  | "agent.deleted"
  // Auth
  | "auth.login"
  | "auth.logout";

export type AuditEntityType = "request" | "agent" | "auth";

export type AuditEntry = {
  id: string;
  ts: string;                  // ISO timestamp
  actorId: string | null;
  actorName: string | null;
  actorRole: Role | "anonymous";
  actorBranch?: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | null;     // request id, agent id, or user id
  entityLabel?: string | null; // human label (agent name, REQ-id, etc.)
  branch?: string | null;      // branch the entity belongs to (for filtering)
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
};

const KEY = "aib_audit_log";
const EVENT = "aib:audit-changed";
const MAX_ENTRIES = 2000; // cap to keep localStorage healthy

function read(): AuditEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuditEntry[]) : [];
  } catch {
    return [];
  }
}

function write(list: AuditEntry[]) {
  if (typeof window === "undefined") return;
  const trimmed = list.length > MAX_ENTRIES ? list.slice(0, MAX_ENTRIES) : list;
  localStorage.setItem(KEY, JSON.stringify(trimmed));
  window.dispatchEvent(new CustomEvent(EVENT));
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "a-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Record a single event. Safe to call from anywhere; failures are swallowed. */
export function logEvent(input: {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  entityLabel?: string | null;
  branch?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  /** Override actor (e.g. login event before session is set) */
  actor?: { id: string; name: string; role: Role | "anonymous"; branch?: string | null };
}) {
  try {
    const u = input.actor ?? getCurrentUser();
    const entry: AuditEntry = {
      id: uid(),
      ts: new Date().toISOString(),
      actorId: u?.id ?? null,
      actorName: u?.name ?? null,
      actorRole: (u?.role ?? "anonymous") as Role | "anonymous",
      actorBranch: (u && "branch" in u ? u.branch : null) ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      branch: input.branch ?? null,
      before: input.before,
      after: input.after,
      meta: input.meta,
    };
    const list = read();
    list.unshift(entry);
    write(list);
  } catch {
    // never break the app because audit failed
  }
}

export function listAudit(opts?: {
  branch?: string;        // filter by entity branch (for supervisors)
  action?: AuditAction;
  entityType?: AuditEntityType;
  actorRole?: Role;
  since?: string;         // ISO
  until?: string;         // ISO
  limit?: number;
}): AuditEntry[] {
  let out = read();
  if (opts?.branch) out = out.filter((e) => e.branch === opts.branch || e.actorBranch === opts.branch);
  if (opts?.action) out = out.filter((e) => e.action === opts.action);
  if (opts?.entityType) out = out.filter((e) => e.entityType === opts.entityType);
  if (opts?.actorRole) out = out.filter((e) => e.actorRole === opts.actorRole);
  if (opts?.since) out = out.filter((e) => e.ts >= opts.since!);
  if (opts?.until) out = out.filter((e) => e.ts <= opts.until!);
  if (opts?.limit) out = out.slice(0, opts.limit);
  return out;
}

export function subscribeAudit(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function clearAudit() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent(EVENT));
}
