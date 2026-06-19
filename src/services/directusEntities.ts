/**
 * Phase 3b — Directus entities cache.
 *
 * Branches + Agents live in Directus (`branches` collection + `directus_users`
 * with custom app fields). We keep a small in-memory cache so synchronous
 * callers (listAgents, listBranches) keep working without an async refactor
 * across the whole UI. Writes go directly to Directus and then refresh the
 * cache + emit the legacy `aib:branches-changed` / `aib:agents-changed`
 * events that pages subscribe to.
 */

import {
  dxIsLoggedIn,
  dxRequest,
  getProfile,
  USER_FIELDS,
  userBranchCode,
  type DxUserRecord,
} from "./directusClient";
import type { Agent as DemoAgent, Branch as DemoBranch } from "./types";

// ---------------- cache + events ----------------

const BR_EVT = "aib:branches-changed";
const AGT_EVT = "aib:agents-changed";

let branchesCache: DemoBranch[] = [];
let agentsCache: DemoAgent[] = [];
let adminUserIdsCache: string[] = [];
let rolesCache: Record<string, string> = {}; // name(lower) -> uuid
let ready = false;

function emit(name: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name));
}

export function getBranchesCache(): DemoBranch[] { return branchesCache; }
export function getAgentsCache(): DemoAgent[] { return agentsCache; }
export function getAdminUserIdsCache(): string[] { return adminUserIdsCache; }
export function entitiesReady(): boolean { return ready; }

function safeLower(value: unknown): string {
  return (value ?? "").toString().toLowerCase();
}

// ---------------- mappers ----------------

type DxBranchRow = {
  id: number; name: string; code: string;
  address?: string | null; phone?: string | null; is_active?: boolean | null;
};

function rowToBranch(r: DxBranchRow): DemoBranch {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    address: r.address ?? undefined,
    phone: r.phone ?? undefined,
    is_active: r.is_active ?? true,
  };
}

function fullName(u: DxUserRecord): string {
  const fn = (u.first_name ?? "").trim();
  const ln = (u.last_name ?? "").trim();
  const joined = `${fn} ${ln}`.trim();
  return joined || u.email || u.id;
}

function userToAgent(u: DxUserRecord): DemoAgent | null {
  if (!u.app_role) return null;
  // Only "supervisor" or "agent" rows surface as Agents in the UI. Admins
  // are excluded from the agent management screen.
  if (u.app_role !== "supervisor" && u.app_role !== "agent") return null;
  const role: DemoAgent["role"] = u.app_role === "supervisor" ? "supervisor" : "agent";
  const removal = u.app_removal_requested_by
    ? {
        requestedByUserId: u.app_removal_requested_by ?? "",
        requestedByName: "", // resolved below if we can
        reason: u.app_removal_reason ?? "—",
        requestedAt: u.app_removal_requested_at ?? new Date().toISOString(),
      }
    : undefined;
  const assignedUnderwriterCode = u.assigned_underwriter_code
    ?? (typeof u.assigned_underwriter === "object" ? u.assigned_underwriter?.agent_code ?? u.assigned_underwriter?.id : undefined)
    ?? (typeof u.assigned_underwriter === "string" ? u.assigned_underwriter : undefined);
  return {
    userId: u.id,
    id: u.agent_code ?? u.id,
    name: fullName(u),
    email: u.email,
    branch: userBranchCode(u),
    active: u.app_active !== false,
    role,
    staffType: u.staff_type ?? undefined,
    supervisorId: u.supervisor ?? undefined,
    assignedUnderwriterId: assignedUnderwriterCode,
    createdByUserId: undefined,
    createdByRole: (u.app_created_by_role as DemoAgent["createdByRole"]) ?? undefined,
    pendingApproval: u.pending_approval || undefined,
    removalRequest: removal,
  };
}

// ---------------- role lookup ----------------

async function loadRoles(): Promise<Record<string, string>> {
  if (Object.keys(rolesCache).length) return rolesCache;
  const r = await dxRequest<{ data: Array<{ id: string; name: string }> }>(`/roles?fields=id,name&limit=-1`);
  const map: Record<string, string> = {};
  for (const row of r.data) map[safeLower(row.name)] = row.id;
  rolesCache = map;
  return map;
}

export async function resolveRoleId(name: "admin" | "supervisor" | "agent"): Promise<string> {
  const map = await loadRoles();
  const id = map[name];
  if (!id) throw new Error(`Directus role "${name}" not found. Run scripts/directus-bootstrap.ts first.`);
  return id;
}

// ---------------- loaders ----------------

export async function refreshBranches(): Promise<void> {
  const r = await dxRequest<{ data: DxBranchRow[] }>(`/items/branches?limit=-1&sort=name`);
  branchesCache = r.data.map(rowToBranch);
  emit(BR_EVT);
}

export async function refreshAgents(): Promise<void> {
  // Pull both agent + supervisor rows. Admin rows are filtered out in mapper.
  const agentSafeFields = [
    "id", "first_name", "last_name", "agent_code", "app_role", "staff_type",
    "branch.id", "branch.code",
    "assigned_underwriter", "assigned_underwriter.id", "assigned_underwriter.agent_code",
    "assigned_underwriter_code", "app_active",
  ].join(",");
  // Only Admin/Supervisor can read the full directus_users field set
  // (email, status, pending_approval, removal metadata, etc.). Sales Agents
  // and Underwriters get a minimal, permission-safe projection so the
  // dashboard never crashes on a 403.
  const role = getProfile()?.role;
  const elevated = role === "admin" || role === "supervisor";
  let r: { data: DxUserRecord[] } = { data: [] };
  if (elevated) {
    try {
      r = await dxRequest<{ data: DxUserRecord[] }>(
        `/users?fields=${USER_FIELDS}&filter[app_role][_in]=supervisor,agent&limit=-1&sort=email`,
      );
    } catch {
      try {
        r = await dxRequest<{ data: DxUserRecord[] }>(
          `/users?fields=${agentSafeFields}&filter[app_role][_in]=supervisor,agent&limit=-1&sort=first_name`,
        );
      } catch {
        r = { data: [] };
      }
    }
  } else {
    try {
      r = await dxRequest<{ data: DxUserRecord[] }>(
        `/users?fields=${agentSafeFields}&filter[app_role][_in]=supervisor,agent&limit=-1&sort=first_name`,
      );
    } catch {
      // Agent/Underwriter cannot read other users — keep dashboard alive.
      r = { data: [] };
    }
  }
  const list: DemoAgent[] = [];
  // Resolve requester display names from the same dataset where possible.
  const byId = new Map(r.data.map((u) => [u.id, u]));
  for (const u of r.data) {
    const a = userToAgent(u);
    if (!a) continue;
    if (a.removalRequest && a.removalRequest.requestedByUserId) {
      const reqUser = byId.get(a.removalRequest.requestedByUserId);
      if (reqUser) a.removalRequest.requestedByName = fullName(reqUser);
    }
    list.push(a);
  }
  for (const a of list) {
    if (!a.assignedUnderwriterId) continue;
    const assigned = list.find((x) => x.id === a.assignedUnderwriterId || x.userId === a.assignedUnderwriterId);
    if (assigned) a.assignedUnderwriterId = assigned.id;
  }
  agentsCache = list;
  emit(AGT_EVT);
}

export async function refreshAdminUserIds(): Promise<void> {
  try {
    const r = await dxRequest<{ data: Array<{ id: string }> }>(
      `/users?fields=id&filter[app_role][_eq]=admin&limit=-1`,
    );
    adminUserIdsCache = r.data.map((u) => u.id);
  } catch {
    // Non-admin sessions usually cannot list other admins; leave empty.
    adminUserIdsCache = [];
  }
}

export async function bootstrapEntities(): Promise<void> {
  if (!dxIsLoggedIn()) return;
  try {
    await Promise.all([
      refreshBranches(),
      refreshAgents(),
      refreshAdminUserIds(),
      loadRoles().catch(() => ({})),
    ]);
    ready = true;
  } catch (e) {
    console.error("[directusEntities] bootstrap failed:", e);
  }
}

export function resetEntitiesCache(): void {
  branchesCache = [];
  agentsCache = [];
  adminUserIdsCache = [];
  rolesCache = {};
  ready = false;
}

// ---------------- branches CRUD ----------------

export async function dxCreateBranch(input: Omit<DemoBranch, "id">): Promise<DemoBranch> {
  const r = await dxRequest<{ data: DxBranchRow }>(`/items/branches`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name, code: input.code,
      address: input.address ?? null, phone: input.phone ?? null,
      is_active: input.is_active ?? true,
    }),
  });
  await refreshBranches();
  return rowToBranch(r.data);
}

export async function dxUpdateBranch(id: number, patch: Partial<DemoBranch>): Promise<DemoBranch> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.code !== undefined) body.code = patch.code;
  if (patch.address !== undefined) body.address = patch.address ?? null;
  if (patch.phone !== undefined) body.phone = patch.phone ?? null;
  if (patch.is_active !== undefined) body.is_active = patch.is_active;
  const r = await dxRequest<{ data: DxBranchRow }>(`/items/branches/${id}`, {
    method: "PATCH", body: JSON.stringify(body),
  });
  await refreshBranches();
  return rowToBranch(r.data);
}

export async function dxDeleteBranch(id: number): Promise<void> {
  await dxRequest(`/items/branches/${id}`, { method: "DELETE" });
  await refreshBranches();
}

// ---------------- agents (directus_users) CRUD ----------------

function branchIdByCode(code: string | undefined): number | null {
  if (!code) return null;
  const b = branchesCache.find((x) => x.code === code);
  return b ? b.id : null;
}

export type DxCreateUserInput = {
  email: string;
  password: string;
  name: string;
  appRole: "admin" | "supervisor" | "agent";
  branchCode?: string;
  agentCode?: string;
  staffType?: "underwriter" | "sales";
  supervisorUserId?: string;
  assignedUnderwriterCode?: string;
  pendingApproval?: boolean;
  createdByRole?: "admin" | "supervisor";
  active?: boolean;
};

function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { first_name: parts[0] ?? "", last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export async function dxCreateUser(input: DxCreateUserInput): Promise<DemoAgent> {
  const directusRoleName = input.appRole === "admin"
    ? "admin"
    : input.appRole === "supervisor" ? "supervisor" : "agent";
  const roleId = await resolveRoleId(directusRoleName);
  const { first_name, last_name } = splitName(input.name);
  const branchId = branchIdByCode(input.branchCode);

  const body: Record<string, unknown> = {
    email: input.email,
    password: input.password,
    first_name, last_name,
    role: roleId,
    status: "active",
    app_role: input.appRole,
    app_active: input.active ?? true,
    pending_approval: input.pendingApproval ?? false,
  };
  if (branchId !== null) body.branch = branchId;
  if (input.agentCode) body.agent_code = input.agentCode;
  if (input.staffType) body.staff_type = input.staffType;
  if (input.supervisorUserId) body.supervisor = input.supervisorUserId;
  if (input.assignedUnderwriterCode !== undefined) {
    body.assigned_underwriter_code = input.assignedUnderwriterCode;
    body.assigned_underwriter = input.assignedUnderwriterCode
      ? getAgentsCache().find((a) => a.id === input.assignedUnderwriterCode || a.userId === input.assignedUnderwriterCode)?.userId ?? null
      : null;
  }
  if (input.createdByRole) body.app_created_by_role = input.createdByRole;

  const r = await dxRequest<{ data: DxUserRecord }>(
    `/users?fields=${USER_FIELDS}`,
    { method: "POST", body: JSON.stringify(body) },
  );
  await refreshAgents();
  const a = userToAgent(r.data);
  if (!a) throw new Error("Created user has no app_role");
  return a;
}

export type DxUpdateUserPatch = {
  name?: string;
  email?: string | null;
  password?: string;
  branchCode?: string | null;
  agentCode?: string | null;
  staffType?: "underwriter" | "sales" | null;
  supervisorUserId?: string | null;
  assignedUnderwriterCode?: string | null;
  pendingApproval?: boolean;
  active?: boolean;
  removalReason?: string | null;
  removalRequestedBy?: string | null;
  removalRequestedAt?: string | null;
};

export async function dxUpdateUser(userId: string, patch: DxUpdateUserPatch): Promise<DemoAgent> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const { first_name, last_name } = splitName(patch.name);
    body.first_name = first_name; body.last_name = last_name;
  }
  if (patch.email !== undefined) body.email = patch.email;
  if (patch.password) body.password = patch.password;
  if (patch.branchCode !== undefined) {
    body.branch = patch.branchCode === null ? null : branchIdByCode(patch.branchCode);
  }
  if (patch.agentCode !== undefined) body.agent_code = patch.agentCode;
  if (patch.staffType !== undefined) body.staff_type = patch.staffType;
  if (patch.supervisorUserId !== undefined) body.supervisor = patch.supervisorUserId;
  if (patch.assignedUnderwriterCode !== undefined) {
    body.assigned_underwriter_code = patch.assignedUnderwriterCode;
    body.assigned_underwriter = patch.assignedUnderwriterCode
      ? getAgentsCache().find((a) => a.id === patch.assignedUnderwriterCode || a.userId === patch.assignedUnderwriterCode)?.userId ?? null
      : null;
  }
  if (patch.pendingApproval !== undefined) body.pending_approval = patch.pendingApproval;
  if (patch.active !== undefined) {
    body.app_active = patch.active;
    body.status = patch.active ? "active" : "suspended";
  }
  if (patch.removalReason !== undefined) body.app_removal_reason = patch.removalReason;
  if (patch.removalRequestedBy !== undefined) body.app_removal_requested_by = patch.removalRequestedBy;
  if (patch.removalRequestedAt !== undefined) body.app_removal_requested_at = patch.removalRequestedAt;

  const r = await dxRequest<{ data: DxUserRecord }>(
    `/users/${userId}?fields=${USER_FIELDS}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  await refreshAgents();
  const a = userToAgent(r.data);
  if (!a) throw new Error("Updated user has no app_role");
  return a;
}

export async function dxDeleteUser(userId: string): Promise<void> {
  await dxRequest(`/users/${userId}`, { method: "DELETE" });
  await refreshAgents();
}