/**
 * App API service — Directus-backed (Phase 3a–3e).
 *
 * All data layer calls go through Directus. No localStorage data store.
 * Only auth tokens + profile snapshot are cached in localStorage (see
 * directusClient.ts) so getCurrentUser() can stay synchronous.
 */

import type {
  Agent as DemoAgent,
  Attachment as DemoAttachment,
  Branch as DemoBranch,
  Note as DemoNote,
  AppNotification as DemoNotification,
  InsuranceRequest as DemoRequest,
  StaffType as DemoStaffType,
  RequestStatus as DemoStatus,
  Quote as DemoQuote,
} from "./types";
import {
  dxLogin,
  dxLogout,
  getProfile as dxGetProfile,
  dxRequest,
  userRecordToProfile,
  type DxUserRecord,
  type ProfileSnapshot,
} from "./directusClient";
import {
  bootstrapEntities,
  getAdminUserIdsCache,
  getAgentsCache,
  getBranchesCache,
  refreshAgents,
  refreshBranches,
  resetEntitiesCache,
  dxCreateBranch,
  dxUpdateBranch,
  dxDeleteBranch,
  dxCreateUser,
  dxUpdateUser,
  dxDeleteUser,
} from "./directusEntities";
import {
  dxListRequests,
  dxGetRequest,
  dxCreateRequest,
  dxSetRequestStatus,
  dxReassignRequest,
  dxAddNote,
  dxResolveNote,
  dxAttachFile,
  dxAttachFilesSequential,
  dxAttachFilesParallel,
  dxDeleteRequestFile,
} from "./directusRequests";
import {
  ensureSettingsLoaded,
  fetchNotificationsFor,
  fetchSettings,
  getSettingsCached,
  logAudit,
  markAllNotificationsRead as dxMarkAllNotificationsRead,
  markNotificationRead as dxMarkNotificationRead,
  pushNotifications,
  setSettings as dxSetSettings,
  subscribeNotifications as dxSubscribeNotifications,
  subscribeSettings as dxSubscribeSettings,
} from "./directusNotify";
import { safeUUID } from "@/lib/uuid";

// Sync read of the Directus entity cache (warmed at login / on root mount).
function dsGetAgents(): DemoAgent[] { return getAgentsCache(); }
function _dsGetBranches(): DemoBranch[] { return getBranchesCache(); }
void _dsGetBranches; void fetchSettings;

// ---------------------------------------------------------------------------
// Public types — kept stable for the rest of the app.
// ---------------------------------------------------------------------------

export type RequestStatus = DemoStatus;
export type RequestNoteKind = "comment" | "missing";
export type RequestNote = DemoNote;
export type AttachmentMeta = DemoAttachment;
export type InsuranceRequest = DemoRequest;
export type RequestQuote = DemoQuote;
export type Role = "agent" | "admin" | "supervisor";
export type AgentRole = "agent" | "supervisor";
export type StaffType = DemoStaffType;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  agentId?: string;
  branch?: string;
};

export type Agent = {
  userId?: string;
  id: string;
  name: string;
  email?: string;
  branch?: string;
  active: boolean;
  role?: AgentRole;
  staffType?: StaffType;
  supervisorId?: string;
  assignedUnderwriterId?: string;
  createdByUserId?: string;
  createdByRole?: Role;
  pendingApproval?: boolean;
  removalRequest?: DemoAgent["removalRequest"];
};

export type AppNotification = DemoNotification;

export function canDelete(u: AuthUser | null | undefined) { return u?.role === "admin"; }
export function canManageAgents(u: AuthUser | null | undefined) { return u?.role === "admin" || u?.role === "supervisor"; }
export function canDeleteAgents(u: AuthUser | null | undefined) { return u?.role === "admin"; }
export function canSeeAllBranches(u: AuthUser | null | undefined) { return u?.role === "admin"; }

// Settings
export function getApprovalRequired(): boolean { return getSettingsCached().requireAdminApproval; }
export async function setApprovalRequired(v: boolean) {
  const before = getSettingsCached().requireAdminApproval;
  await dxSetSettings({ requireAdminApproval: v });
  if (before !== v) {
    logEvent({ action: "settings.approval_changed", entityType: "auth", entityId: null, entityLabel: "settings", before: { requireAdminApproval: before }, after: { requireAdminApproval: v } });
  }
}
export { subscribeSettings } from "./directusNotify";
export { fetchSettings, ensureSettingsLoaded };

// Asset URL helpers — re-export the real Directus implementations.
export { dxAssetUrl, dxIsAssetUrl as isDirectusAssetUrl } from "./directusClient";
export async function dxFetchAsset(_: string) { return null; }

// ---------------------------------------------------------------------------
// Subscription helpers
// ---------------------------------------------------------------------------

const REQ_EVT = "aib:requests-changed";
const AGT_EVT = "aib:agents-changed";
const BR_EVT = "aib:branches-changed";

function sub(evt: string, cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const fn = () => cb();
  window.addEventListener(evt, fn);
  return () => window.removeEventListener(evt, fn);
}
export const subscribeRequests = (cb: () => void) => sub(REQ_EVT, cb);
export const subscribeAgents = (cb: () => void) => sub(AGT_EVT, cb);
export const subscribeBranches = (cb: () => void) => sub(BR_EVT, cb);

// ---------------------------------------------------------------------------
// Auth — match by email/password against demo users.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth — Directus-backed (Phase 3a). Tokens + profile snapshot live in
// directusClient; no plaintext auth state in localStorage.
// ---------------------------------------------------------------------------

function profileToAuth(p: ProfileSnapshot): AuthUser {
  return { id: p.id, email: p.email, name: p.name, role: p.role, agentId: p.agentId, branch: p.branch };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const profile = await dxLogin(email, password);
  const auth = profileToAuth(profile);
  // Warm caches so subsequent sync reads (listAgents/listBranches) have data.
  bootstrapEntities().catch(() => {});
  logEvent({
    action: "auth.login", entityType: "auth", entityId: auth.id, entityLabel: auth.name,
    actor: { id: auth.id, name: auth.name, role: auth.role, branch: auth.branch ?? null },
  });
  return auth;
}

export async function signUp(): Promise<AuthUser> {
  throw new Error("Sign up is disabled. Contact your administrator.");
}

export async function logout() {
  const cur = getCurrentUser();
  if (cur) {
    logEvent({
      action: "auth.logout", entityType: "auth", entityId: cur.id, entityLabel: cur.name,
      actor: { id: cur.id, name: cur.name, role: cur.role, branch: cur.branch ?? null },
    });
  }
  await dxLogout();
  resetEntitiesCache();
}

export function getCurrentUser(): AuthUser | null {
  const p = dxGetProfile();
  return p ? profileToAuth(p) : null;
}

/**
 * Re-fetch the authenticated user from Directus and refresh the cached
 * profile snapshot. Returns null if the session is no longer valid.
 */
export async function refreshCurrentUser(): Promise<AuthUser | null> {
  try {
    const { USER_FIELDS } = await import("./directusClient");
    const me = await dxRequest<{ data: DxUserRecord }>(`/users/me?fields=${USER_FIELDS}`);
    if (me.data.app_active === false || me.data.pending_approval === true) {
      await dxLogout();
      return null;
    }
    const profile = userRecordToProfile(me.data);
    // Persist refreshed snapshot so sync getCurrentUser() stays in sync.
    const { setProfile } = await import("./directusClient");
    setProfile(profile);
    return profileToAuth(profile);
  } catch {
    return getCurrentUser();
  }
}

// ---------------------------------------------------------------------------
// Branches — Directus-backed (Phase 3b).
// ---------------------------------------------------------------------------

export function listBranches(): string[] {
  return getBranchesCache().filter((b) => b.is_active).map((b) => b.code);
}
export function listBranchObjects(): DemoBranch[] { return getBranchesCache(); }

export async function getBranches(opts?: { onlyActive?: boolean }): Promise<DemoBranch[]> {
  // Refresh on demand; fall back to cache if Directus is briefly unreachable.
  try { await refreshBranches(); } catch { /* keep stale cache */ }
  const all = getBranchesCache();
  return opts?.onlyActive ? all.filter((b) => b.is_active) : all;
}

export async function createBranch(input: { name: string; code: string; address?: string; phone?: string; is_active?: boolean }): Promise<DemoBranch> {
  const created = await dxCreateBranch({
    name: input.name, code: input.code,
    address: input.address, phone: input.phone,
    is_active: input.is_active ?? true,
  });
  logEvent({ action: "branch.created", entityType: "agent", entityId: String(created.id), entityLabel: created.name, branch: created.code, after: created });
  return created;
}

export async function updateBranch(id: number, patch: Partial<DemoBranch>): Promise<DemoBranch> {
  const before = getBranchesCache().find((b) => b.id === id);
  const updated = await dxUpdateBranch(id, patch);
  logEvent({ action: "branch.updated", entityType: "agent", entityId: String(id), entityLabel: updated.name, branch: updated.code, before, after: updated });
  return updated;
}

export async function deleteBranch(id: number): Promise<void> {
  const before = getBranchesCache().find((b) => b.id === id);
  await dxDeleteBranch(id);
  logEvent({ action: "branch.deleted", entityType: "agent", entityId: String(id), entityLabel: before?.name ?? "", branch: before?.code, before });
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export async function listRequests(opts?: { agentId?: string; branch?: string }): Promise<InsuranceRequest[]> {
  // Map agent_code → user uuid and branch code → branch id so we can filter
  // server-side. If the agent/branch is unknown to the cache, fall back to a
  // client-side filter on the returned list.
  const agentUuid = opts?.agentId
    ? getAgentsCache().find((a) => a.id === opts.agentId || a.userId === opts.agentId)?.userId
    : undefined;
  const branchId = opts?.branch
    ? getBranchesCache().find((b) => b.code === opts.branch)?.id
    : undefined;
  const rows = await dxListRequests({ agentUuid, branchId });
  // Belt-and-braces client filter for unmapped cases
  return rows.filter((r) =>
    (!opts?.agentId || r.agentId === opts.agentId || r.originAgentId === opts.agentId) &&
    (!opts?.branch || r.branch === opts.branch),
  );
}

export async function getRequest(id: string): Promise<InsuranceRequest | null> {
  return dxGetRequest(id);
}

/**
 * Create an empty request owned by the current sales/underwriter agent.
 * Used by the Sales Agent dashboard to mint a customer upload link
 * (`/r/:requestId`) without collecting any documents up-front.
 */
export async function createEmptyRequest(): Promise<InsuranceRequest> {
  const me = getCurrentUser();
  if (!me || me.role !== "agent" || !me.agentId) {
    throw new Error("Not authenticated as agent");
  }
  const agent = dsGetAgents().find((a) => a.id === me.agentId || a.userId === me.agentId);
  const id = `REQ-${Date.now()}`;
  const req = await dxCreateRequest({
    id,
    uuid: id.toLowerCase(),
    agentCode: me.agentId,
    branchCode: agent?.branch ?? me.branch ?? "",
  });
  logEvent({ action: "request.created", entityType: "request", entityId: id, entityLabel: id, branch: req.branch });
  notifyNewRequest(req);
  return req;
}

export async function resolveAssetUrl(stored: string): Promise<{ url: string; mime: string }> {
  if (!stored) return { url: "", mime: "" };
  const m = stored.match(/^data:([^;]+);/);
  return { url: stored, mime: m?.[1] ?? "" };
}

export async function updateRequestStatus(id: string, status: RequestStatus): Promise<InsuranceRequest> {
  const current = await dxGetRequest(id);
  if (!current) throw new Error("Request not found");
  const before = current.status;
  if (before === status) return current;
  const updated = await dxSetRequestStatus(current.id, status);
  logEvent({ action: "request.status_changed", entityType: "request", entityId: updated.id, entityLabel: updated.id, branch: updated.branch, before: { status: before }, after: { status } });
  notifyRequestStatus(updated, before);
  return updated;
}

export async function submitUpload(input: {
  agentId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  images: {
    registration: File[];
    license: File[];
    emirates: File[];
    vehicleMedia: File[];
    attachments?: File[];
  };
  optional?: { inspection?: File | null };
}): Promise<{ id: string }> {
  const agent = dsGetAgents().find((a) => a.id === input.agentId || a.userId === input.agentId);
  const id = `REQ-${Date.now()}`;
  // Create the request row first so file rows have something to link to.
  const req = await dxCreateRequest({
    id, uuid: id.toLowerCase(),
    agentCode: input.agentId,
    branchCode: agent?.branch ?? "",
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
  });
  // Upload all bytes to Directus and create matching request_files rows.
  // Ordered kinds (front/back/etc.) upload sequentially; everything else in parallel.
  const ownerUuid = agent?.userId ?? null;
  await dxAttachFilesSequential(id, input.images.registration, "registration", ownerUuid);
  await dxAttachFilesSequential(id, input.images.license, "license", ownerUuid);
  await dxAttachFilesSequential(id, input.images.emirates, "emirates", ownerUuid);
  if (input.optional?.inspection) {
    await dxAttachFile(id, input.optional.inspection, "inspection", ownerUuid);
  }
  const vehicleImages = input.images.vehicleMedia.filter((f) => !f.type.startsWith("video/"));
  const vehicleVideos = input.images.vehicleMedia.filter((f) => f.type.startsWith("video/"));
  await Promise.all([
    dxAttachFilesParallel(id, vehicleImages, "vehicle_image", ownerUuid),
    dxAttachFilesParallel(id, vehicleVideos, "vehicle_video", ownerUuid),
    dxAttachFilesParallel(id, input.images.attachments ?? [], "attachment", ownerUuid),
  ]);
  logEvent({ action: "request.created", entityType: "request", entityId: id, entityLabel: id, branch: req.branch });
  notifyNewRequest(req);
  return { id };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addRequestNote(
  requestId: string,
  input: { text: string; kind: RequestNoteKind },
): Promise<InsuranceRequest> {
  const me = getCurrentUser();
  if (!me) throw new Error("Not authenticated");
  const current = await dxGetRequest(requestId);
  if (!current) throw new Error("Request not found");
  const updated = await dxAddNote(current.id, {
    text: input.text,
    kind: input.kind,
    authorId: me.id,
    authorRole: me.role,
  });
  logEvent({
    action: input.kind === "missing" ? "request.reupload_requested" : "request.note_added",
    entityType: "request", entityId: updated.id, entityLabel: updated.id, branch: updated.branch,
    meta: { snippet: input.text.slice(0, 140), authorRole: me.role },
  });
  return updated;
}

export async function resolveRequestNote(requestId: string, noteId: string): Promise<InsuranceRequest> {
  const current = await dxGetRequest(requestId);
  if (!current) throw new Error("Request not found");
  return dxResolveNote(current.id, noteId);
}

export async function appendAttachmentsToRequest(
  requestId: string,
  files: File[],
): Promise<InsuranceRequest> {
  const current = await dxGetRequest(requestId);
  if (!current) throw new Error("Request not found");
  const me = getCurrentUser();
  const eligible = files.filter((f) => !f.type.startsWith("video/"));
  // Upload via Directus /files and create missing_attachment rows.
  await dxAttachFilesParallel(current.id, eligible, "missing_attachment", me?.id ?? null);
  // Mark any open "missing" notes resolved and flip the status to processing.
  for (const n of current.notes) {
    if (n.kind === "missing" && !n.resolvedAt) {
      try { await dxResolveNote(current.id, n.id); } catch { /* tolerated */ }
    }
  }
  const updated = await dxSetRequestStatus(current.id, "processing");
  logEvent({
    action: "request.document_uploaded",
    entityType: "request", entityId: updated.id, entityLabel: updated.id, branch: updated.branch,
    meta: {
      docKey: "missingAttachments",
      count: eligible.length,
      files: eligible.map((a) => ({ name: a.name, size: a.size, type: a.type })),
    },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Agents — Directus-backed (Phase 3b).
//
// Validation rules (branch scoping, role limits, sales→underwriter routing,
// removal workflow, supervisor approval setting) are enforced client-side
// here and additionally by Directus permissions on the server.
// ---------------------------------------------------------------------------

function dsToAgent(a: DemoAgent): Agent { return { ...a }; }

export function listAgents(): Agent[] { return getAgentsCache().map(dsToAgent); }

export async function getAgents(): Promise<Agent[]> {
  try { await refreshAgents(); } catch { /* keep cache */ }
  return listAgents();
}

export async function createAgent(input: {
  id: string; name: string; email?: string; branch?: string;
  role?: AgentRole; staffType?: StaffType;
  supervisorId?: string; password?: string;
  assignedUnderwriterId?: string;
}): Promise<Agent> {
  if (!input.email) throw new Error("Email is required");
  if (!input.password || input.password.length < 6) throw new Error("Password (min 6 chars) is required");
  const me = getCurrentUser();
  const list = getAgentsCache();
  if (list.find((a) => a.id === input.id)) throw new Error("Agent ID already exists");
  if (list.find((a) => a.email && input.email && a.email.toLowerCase() === input.email.toLowerCase())) {
    throw new Error("Email already in use");
  }

  let role: AgentRole = input.role ?? "agent";
  let branch = input.branch;
  let staffType = input.staffType;

  if (me?.role === "supervisor") {
    if (role === "supervisor") throw new Error("Supervisors cannot create supervisors");
    role = "agent";
    branch = me.branch;
    if (!staffType) staffType = "underwriter";
  }
  if (role === "agent" && !staffType) staffType = "underwriter";

  // Validate assignedUnderwriterId — only meaningful for sales agents.
  let assignedUnderwriterCode: string | undefined;
  if (staffType === "sales" && input.assignedUnderwriterId) {
    const target = list.find((a) => a.id === input.assignedUnderwriterId);
    if (!target) throw new Error("Assigned underwriter not found");
    if (target.staffType !== "underwriter") throw new Error("Assigned target must be an underwriter");
    if (target.branch !== branch) throw new Error("Assigned underwriter must be in the same branch");
    assignedUnderwriterCode = target.id;
  }

  await ensureSettingsLoaded();
  const pending = me?.role === "supervisor" && getSettingsCached().requireAdminApproval;

  const created = await dxCreateUser({
    email: input.email,
    password: input.password,
    name: input.name,
    appRole: role,
    branchCode: branch,
    agentCode: input.id,
    staffType: role === "agent" ? staffType : undefined,
    supervisorUserId: role === "agent"
      ? (input.supervisorId || (me?.role === "supervisor" ? me.id : undefined))
      : undefined,
    assignedUnderwriterCode: staffType === "sales" ? assignedUnderwriterCode : undefined,
    pendingApproval: pending,
    active: !pending,
    createdByRole: me?.role === "admin" || me?.role === "supervisor" ? me.role : undefined,
  });

  logEvent({
    action: pending ? "agent.pending_created" : "agent.created",
    entityType: "agent", entityId: created.id, entityLabel: created.name, branch: created.branch,
    after: created,
    meta: { staffType: created.staffType, role: created.role, createdByRole: me?.role },
  });
  if (pending) {
    pushNotifications(getAdminUserIdsCache().map((uid) => ({
      recipientUserId: uid,
      title: `User pending approval: ${created.name}`,
      body: `Created by ${me?.name ?? "supervisor"} · ${created.branch ?? ""}`,
      kind: "user_pending" as const,
      link: "/agents",
    })));
  }
  return created;
}

export async function updateAgent(id: string, patch: Partial<{
  name: string; email: string | null; branch: string | null; active: boolean; supervisorId: string | null;
  role: AgentRole; staffType: StaffType; password: string;
  assignedUnderwriterId: string | null;
}>): Promise<Agent> {
  const list = getAgentsCache();
  const before = list.find((a) => a.id === id || a.userId === id);
  if (!before) throw new Error("Agent not found");
  const me = getCurrentUser();

  if (me?.role === "supervisor") {
    if (before.branch !== me.branch) throw new Error("Out of your branch");
    if (before.createdByRole === "admin") throw new Error("This user was created by Admin and cannot be modified by a supervisor");
    if (patch.branch !== undefined && patch.branch !== me.branch) throw new Error("Supervisors cannot change branch");
    if (patch.role !== undefined && patch.role !== before.role) throw new Error("Supervisors cannot change role");
  }

  if (patch.assignedUnderwriterId !== undefined) {
    if (me?.role !== "admin" && me?.role !== "supervisor") {
      throw new Error("Only admin or supervisor can change the assigned underwriter");
    }
    if (before.staffType !== "sales") {
      throw new Error("Assigned underwriter only applies to sales agents");
    }
    if (patch.assignedUnderwriterId) {
      const target = list.find((a) => a.id === patch.assignedUnderwriterId);
      if (!target) throw new Error("Assigned underwriter not found");
      if (target.staffType !== "underwriter") throw new Error("Assigned target must be an underwriter");
      const targetBranch = patch.branch ?? before.branch;
      if (target.branch !== targetBranch) throw new Error("Assigned underwriter must be in the same branch");
    }
  }

  const nextBranch = patch.branch === null ? undefined : (patch.branch ?? before.branch);
  // If branch changes and the previously assigned UW is no longer in the same branch, clear it.
  let nextAssignedUW: string | null | undefined = undefined;
  if (patch.assignedUnderwriterId !== undefined) {
    nextAssignedUW = patch.assignedUnderwriterId === null ? null : patch.assignedUnderwriterId;
  } else if (nextBranch !== before.branch && before.assignedUnderwriterId) {
    const cur = list.find((a) => a.id === before.assignedUnderwriterId);
    if (!cur || cur.branch !== nextBranch) nextAssignedUW = null;
  }
  const nextStaffType = patch.staffType ?? before.staffType;

  const updated = await dxUpdateUser(before.userId!, {
    name: patch.name,
    email: patch.email,
    password: patch.password,
    branchCode: patch.branch === undefined ? undefined : (patch.branch ?? null),
    staffType: patch.staffType === undefined ? undefined : (patch.staffType ?? null),
    supervisorUserId: patch.supervisorId === undefined ? undefined : (patch.supervisorId ?? null),
    assignedUnderwriterCode: nextStaffType === "sales" ? nextAssignedUW : null,
    active: patch.active,
  });

  const changed: string[] = [];
  (["name","email","branch","active","role","staffType","supervisorId","assignedUnderwriterId"] as const).forEach((k) => {
    if ((patch as Record<string, unknown>)[k] !== undefined && (before as Record<string, unknown>)[k] !== (updated as Record<string, unknown>)[k]) changed.push(k);
  });
  if (changed.includes("assignedUnderwriterId")) {
    logEvent({
      action: "agent.assigned_underwriter_changed",
      entityType: "agent", entityId: updated.id, entityLabel: updated.name, branch: updated.branch,
      before: { assignedUnderwriterId: before.assignedUnderwriterId },
      after: { assignedUnderwriterId: updated.assignedUnderwriterId },
    });
  }
  logEvent({
    action: "agent.updated",
    entityType: "agent", entityId: updated.id, entityLabel: updated.name, branch: updated.branch,
    before, after: updated, meta: { changed },
  });
  return updated;
}

export async function approveAgent(id: string): Promise<Agent> {
  const list = getAgentsCache();
  const target = list.find((a) => a.id === id || a.userId === id);
  if (!target) throw new Error("Agent not found");
  const updated = await dxUpdateUser(target.userId!, { active: true, pendingApproval: false });
  logEvent({ action: "agent.approved", entityType: "agent", entityId: updated.id, entityLabel: updated.name, branch: updated.branch });
  if (target.createdByUserId) {
    pushNotifications([{
      recipientUserId: target.createdByUserId,
      title: `User approved: ${updated.name}`,
      kind: "user_approved",
      link: "/agents",
    }]);
  }
  return updated;
}

export async function deleteAgent(id: string): Promise<void> {
  const list = getAgentsCache();
  const before = list.find((a) => a.id === id || a.userId === id);
  if (!before) throw new Error("Agent not found");
  const me = getCurrentUser();
  if (me?.role === "supervisor") {
    throw new Error("Supervisors must request removal from the admin");
  }
  await dxDeleteUser(before.userId!);
  logEvent({ action: "agent.deleted", entityType: "agent", entityId: before.id, entityLabel: before.name, branch: before.branch, before });
}

// ---------------------------------------------------------------------------
// Audit (delegated to a tiny inline impl so we don't need a separate file)
// ---------------------------------------------------------------------------

function logEvent(input: {
  action: string;
  entityType: "request" | "agent" | "auth";
  entityId?: string | null;
  entityLabel?: string | null;
  branch?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  actor?: { id: string; name: string; role: Role | "anonymous"; branch?: string | null };
}) {
  const u = input.actor ?? getCurrentUser();
  const entry = {
    id: safeUUID(),
    ts: new Date().toISOString(),
    actorId: u?.id ?? null,
    actorName: u?.name ?? null,
    actorRole: (u?.role ?? "anonymous") as Role | "anonymous",
    actorBranch: (u && "branch" in u ? (u as { branch?: string | null }).branch ?? null : null),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityLabel: input.entityLabel ?? null,
    branch: input.branch ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta ?? undefined,
  };
  void entry;
  void logAudit({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityLabel: input.entityLabel ?? null,
    branch: input.branch ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta,
    actor: {
      id: u?.id ?? null,
      name: u?.name ?? null,
      role: (u?.role ?? "anonymous") as Role | "anonymous",
      branch: (u && "branch" in u ? (u as { branch?: string | null }).branch ?? null : null),
    },
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const subscribeNotifications = dxSubscribeNotifications;

// Re-export so UI code can push notifications (e.g. dashboard detecting
// new customer-submitted requests and notifying the logged-in agent).
export { pushNotifications } from "./directusNotify";
export type { PushNotificationInput } from "./directusNotify";

// Local cache of notifications per user — fetched from Directus on demand
// and refreshed whenever the change-event fires.
const _notifCache = new Map<string, DemoNotification[]>();

export function listNotificationsFor(userId: string): DemoNotification[] {
  if (!_notifCache.has(userId)) {
    void fetchNotificationsFor(userId).then((rows) => {
      _notifCache.set(userId, rows);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("aib:notifications-changed"));
      }
    });
    return [];
  }
  return _notifCache.get(userId) ?? [];
}

if (typeof window !== "undefined") {
  window.addEventListener("aib:notifications-changed", () => {
    // Refresh any cached recipients in the background.
    for (const uid of [..._notifCache.keys()]) {
      void fetchNotificationsFor(uid).then((rows) => _notifCache.set(uid, rows));
    }
  });
}

export function markNotificationRead(id: string) { void dxMarkNotificationRead(id); }
export function markAllNotificationsRead(userId: string) { void dxMarkAllNotificationsRead(userId); }

function adminUserIds(): string[] { return getAdminUserIdsCache(); }
void dxSubscribeSettings;

function notifyNewRequest(req: DemoRequest) {
  const targets = new Set<string>(adminUserIds());
  // Notify supervisor of the branch
  const sup = dsGetAgents().find((a) => a.role === "supervisor" && a.branch === req.branch);
  if (sup?.userId) targets.add(sup.userId);
  // Notify the owner agent (the underwriter/sales whose link was used)
  const owner = dsGetAgents().find((a) => a.id === req.agentId);
  if (owner?.userId) targets.add(owner.userId);
  pushNotifications([...targets].map((uid) => ({
    recipientUserId: uid,
    title: `New request ${req.id}`,
    body: `${req.agentName} · ${req.branch}`,
    kind: "request_new" as const,
    link: `/requests/${req.id}`,
  })));
}

// ---------------------------------------------------------------------------
// Reassign request to another agent in the same branch
// ---------------------------------------------------------------------------

export async function reassignRequest(requestId: string, newAgentId: string): Promise<InsuranceRequest> {
  const me = getCurrentUser();
  if (!me) throw new Error("Not authenticated");
  const req = await dxGetRequest(requestId);
  if (!req) throw new Error("Request not found");
  const agents = dsGetAgents();
  const target = agents.find((a) => a.id === newAgentId);
  if (!target) throw new Error("Target agent not found");
  if (target.role !== "agent") throw new Error("Can only assign to underwriter/sales");
  if (target.branch !== req.branch) throw new Error("Target agent is in a different branch");

  // Permission: admin OR supervisor of the branch OR current owner agent
  const isAdmin = me.role === "admin";
  const isBranchSup = me.role === "supervisor" && me.branch === req.branch;
  const isOwner = me.role === "agent" && me.agentId === req.agentId;
  if (!isAdmin && !isBranchSup && !isOwner) throw new Error("Not allowed");

  // Sales agents can only send their requests to their own assigned underwriter.
  if (isOwner && me.role === "agent") {
    const meAgent = agents.find((a) => a.id === me.agentId);
    if (meAgent?.staffType === "sales" && target.staffType === "underwriter") {
      if (!meAgent.assignedUnderwriterId) {
        throw new Error("You don't have an assigned underwriter — contact your supervisor");
      }
      if (target.id !== meAgent.assignedUnderwriterId) {
        throw new Error("You can only send requests to your assigned underwriter");
      }
    }
  }

  if (target.id === req.agentId) return req; // no-op

  const previousOwner = agents.find((a) => a.id === req.agentId);
  const shouldCaptureOrigin =
    !req.originAgentId && previousOwner?.staffType === "sales" && target.staffType === "underwriter";
  const updated = await dxReassignRequest(req.id, {
    newAgentCode: target.id,
    captureOriginAgentCode: shouldCaptureOrigin ? previousOwner!.id : undefined,
  });

  const fromType = previousOwner?.staffType;
  const toType = target.staffType;
  let action = "request.reassigned";
  if (fromType === "sales" && toType === "underwriter") action = "request.assigned_to_underwriter";
  else if (fromType === "underwriter" && toType === "sales") action = "request.returned_to_sales";
  else if (fromType === "underwriter" && toType === "underwriter") action = "request.underwriter_changed";
  else if (fromType === "sales" && toType === "sales") action = "request.sales_changed";

  logEvent({
    action,
    entityType: "request", entityId: req.id, entityLabel: req.id, branch: req.branch,
    before: { agentId: req.agentId, agentName: req.agentName, staffType: fromType },
    after: { agentId: target.id, agentName: target.name, staffType: toType },
  });

  const branchSup = agents.find((a) => a.role === "supervisor" && a.branch === req.branch);
  const recipients = new Set<string>();
  if (previousOwner?.userId && previousOwner.userId !== me.id) recipients.add(previousOwner.userId);
  if (target.userId && target.userId !== me.id) recipients.add(target.userId);
  if (branchSup?.userId && branchSup.userId !== me.id) recipients.add(branchSup.userId);
  pushNotifications([...recipients].map((uid) => ({
    recipientUserId: uid,
    title: uid === target.userId
      ? `Request ${req.id} assigned to you`
      : uid === previousOwner?.userId
        ? `Request ${req.id} reassigned to ${target.name}`
        : `Request ${req.id} reassigned: ${req.agentName} → ${target.name}`,
    body: `${me.name} · ${req.branch}`,
    kind: "request_status" as const,
    link: `/requests/${req.id}`,
  })));

  return updated;
}

// ---------------------------------------------------------------------------
// Quotes (underwriter uploads quote files; sales shares with customer)
// ---------------------------------------------------------------------------

export async function addQuotesToRequest(requestId: string, files: File[]): Promise<InsuranceRequest> {
  const me = getCurrentUser();
  if (!me) throw new Error("Not authenticated");
  const meAgent = dsGetAgents().find((a) => a.userId === me.id);
  const isUW = meAgent?.staffType === "underwriter";
  const isAdminOrSup = me.role === "admin" || me.role === "supervisor";
  if (!isUW && !isAdminOrSup) throw new Error("Only underwriters can upload quotes");
  if (!files.length) throw new Error("No files");

  const req = await dxGetRequest(requestId);
  if (!req) throw new Error("Request not found");

  const agents = dsGetAgents();
  const currentOwner = agents.find((a) => a.id === req.agentId);
  const originSales = req.originAgentId && req.originAgentId !== req.agentId
    ? agents.find((a) => a.id === req.originAgentId)
    : undefined;
  const shouldReturnToSales =
    currentOwner?.staffType === "underwriter" && !!originSales;

  // Upload quote bytes to Directus and create request_files rows of kind "quote".
  await dxAttachFilesParallel(req.id, files, "quote", me.id);
  let updated = req;
  if (shouldReturnToSales && originSales) {
    updated = await dxReassignRequest(req.id, { newAgentCode: originSales.id });
  } else {
    updated = (await dxGetRequest(req.id)) ?? req;
  }

  logEvent({
    action: "request.quote_uploaded",
    entityType: "request", entityId: req.id, entityLabel: req.id, branch: req.branch,
    meta: {
      count: files.length,
      returnedToSales: !!shouldReturnToSales,
      files: files.map((q) => ({ name: q.name, size: q.size, type: q.type })),
    },
  });
  if (shouldReturnToSales && originSales) {
    logEvent({
      action: "request.returned_to_sales",
      entityType: "request", entityId: req.id, entityLabel: req.id, branch: req.branch,
      before: { agentId: currentOwner?.id, agentName: currentOwner?.name, staffType: "underwriter" },
      after: { agentId: originSales.id, agentName: originSales.name, staffType: "sales" },
      meta: { auto: true, reason: "quote_uploaded" },
    });
  }

  // Notify the original sales agent + branch supervisor
  const recipients = new Set<string>();
  if (originSales?.userId && originSales.userId !== me.id) recipients.add(originSales.userId);
  if (currentOwner?.userId && currentOwner.userId !== me.id) recipients.add(currentOwner.userId);
  const branchSup = agents.find((a) => a.role === "supervisor" && a.branch === req.branch);
  if (branchSup?.userId && branchSup.userId !== me.id) recipients.add(branchSup.userId);
  pushNotifications([...recipients].map((uid) => ({
    recipientUserId: uid,
    title: shouldReturnToSales && uid === originSales?.userId
      ? `Quote ready for ${req.id} — share with customer`
      : `Quote uploaded for ${req.id}`,
    body: `${me.name} · ${files.length} file${files.length === 1 ? "" : "s"}`,
    kind: "request_status" as const,
    link: `/requests/${req.id}`,
  })));

  return updated;
}

export async function removeQuoteFromRequest(requestId: string, quoteId: string): Promise<InsuranceRequest> {
  const me = getCurrentUser();
  if (!me) throw new Error("Not authenticated");
  const req = await dxGetRequest(requestId);
  if (!req) throw new Error("Request not found");
  const q = (req.quotes ?? []).find((x) => x.id === quoteId);
  if (!q) throw new Error("Quote not found");
  if (me.role !== "admin" && q.uploadedByUserId !== me.id) throw new Error("Not allowed");
  // Delete the request_files row AND the underlying Directus file asset.
  await dxDeleteRequestFile(quoteId, { deleteAsset: true });
  const updated = (await dxGetRequest(req.id)) ?? req;
  logEvent({
    action: "request.quote_removed",
    entityType: "request", entityId: req.id, entityLabel: req.id, branch: req.branch,
    meta: { quoteId, name: q.name },
  });
  return updated;
}

function notifyRequestStatus(req: DemoRequest, before: DemoStatus) {
  // Notify the request's owner agent
  const owner = dsGetAgents().find((a) => a.id === req.agentId);
  if (owner?.userId) {
    pushNotifications([{
      recipientUserId: owner.userId,
      title: `Request ${req.id}: ${before} → ${req.status}`,
      kind: "request_status",
      link: `/requests/${req.id}`,
    }]);
  }
}

// ---------------------------------------------------------------------------
// Removal requests (supervisor → admin)
// ---------------------------------------------------------------------------

export async function requestAgentRemoval(agentId: string, reason: string): Promise<Agent> {
  const me = getCurrentUser();
  if (!me || me.role !== "supervisor") throw new Error("Only supervisors can request removal");
  const list = getAgentsCache();
  const target = list.find((a) => a.id === agentId || a.userId === agentId);
  if (!target) throw new Error("Agent not found");
  if (target.branch !== me.branch) throw new Error("Out of your branch");
  if (target.removalRequest) throw new Error("Removal already requested");
  const updated = await dxUpdateUser(target.userId!, {
    removalReason: reason.trim() || "—",
    removalRequestedBy: me.id,
    removalRequestedAt: new Date().toISOString(),
  });
  logEvent({
    action: "agent.removal_requested",
    entityType: "agent", entityId: target.id, entityLabel: target.name, branch: target.branch,
    meta: { reason },
  });
  pushNotifications(getAdminUserIdsCache().map((uid) => ({
    recipientUserId: uid,
    title: `Removal requested: ${target.name}`,
    body: `${me.name} (${target.branch}) · ${reason || "No reason"}`,
    kind: "removal_requested" as const,
    link: `/agents`,
  })));
  return updated;
}

export async function approveAgentRemoval(agentId: string): Promise<void> {
  const me = getCurrentUser();
  if (me?.role !== "admin") throw new Error("Only admin can approve");
  const list = getAgentsCache();
  const target = list.find((a) => a.id === agentId || a.userId === agentId);
  if (!target?.removalRequest) throw new Error("No pending removal");
  await dxDeleteUser(target.userId!);
  logEvent({ action: "agent.removal_approved", entityType: "agent", entityId: target.id, entityLabel: target.name, branch: target.branch, before: target });
  if (target.removalRequest.requestedByUserId) {
    pushNotifications([{
      recipientUserId: target.removalRequest.requestedByUserId,
      title: `Removal approved: ${target.name}`,
      kind: "removal_approved",
      link: "/agents",
    }]);
  }
}

export async function dismissAgentRemoval(agentId: string): Promise<Agent> {
  const me = getCurrentUser();
  if (me?.role !== "admin") throw new Error("Only admin can dismiss");
  const list = getAgentsCache();
  const target = list.find((a) => a.id === agentId || a.userId === agentId);
  if (!target) throw new Error("Agent not found");
  if (!target.removalRequest) throw new Error("No pending removal");
  const requesterId = target.removalRequest.requestedByUserId;
  const updated = await dxUpdateUser(target.userId!, {
    removalReason: null,
    removalRequestedBy: null,
    removalRequestedAt: null,
  });
  logEvent({ action: "agent.removal_dismissed", entityType: "agent", entityId: target.id, entityLabel: target.name, branch: target.branch });
  if (requesterId) {
    pushNotifications([{
      recipientUserId: requesterId,
      title: `Removal dismissed: ${target.name}`,
      kind: "removal_dismissed",
      link: "/agents",
    }]);
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Bulk import (Excel) — admin only, per-branch
// ---------------------------------------------------------------------------

export type BulkImportRow = {
  name: string;
  email: string;
  role: "supervisor" | "underwriter" | "sales";
  password?: string;
};

export type BulkImportResult = {
  created: number;
  skipped: { row: number; reason: string }[];
};

function nextIdForRole(role: "supervisor" | "underwriter" | "sales", existing: DemoAgent[]): string {
  const prefix = role === "supervisor" ? "SUP" : role === "underwriter" ? "UW" : "SLS";
  let max = 0;
  for (const a of existing) {
    const m = a.id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export async function bulkImportUsers(branch: string, rows: BulkImportRow[]): Promise<BulkImportResult> {
  const me = getCurrentUser();
  if (me?.role !== "admin") throw new Error("Admin only");
  if (!branch) throw new Error("Branch is required");
  const result: BulkImportResult = { created: 0, skipped: [] };
  const agents = [...getAgentsCache()];
  const branchSupervisor = (): DemoAgent | undefined =>
    agents.find((a) => a.role === "supervisor" && a.branch === branch);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNo = i + 2;
    const name = (row.name ?? "").trim();
    const email = (row.email ?? "").trim().toLowerCase();
    const role = row.role;
    if (!name || !email || !role) { result.skipped.push({ row: lineNo, reason: "missing fields" }); continue; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { result.skipped.push({ row: lineNo, reason: "invalid email" }); continue; }
    if (!["supervisor", "underwriter", "sales"].includes(role)) { result.skipped.push({ row: lineNo, reason: "invalid role" }); continue; }
    if (agents.some((a) => a.email && a.email.toLowerCase() === email)) { result.skipped.push({ row: lineNo, reason: "email exists" }); continue; }
    const id = nextIdForRole(role, agents);
    const agentRole: AgentRole = role === "supervisor" ? "supervisor" : "agent";
    const staffType: StaffType | undefined = role === "supervisor" ? undefined : (role as StaffType);
    const supervisor = role === "supervisor" ? undefined : branchSupervisor();
    const password = (row.password && row.password.length >= 6) ? row.password : `Pw-${safeUUID().slice(0, 10)}`;
    try {
      const created = await dxCreateUser({
        email, password, name,
        appRole: agentRole,
        branchCode: branch,
        agentCode: id,
        staffType,
        supervisorUserId: supervisor?.userId,
        active: true,
        createdByRole: "admin",
      });
      agents.push(created);
      result.created += 1;
    } catch (e) {
      result.skipped.push({ row: lineNo, reason: (e as Error).message || "create failed" });
    }
  }
  logEvent({
    action: "agents.bulk_imported",
    entityType: "agent", entityId: null, entityLabel: branch, branch,
    meta: { created: result.created, skipped: result.skipped.length },
  });
  return result;
}

