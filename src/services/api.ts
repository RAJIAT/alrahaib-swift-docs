/**
 * Demo API service — fully local (localStorage-backed).
 *
 * This module preserves the exact same exports the rest of the app uses
 * (login, listRequests, submitUpload, addRequestNote, getAgents, etc.) but
 * routes everything through src/services/demoStore.ts. No HTTP calls.
 */

import {
  fileToDataUrl,
  getAgents as dsGetAgents,
  getAudit, setAudit,
  getBranches as dsGetBranches,
  getNotifications, setNotifications, pushNotifications,
  getRequests, setRequests,
  getSettings, setSettings as dsSetSettings,
  getUsers, setUsers,
  newRequestId,
  notify,
  setAgents as dsSetAgents,
  setBranches as dsSetBranches,
  type DemoAgent,
  type DemoAttachment,
  type DemoBranch,
  type DemoNote,
  type DemoNotification,
  type DemoRequest,
  type DemoStaffType,
  type DemoStatus,
  type DemoUser,
} from "./demoStore";

// Trigger seeding by accessing the store once.
export function ensureSeeded() { getUsers(); }

// ---------------------------------------------------------------------------
// Public types — kept stable for the rest of the app.
// ---------------------------------------------------------------------------

export type RequestStatus = DemoStatus;
export type RequestNoteKind = "comment" | "missing";
export type RequestNote = DemoNote;
export type AttachmentMeta = DemoAttachment;
export type InsuranceRequest = DemoRequest;
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
export function getApprovalRequired(): boolean { return getSettings().requireAdminApproval; }
export function setApprovalRequired(v: boolean) {
  const before = getSettings().requireAdminApproval;
  dsSetSettings({ requireAdminApproval: v });
  if (before !== v) {
    logEvent({ action: "settings.approval_changed", entityType: "auth", entityId: null, entityLabel: "settings", before: { requireAdminApproval: before }, after: { requireAdminApproval: v } });
  }
}
export { subscribeSettings } from "./demoStore";

// Asset URL helpers — in demo mode every asset is a data URL.
export function dxAssetUrl(s: string) { return s; }
export function isDirectusAssetUrl(_: string) { return false; }
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

const AUTH_KEY = "aib_auth_user";

function userToAuth(u: DemoUser): AuthUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, agentId: u.agentId, branch: u.branch };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const u = getUsers().find(
    (x) => x.email.toLowerCase() === email.toLowerCase() && x.password === password,
  );
  if (!u) throw new Error("Invalid credentials");
  const auth = userToAuth(u);
  if (typeof window !== "undefined") localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  logEvent({ action: "auth.login", entityType: "auth", entityId: auth.id, entityLabel: auth.name, actor: { id: auth.id, name: auth.name, role: auth.role, branch: auth.branch ?? null } });
  return auth;
}

export async function signUp(): Promise<AuthUser> {
  throw new Error("Sign up is disabled in demo.");
}

export async function logout() {
  const cur = getCurrentUser();
  if (cur) {
    logEvent({ action: "auth.logout", entityType: "auth", entityId: cur.id, entityLabel: cur.name, actor: { id: cur.id, name: cur.name, role: cur.role, branch: cur.branch ?? null } });
  }
  if (typeof window !== "undefined") localStorage.removeItem(AUTH_KEY);
}

export function getCurrentUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthUser; } catch { return null; }
}

export async function refreshCurrentUser(): Promise<AuthUser | null> {
  return getCurrentUser();
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export function listBranches(): string[] {
  return dsGetBranches().filter((b) => b.is_active).map((b) => b.code);
}
export function listBranchObjects(): DemoBranch[] { return dsGetBranches(); }

export async function getBranches(opts?: { onlyActive?: boolean }): Promise<DemoBranch[]> {
  const all = dsGetBranches();
  return opts?.onlyActive ? all.filter((b) => b.is_active) : all;
}

export async function createBranch(input: { name: string; code: string; address?: string; phone?: string; is_active?: boolean }): Promise<DemoBranch> {
  const list = dsGetBranches();
  const id = (list.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1;
  const created: DemoBranch = { id, name: input.name, code: input.code, address: input.address, phone: input.phone, is_active: input.is_active ?? true };
  dsSetBranches([...list, created]);
  return created;
}

export async function updateBranch(id: number, patch: Partial<DemoBranch>): Promise<DemoBranch> {
  const list = dsGetBranches();
  const next = list.map((b) => (b.id === id ? { ...b, ...patch } : b));
  dsSetBranches(next);
  return next.find((b) => b.id === id)!;
}

export async function deleteBranch(id: number): Promise<void> {
  dsSetBranches(dsGetBranches().filter((b) => b.id !== id));
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export async function listRequests(opts?: { agentId?: string; branch?: string }): Promise<InsuranceRequest[]> {
  let list = getRequests();
  if (opts?.agentId) list = list.filter((r) => r.agentId === opts.agentId);
  if (opts?.branch) list = list.filter((r) => r.branch === opts.branch);
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getRequest(id: string): Promise<InsuranceRequest | null> {
  return getRequests().find((r) => r.id === id || r.uuid === id) ?? null;
}

export async function resolveAssetUrl(stored: string): Promise<{ url: string; mime: string }> {
  if (!stored) return { url: "", mime: "" };
  const m = stored.match(/^data:([^;]+);/);
  return { url: stored, mime: m?.[1] ?? "" };
}

export async function updateRequestStatus(id: string, status: RequestStatus): Promise<InsuranceRequest> {
  const list = getRequests();
  const idx = list.findIndex((r) => r.id === id || r.uuid === id);
  if (idx < 0) throw new Error("Request not found");
  const before = list[idx].status;
  const next = [...list];
  next[idx] = { ...list[idx], status };
  setRequests(next);
  if (before !== status) {
    logEvent({ action: "request.status_changed", entityType: "request", entityId: next[idx].id, entityLabel: next[idx].id, branch: next[idx].branch, before: { status: before }, after: { status } });
    notifyRequestStatus(next[idx], before);
  }
  return next[idx];
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
  const agent = dsGetAgents().find((a) => a.id === input.agentId);
  const id = newRequestId();
  const toUrls = async (files: File[]) => Promise.all(files.map((f) => fileToDataUrl(f)));
  const registration = await toUrls(input.images.registration);
  const license = await toUrls(input.images.license);
  const emirates = await toUrls(input.images.emirates);
  const vehicleMedia = await Promise.all(
    input.images.vehicleMedia.map(async (f) =>
      f.type.startsWith("video/")
        ? { kind: "video" as const, name: f.name, size: f.size, type: f.type }
        : { kind: "image" as const, url: await fileToDataUrl(f) },
    ),
  );
  const attachments: DemoAttachment[] = await Promise.all(
    (input.images.attachments ?? []).map(async (f) => ({
      name: f.name, type: f.type, size: f.size, url: await fileToDataUrl(f),
    })),
  );
  const inspection = input.optional?.inspection ? await fileToDataUrl(input.optional.inspection) : undefined;

  const req: DemoRequest = {
    id, uuid: id.toLowerCase(),
    agentId: input.agentId,
    agentName: agent?.name ?? input.agentId,
    branch: agent?.branch ?? "",
    status: "new",
    createdAt: new Date().toISOString(),
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    notes: [],
    images: { registration, license, emirates, vehicleMedia, inspection, attachments },
  };
  setRequests([req, ...getRequests()]);
  logEvent({ action: "request.created", entityType: "request", entityId: id, entityLabel: id, branch: req.branch });
  // Notify supervisor + admins of the new request
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
  const list = getRequests();
  const idx = list.findIndex((r) => r.id === requestId || r.uuid === requestId);
  if (idx < 0) throw new Error("Request not found");
  const note: DemoNote = {
    id: crypto.randomUUID(),
    authorId: me.id,
    authorName: me.name,
    authorRole: me.role,
    text: input.text.trim(),
    kind: input.kind,
    createdAt: new Date().toISOString(),
  };
  const next = [...list];
  const req = { ...list[idx], notes: [...list[idx].notes, note] };
  if (input.kind === "missing" && req.status !== "reupload") req.status = "reupload";
  next[idx] = req;
  setRequests(next);
  return req;
}

export async function resolveRequestNote(requestId: string, noteId: string): Promise<InsuranceRequest> {
  const list = getRequests();
  const idx = list.findIndex((r) => r.id === requestId || r.uuid === requestId);
  if (idx < 0) throw new Error("Request not found");
  const next = [...list];
  next[idx] = {
    ...list[idx],
    notes: list[idx].notes.map((n) => (n.id === noteId ? { ...n, resolvedAt: new Date().toISOString() } : n)),
  };
  setRequests(next);
  return next[idx];
}

export async function appendAttachmentsToRequest(
  requestId: string,
  files: File[],
): Promise<InsuranceRequest> {
  const list = getRequests();
  const idx = list.findIndex((r) => r.id === requestId || r.uuid === requestId);
  if (idx < 0) throw new Error("Request not found");
  const newAttachments: DemoAttachment[] = await Promise.all(
    files.filter((f) => !f.type.startsWith("video/")).map(async (f) => ({
      name: f.name, type: f.type, size: f.size, url: await fileToDataUrl(f),
    })),
  );
  const next = [...list];
  const req = list[idx];
  next[idx] = {
    ...req,
    status: "processing",
    notes: req.notes.map((n) => (n.kind === "missing" && !n.resolvedAt ? { ...n, resolvedAt: new Date().toISOString() } : n)),
    images: {
      ...req.images,
      missingAttachments: [...(req.images.missingAttachments ?? []), ...newAttachments],
    },
  };
  setRequests(next);
  return next[idx];
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function dsToAgent(a: DemoAgent): Agent { return { ...a }; }

export function listAgents(): Agent[] { return dsGetAgents().map(dsToAgent); }

export async function getAgents(): Promise<Agent[]> { return listAgents(); }

export async function createAgent(input: {
  id: string; name: string; email?: string; branch?: string;
  role?: AgentRole; staffType?: StaffType;
  supervisorId?: string; password?: string;
}): Promise<Agent> {
  if (!input.email) throw new Error("Email is required");
  if (!input.password || input.password.length < 6) throw new Error("Password (min 6 chars) is required");
  const me = getCurrentUser();
  const list = dsGetAgents();
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

  const settings = getSettings();
  const pending = me?.role === "supervisor" && settings.requireAdminApproval;

  const userId = `u-${crypto.randomUUID().slice(0, 8)}`;
  const agent: DemoAgent = {
    userId, id: input.id, name: input.name, email: input.email, branch,
    active: !pending, role,
    staffType: role === "agent" ? staffType : undefined,
    supervisorId: role === "agent"
      ? (input.supervisorId || (me?.role === "supervisor" ? me.id : undefined))
      : undefined,
    createdByUserId: me?.id,
    createdByRole: me?.role,
    pendingApproval: pending || undefined,
  };
  dsSetAgents([...list, agent]);

  const newUser: DemoUser = {
    id: userId, email: input.email, password: input.password, name: input.name,
    role, agentId: role === "agent" ? input.id : undefined, branch,
  };
  setUsers([...getUsers(), newUser]);

  logEvent({
    action: pending ? "agent.pending_created" : "agent.created",
    entityType: "agent", entityId: agent.id, entityLabel: agent.name, branch: agent.branch,
    after: agent,
    meta: { staffType: agent.staffType, role: agent.role, createdByRole: me?.role },
  });
  if (pending) {
    pushNotifications(getUsers().filter((u) => u.role === "admin").map((u) => ({
      recipientUserId: u.id,
      title: `User pending approval: ${agent.name}`,
      body: `Created by ${me?.name ?? "supervisor"} · ${agent.branch ?? ""}`,
      kind: "user_pending" as const,
      link: "/agents",
    })));
  }
  return dsToAgent(agent);
}

export async function updateAgent(id: string, patch: Partial<{
  name: string; email: string | null; branch: string | null; active: boolean; supervisorId: string | null;
  role: AgentRole; staffType: StaffType; password: string;
}>): Promise<Agent> {
  const list = dsGetAgents();
  const idx = list.findIndex((a) => a.id === id || a.userId === id);
  if (idx < 0) throw new Error("Agent not found");
  const before = list[idx];
  const me = getCurrentUser();

  if (me?.role === "supervisor") {
    if (before.branch !== me.branch) throw new Error("Out of your branch");
    if (before.createdByRole === "admin") throw new Error("This user was created by Admin and cannot be modified by a supervisor");
    if (patch.branch !== undefined && patch.branch !== me.branch) throw new Error("Supervisors cannot change branch");
    if (patch.role !== undefined && patch.role !== before.role) throw new Error("Supervisors cannot change role");
  }

  const next = [...list];
  next[idx] = {
    ...before,
    name: patch.name ?? before.name,
    email: patch.email === null ? undefined : (patch.email ?? before.email),
    branch: patch.branch === null ? undefined : (patch.branch ?? before.branch),
    active: patch.active ?? before.active,
    role: patch.role ?? before.role,
    staffType: patch.staffType ?? before.staffType,
    supervisorId: patch.supervisorId === null ? undefined : (patch.supervisorId ?? before.supervisorId),
  };
  dsSetAgents(next);

  const users = getUsers();
  const u = users.findIndex((x) => x.id === before.userId);
  if (u >= 0) {
    const updated = { ...users[u] };
    if (patch.name) updated.name = patch.name;
    if (patch.email) updated.email = patch.email;
    if (patch.branch !== undefined) updated.branch = patch.branch ?? undefined;
    if (patch.password) updated.password = patch.password;
    if (patch.role) updated.role = patch.role;
    const arr = [...users]; arr[u] = updated;
    setUsers(arr);
  }

  const changed: string[] = [];
  (["name","email","branch","active","role","staffType","supervisorId"] as const).forEach((k) => {
    if ((patch as any)[k] !== undefined && (before as any)[k] !== (next[idx] as any)[k]) changed.push(k);
  });
  logEvent({
    action: "agent.updated",
    entityType: "agent", entityId: next[idx].id, entityLabel: next[idx].name, branch: next[idx].branch,
    before, after: next[idx], meta: { changed },
  });
  return dsToAgent(next[idx]);
}

export async function approveAgent(id: string): Promise<Agent> {
  const list = dsGetAgents();
  const idx = list.findIndex((a) => a.id === id || a.userId === id);
  if (idx < 0) throw new Error("Agent not found");
  const next = [...list];
  next[idx] = { ...list[idx], active: true, pendingApproval: undefined };
  dsSetAgents(next);
  logEvent({ action: "agent.approved", entityType: "agent", entityId: next[idx].id, entityLabel: next[idx].name, branch: next[idx].branch });
  if (next[idx].createdByUserId) {
    pushNotifications([{
      recipientUserId: next[idx].createdByUserId!,
      title: `User approved: ${next[idx].name}`,
      kind: "user_approved",
      link: "/agents",
    }]);
  }
  return dsToAgent(next[idx]);
}

export async function deleteAgent(id: string): Promise<void> {
  const list = dsGetAgents();
  const before = list.find((a) => a.id === id || a.userId === id);
  if (!before) throw new Error("Agent not found");
  const me = getCurrentUser();
  if (me?.role === "supervisor") {
    if (before.branch !== me.branch) throw new Error("Out of your branch");
    if (before.createdByRole === "admin") throw new Error("Cannot delete users created by Admin");
  }
  dsSetAgents(list.filter((a) => a !== before));
  setUsers(getUsers().filter((u) => u.id !== before.userId));
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
    id: crypto.randomUUID(),
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
  setAudit([entry, ...getAudit()].slice(0, 500));
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export { subscribeNotifications } from "./demoStore";

export function listNotificationsFor(userId: string): DemoNotification[] {
  return getNotifications().filter((n) => n.recipientUserId === userId);
}

export function markNotificationRead(id: string) {
  const list = getNotifications();
  const next = list.map((n) => (n.id === id ? { ...n, read: true } : n));
  setNotifications(next);
}

export function markAllNotificationsRead(userId: string) {
  const list = getNotifications();
  const next = list.map((n) => (n.recipientUserId === userId ? { ...n, read: true } : n));
  setNotifications(next);
}

function adminUserIds(): string[] {
  return getUsers().filter((u) => u.role === "admin").map((u) => u.id);
}

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
  const list = getRequests();
  const idx = list.findIndex((r) => r.id === requestId || r.uuid === requestId);
  if (idx < 0) throw new Error("Request not found");
  const req = list[idx];
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
  if (target.id === req.agentId) return req; // no-op

  const previousOwner = agents.find((a) => a.id === req.agentId);
  const next = [...list];
  next[idx] = { ...req, agentId: target.id, agentName: target.name };
  setRequests(next);

  logEvent({
    action: "request.reassigned",
    entityType: "request", entityId: req.id, entityLabel: req.id, branch: req.branch,
    before: { agentId: req.agentId, agentName: req.agentName },
    after: { agentId: target.id, agentName: target.name },
  });

  // Notify previous owner, new owner, and branch supervisor
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

  return next[idx];
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
  const list = dsGetAgents();
  const idx = list.findIndex((a) => a.id === agentId);
  if (idx < 0) throw new Error("Agent not found");
  const target = list[idx];
  if (target.branch !== me.branch) throw new Error("Out of your branch");
  if (target.removalRequest) throw new Error("Removal already requested");
  const next = [...list];
  next[idx] = {
    ...target,
    removalRequest: {
      requestedByUserId: me.id,
      requestedByName: me.name,
      reason: reason.trim() || "—",
      requestedAt: new Date().toISOString(),
    },
  };
  dsSetAgents(next);
  logEvent({
    action: "agent.removal_requested",
    entityType: "agent", entityId: target.id, entityLabel: target.name, branch: target.branch,
    meta: { reason },
  });
  pushNotifications(adminUserIds().map((uid) => ({
    recipientUserId: uid,
    title: `Removal requested: ${target.name}`,
    body: `${me.name} (${target.branch}) · ${reason || "No reason"}`,
    kind: "removal_requested" as const,
    link: `/agents`,
  })));
  return next[idx];
}

export async function approveAgentRemoval(agentId: string): Promise<void> {
  const me = getCurrentUser();
  if (me?.role !== "admin") throw new Error("Only admin can approve");
  const list = dsGetAgents();
  const target = list.find((a) => a.id === agentId);
  if (!target?.removalRequest) throw new Error("No pending removal");
  dsSetAgents(list.filter((a) => a !== target));
  setUsers(getUsers().filter((u) => u.id !== target.userId));
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
  const list = dsGetAgents();
  const idx = list.findIndex((a) => a.id === agentId);
  if (idx < 0) throw new Error("Agent not found");
  const target = list[idx];
  if (!target.removalRequest) throw new Error("No pending removal");
  const requesterId = target.removalRequest.requestedByUserId;
  const next = [...list];
  next[idx] = { ...target, removalRequest: undefined };
  dsSetAgents(next);
  logEvent({ action: "agent.removal_dismissed", entityType: "agent", entityId: target.id, entityLabel: target.name, branch: target.branch });
  if (requesterId) {
    pushNotifications([{
      recipientUserId: requesterId,
      title: `Removal dismissed: ${target.name}`,
      kind: "removal_dismissed",
      link: "/agents",
    }]);
  }
  return dsToAgent(next[idx]);
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
  const agents = [...dsGetAgents()];
  const users = [...getUsers()];
  // Resolve supervisor for the branch (the first existing one)
  const branchSupervisor = (): DemoAgent | undefined =>
    agents.find((a) => a.role === "supervisor" && a.branch === branch);

  rows.forEach((row, i) => {
    const lineNo = i + 2; // header is row 1
    const name = (row.name ?? "").trim();
    const email = (row.email ?? "").trim().toLowerCase();
    const role = row.role;
    if (!name || !email || !role) {
      result.skipped.push({ row: lineNo, reason: "missing fields" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      result.skipped.push({ row: lineNo, reason: "invalid email" });
      return;
    }
    if (!["supervisor", "underwriter", "sales"].includes(role)) {
      result.skipped.push({ row: lineNo, reason: "invalid role" });
      return;
    }
    if (agents.some((a) => a.email && a.email.toLowerCase() === email)) {
      result.skipped.push({ row: lineNo, reason: "email exists" });
      return;
    }
    if (users.some((u) => u.email.toLowerCase() === email)) {
      result.skipped.push({ row: lineNo, reason: "email exists" });
      return;
    }
    const id = nextIdForRole(role, agents);
    const userId = `u-${crypto.randomUUID().slice(0, 8)}`;
    const agentRole: AgentRole = role === "supervisor" ? "supervisor" : "agent";
    const staffType = role === "supervisor" ? undefined : (role as StaffType);
    const supervisor = role === "supervisor" ? undefined : branchSupervisor();
    const password = (row.password && row.password.length >= 6) ? row.password : "demo123";
    const newAgent: DemoAgent = {
      userId, id, name, email, branch,
      active: true,
      role: agentRole,
      staffType,
      supervisorId: supervisor?.userId,
      createdByUserId: me.id,
      createdByRole: "admin",
    };
    agents.push(newAgent);
    users.push({
      id: userId, email, password, name,
      role: role === "supervisor" ? "supervisor" : "agent",
      agentId: agentRole === "agent" ? id : undefined,
      branch,
    });
    result.created += 1;
  });

  dsSetAgents(agents);
  setUsers(users);
  logEvent({
    action: "agents.bulk_imported",
    entityType: "agent", entityId: null, entityLabel: branch, branch,
    meta: { created: result.created, skipped: result.skipped.length },
  });
  return result;
}

