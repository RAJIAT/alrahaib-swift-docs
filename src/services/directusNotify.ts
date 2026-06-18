/**
 * Phase 3e — Notifications, audit log, and app settings on Directus.
 *
 * Collections (created by scripts/directus-bootstrap.ts):
 *  - notifications: recipient(uuid), kind, title, body, link, read, date_created
 *  - audit_log:     ts, actor(uuid), actor_role, actor_branch, action,
 *                   entity_type, entity_id, entity_label, branch, before, after, meta
 *  - app_settings:  singleton { require_admin_approval: boolean }
 *
 * The browser-facing surface keeps the legacy event names
 * (`aib:notifications-changed`, `aib:audit-changed`, `aib:settings-changed`)
 * so existing subscribers continue to work without changes.
 */

import { dxRequest } from "./directusClient";
import type {
  AppNotification,
  AppSettings,
  AuditEntry,
  NotificationKind,
  Role,
} from "./types";

const EVT = {
  notifications: "aib:notifications-changed",
  audit: "aib:audit-changed",
  settings: "aib:settings-changed",
} as const;

function emit(name: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name));
}

function sub(name: string, cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const fn = () => cb();
  window.addEventListener(name, fn);
  return () => window.removeEventListener(name, fn);
}

// ---------------- notifications ----------------

type DxNotificationRow = {
  id: string;
  recipient: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  read?: boolean | null;
  date_created?: string | null;
};

const N_FIELDS = "id,recipient,kind,title,body,link,read,date_created";

function rowToNotification(r: DxNotificationRow): AppNotification {
  return {
    id: r.id,
    recipientUserId: r.recipient,
    title: r.title,
    body: r.body ?? undefined,
    kind: r.kind,
    link: r.link ?? undefined,
    read: r.read === true,
    createdAt: r.date_created ?? new Date().toISOString(),
  };
}

export async function fetchNotificationsFor(userId: string, limit = 50): Promise<AppNotification[]> {
  if (!userId) return [];
  try {
    const r = await dxRequest<{ data: DxNotificationRow[] }>(
      `/items/notifications?fields=${N_FIELDS}&limit=${limit}&sort=-date_created&filter[recipient][_eq]=${encodeURIComponent(userId)}`,
    );
    return r.data.map(rowToNotification);
  } catch {
    return [];
  }
}

export type PushNotificationInput = Omit<AppNotification, "id" | "read" | "createdAt">;

export async function pushNotifications(items: PushNotificationInput[]): Promise<void> {
  if (!items.length) return;
  const payload = items.map((n) => ({
    recipient: n.recipientUserId,
    kind: n.kind,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    read: false,
  }));
  try {
    await dxRequest(`/items/notifications`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    emit(EVT.notifications);
  } catch {
    // Notifications are best-effort; never block business writes.
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await dxRequest(`/items/notifications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ read: true }),
    });
    emit(EVT.notifications);
  } catch { /* best effort */ }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  try {
    const list = await fetchNotificationsFor(userId, 200);
    const ids = list.filter((n) => !n.read).map((n) => n.id);
    if (!ids.length) return;
    await Promise.all(
      ids.map((id) =>
        dxRequest(`/items/notifications/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ read: true }),
        }),
      ),
    );
    emit(EVT.notifications);
  } catch { /* best effort */ }
}

export function subscribeNotifications(cb: () => void) { return sub(EVT.notifications, cb); }

// ---------------- audit log ----------------

type DxAuditRow = {
  id: string;
  ts?: string | null;
  actor?: string | null;
  actor_role?: string | null;
  actor_branch?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_label?: string | null;
  branch?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown> | null;
};

const A_FIELDS =
  "id,ts,actor,actor_role,actor_branch,action,entity_type,entity_id,entity_label,branch,before,after,meta";

function rowToAudit(r: DxAuditRow): AuditEntry {
  return {
    id: r.id,
    ts: r.ts ?? new Date().toISOString(),
    actorId: r.actor ?? null,
    actorName: null, // resolved client-side by caller if needed
    actorRole: (r.actor_role ?? "anonymous") as AuditEntry["actorRole"],
    actorBranch: r.actor_branch ?? null,
    action: r.action,
    entityType: (r.entity_type ?? "request") as AuditEntry["entityType"],
    entityId: r.entity_id ?? null,
    entityLabel: r.entity_label ?? null,
    branch: r.branch ?? null,
    before: r.before ?? null,
    after: r.after ?? null,
    meta: r.meta ?? undefined,
  };
}

export type AuditLogInput = {
  action: string;
  entityType: AuditEntry["entityType"];
  entityId?: string | null;
  entityLabel?: string | null;
  branch?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  actor: { id: string | null; name: string | null; role: Role | "anonymous"; branch?: string | null };
};

export async function logAudit(input: AuditLogInput): Promise<void> {
  const body = {
    actor: input.actor.id ?? null,
    actor_role: input.actor.role,
    actor_branch: input.actor.branch ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    entity_label: input.entityLabel ?? null,
    branch: input.branch ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta ?? null,
  };
  try {
    await dxRequest(`/items/audit_log`, { method: "POST", body: JSON.stringify(body) });
    emit(EVT.audit);
  } catch (e) {
    // Best-effort: never block the user's primary action — but surface the
    // failure so we can see when audit writes are silently rejected (e.g.
    // missing Directus permissions for the current role / anonymous public
    // upload).
    console.warn("[audit_log] write failed", { action: input.action, entityId: input.entityId, error: e });
  }
}

export async function fetchAudit(opts?: {
  branch?: string;
  action?: string;
  entityType?: string;
  limit?: number;
}): Promise<AuditEntry[]> {
  const limit = opts?.limit ?? 500;
  const filters: string[] = [];
  if (opts?.branch) {
    filters.push(
      `filter[_or][0][branch][_eq]=${encodeURIComponent(opts.branch)}`,
      `filter[_or][1][actor_branch][_eq]=${encodeURIComponent(opts.branch)}`,
    );
  }
  if (opts?.action) filters.push(`filter[action][_eq]=${encodeURIComponent(opts.action)}`);
  if (opts?.entityType) filters.push(`filter[entity_type][_eq]=${encodeURIComponent(opts.entityType)}`);
  const qs = `?fields=${A_FIELDS}&sort=-ts&limit=${limit}${filters.length ? "&" + filters.join("&") : ""}`;
  try {
    const r = await dxRequest<{ data: DxAuditRow[] }>(`/items/audit_log${qs}`);
    return r.data.map(rowToAudit);
  } catch {
    return [];
  }
}

export async function fetchRequestAuditHistory(requestId: string): Promise<AuditEntry[]> {
  try {
    const r = await dxRequest<{ data: DxAuditRow[] }>(
      `/items/audit_log?fields=${A_FIELDS}&sort=ts&limit=-1&filter[entity_type][_eq]=request&filter[entity_id][_eq]=${encodeURIComponent(requestId)}`,
    );
    const rows = r.data.map(rowToAudit);
    console.info("[audit_log] fetchRequestAuditHistory", { requestId, count: rows.length });
    return rows;
  } catch (e) {
    console.warn("[audit_log] fetchRequestAuditHistory failed", { requestId, error: e });
    return [];
  }
}

export async function clearAudit(): Promise<void> {
  try {
    // Pull ids in batches and delete. Admin only — restricted by Directus
    // permissions (admin role bypasses).
    const r = await dxRequest<{ data: Array<{ id: string }> }>(
      `/items/audit_log?fields=id&limit=-1`,
    );
    const ids = r.data.map((x) => x.id);
    if (!ids.length) { emit(EVT.audit); return; }
    // Directus supports bulk delete via the JSON body on DELETE /items/<col>
    await dxRequest(`/items/audit_log`, { method: "DELETE", body: JSON.stringify(ids) });
    emit(EVT.audit);
  } catch { /* surfaced via UI as nothing happens */ }
}

export function subscribeAudit(cb: () => void) { return sub(EVT.audit, cb); }

// ---------------- app settings (singleton) ----------------

type DxSettingsRow = { require_admin_approval?: boolean | null };

let _settingsCache: AppSettings = { requireAdminApproval: false };
let _settingsFetched = false;

export function getSettingsCached(): AppSettings { return _settingsCache; }

export async function fetchSettings(): Promise<AppSettings> {
  try {
    const r = await dxRequest<{ data: DxSettingsRow }>(`/items/app_settings`);
    _settingsCache = { requireAdminApproval: r.data?.require_admin_approval === true };
    _settingsFetched = true;
    emit(EVT.settings);
    return _settingsCache;
  } catch {
    return _settingsCache;
  }
}

export async function ensureSettingsLoaded(): Promise<AppSettings> {
  if (_settingsFetched) return _settingsCache;
  return fetchSettings();
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const body: Record<string, unknown> = {};
  if (patch.requireAdminApproval !== undefined) body.require_admin_approval = patch.requireAdminApproval;
  const r = await dxRequest<{ data: DxSettingsRow }>(`/items/app_settings`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  _settingsCache = { requireAdminApproval: r.data?.require_admin_approval === true };
  _settingsFetched = true;
  emit(EVT.settings);
  return _settingsCache;
}

export function subscribeSettings(cb: () => void) { return sub(EVT.settings, cb); }
