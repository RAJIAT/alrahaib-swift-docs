/**
 * API service layer — Directus-backed.
 *
 * Every read and write goes to the on-premise Directus instance via the
 * /api/directus same-origin proxy (see src/routes/api/directus.$.ts). No
 * business data lives in localStorage anymore — only the Directus session
 * tokens (handled inside src/services/directus.ts) and a small cached copy
 * of the current user (so synchronous getCurrentUser() keeps working).
 */

import {
  dxLogin, dxLogout, dxFetchMe, dxHasSession, isDirectusEnabled,
  dxListRequests, dxGetRequest, dxCreateRequest, dxUpdateRequestStatus,
  dxListNotes, dxCreateNote, dxResolveNote,
  dxListAttachments, dxCreateAttachment,
  dxListVehicleMedia, dxCreateVehicleMedia,
  dxListBranches, dxCreateBranch, dxUpdateBranch, dxDeleteBranch,
  dxListAgents, dxCreateAgent, dxUpdateAgent, dxDeleteAgent,
  dxUploadFile, dxAssetUrl, dxFetchAsset, isDirectusAssetUrl,
  type DxUser, type DxRequest, type DxNote, type DxAttachment,
  type DxVehicleMedia, type DxBranch,
} from "./directus";

// ---------------------------------------------------------------------------
// Public types (kept stable so the rest of the app keeps working)
// ---------------------------------------------------------------------------

export type RequestStatus =
  | "new"
  | "linkSent"
  | "processing"
  | "sold"
  | "rejected"
  | "reupload";

export type RequestNoteKind = "comment" | "missing";

export type RequestNote = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: "admin" | "supervisor" | "agent";
  text: string;
  kind: RequestNoteKind;
  createdAt: string;
  resolvedAt?: string;
};

export type AttachmentMeta = {
  name: string;
  type: string;
  size: number;
  url: string;
};

export type InsuranceRequest = {
  id: string;
  uuid: string;
  agentId: string;
  agentName: string;
  branch: string;
  status: RequestStatus;
  createdAt: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  notes: RequestNote[];
  images: {
    registration: string[];
    license: string[];
    emirates: string[];
    vehicleMedia: Array<
      | { kind: "image"; url: string }
      | { kind: "video"; name: string; size: number; type: string }
    >;
    inspection?: string;
    attachments: AttachmentMeta[];
    missingAttachments?: AttachmentMeta[];
  };
};

export type Role = "agent" | "admin" | "supervisor";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  agentId?: string;
  branch?: string;
};

export function canDelete(u: AuthUser | null | undefined): boolean {
  return u?.role === "admin";
}
export function canManageAgents(u: AuthUser | null | undefined): boolean {
  return u?.role === "admin" || u?.role === "supervisor";
}
export function canDeleteAgents(u: AuthUser | null | undefined): boolean {
  return u?.role === "admin";
}
export function canSeeAllBranches(u: AuthUser | null | undefined): boolean {
  return u?.role === "admin";
}

// Re-export so existing callers keep working.
export { dxAssetUrl, dxFetchAsset, isDirectusAssetUrl };

// ---------------------------------------------------------------------------
// Local state — only the auth cache and a small in-memory mirror so that
// synchronous list*() helpers can return immediately while the network
// request refreshes the cache in the background.
// ---------------------------------------------------------------------------

const AUTH_KEY = "aib_auth_user";
const CHANGE_EVENT = "aib:requests-changed";
const AGENTS_CHANGE_EVENT = "aib:agents-changed";
const BRANCHES_CHANGE_EVENT = "aib:branches-changed";

function notifyChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}
function notifyAgentsChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENTS_CHANGE_EVENT));
}
function notifyBranchesChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BRANCHES_CHANGE_EVENT));
}

export function subscribeRequests(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}
export function subscribeAgents(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(AGENTS_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(AGENTS_CHANGE_EVENT, onChange);
}
export function subscribeBranches(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(BRANCHES_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(BRANCHES_CHANGE_EVENT, onChange);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function mapDxUserToAuth(me: {
  id: string; email: string;
  first_name?: string; last_name?: string;
  role?: { name?: string };
  agent_id?: string; branch?: string;
}): AuthUser {
  const roleName = (me.role?.name ?? "").toLowerCase();
  let role: Role = "agent";
  if (roleName.includes("admin")) role = "admin";
  else if (roleName.includes("supervisor")) role = "supervisor";
  const name = [me.first_name, me.last_name].filter(Boolean).join(" ").trim() || me.email;
  return {
    id: me.id,
    email: me.email,
    name,
    role,
    agentId: me.agent_id,
    branch: me.branch,
  };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  if (!isDirectusEnabled()) throw new Error("Backend not configured");
  const me = await dxLogin(email, password);
  const auth = mapDxUserToAuth(me);
  if (typeof window !== "undefined") {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  }
  import("./audit").then(({ logEvent }) =>
    logEvent({
      action: "auth.login",
      entityType: "auth",
      entityId: auth.id,
      entityLabel: auth.name,
      branch: auth.branch ?? null,
      actor: { id: auth.id, name: auth.name, role: auth.role, branch: auth.branch ?? null },
    }),
  );
  return auth;
}

export async function signUp(_email: string, _password: string, _fullName: string): Promise<AuthUser> {
  throw new Error("Sign up is disabled. Contact your administrator.");
}

export async function logout() {
  const cur = getCurrentUser();
  if (cur) {
    import("./audit").then(({ logEvent }) =>
      logEvent({
        action: "auth.logout",
        entityType: "auth",
        entityId: cur.id,
        entityLabel: cur.name,
        branch: cur.branch ?? null,
        actor: { id: cur.id, name: cur.name, role: cur.role, branch: cur.branch ?? null },
      }),
    );
  }
  try { dxLogout(); } catch { /* ignore */ }
  if (typeof window !== "undefined") localStorage.removeItem(AUTH_KEY);
}

export function getCurrentUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthUser; } catch { return null; }
}

export async function refreshCurrentUser(): Promise<AuthUser | null> {
  if (typeof window === "undefined") return null;
  if (!isDirectusEnabled() || !dxHasSession()) {
    localStorage.removeItem(AUTH_KEY);
    return null;
  }
  try {
    const me = await dxFetchMe();
    const auth = mapDxUserToAuth(me);
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    return auth;
  } catch {
    localStorage.removeItem(AUTH_KEY);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

let _branchesCache: DxBranch[] = [];

export function listBranches(): string[] {
  // Returns branch codes for legacy callers that expect string[].
  return _branchesCache.length
    ? _branchesCache.filter(b => b.is_active).map(b => b.code)
    : [];
}

export function listBranchObjects(): DxBranch[] {
  return _branchesCache;
}

export async function getBranches(opts?: { onlyActive?: boolean }): Promise<DxBranch[]> {
  const list = await dxListBranches(opts);
  _branchesCache = list;
  notifyBranchesChange();
  return list;
}

export async function createBranch(input: {
  name: string; code: string; address?: string; phone?: string; is_active?: boolean;
}): Promise<DxBranch> {
  const created = await dxCreateBranch({
    name: input.name,
    code: input.code,
    address: input.address ?? "",
    phone: input.phone ?? "",
    is_active: input.is_active ?? true,
  });
  await getBranches();
  return created;
}

export async function updateBranch(id: number, patch: Partial<{
  name: string; code: string; address: string; phone: string; is_active: boolean;
}>): Promise<DxBranch> {
  const updated = await dxUpdateBranch(id, patch);
  await getBranches();
  return updated;
}

export async function deleteBranch(id: number): Promise<void> {
  await dxDeleteBranch(id);
  await getBranches();
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function fileIdToUrl(fileId: string | null | undefined): string {
  if (!fileId) return "";
  return dxAssetUrl(fileId);
}

function mapDxRequestToInsurance(
  r: DxRequest,
  notes: DxNote[],
  attachments: DxAttachment[],
  missingAttachments: DxAttachment[],
  vehicleMedia: DxVehicleMedia[],
): InsuranceRequest {
  const noteRoleMap: Record<string, RequestNote["authorRole"]> = {
    admin: "admin", supervisor: "supervisor", agent: "agent",
  };
  return {
    id: r.request_display_id || String(r.id),
    uuid: String(r.id),
    agentId: r.agent_id ?? "",
    agentName: r.agent_name ?? "",
    branch: r.branch ?? "",
    status: (r.status as RequestStatus) || "new",
    createdAt: r.date_created,
    customerName: r.customer_name ?? undefined,
    customerEmail: r.customer_email ?? undefined,
    customerPhone: r.customer_phone ?? undefined,
    notes: notes.map((n) => ({
      id: String(n.id),
      authorId: n.author_id ?? "",
      authorName: n.author_name ?? "",
      authorRole: noteRoleMap[(n.author_role ?? "").toLowerCase()] ?? "agent",
      text: n.text,
      kind: (n.kind as RequestNoteKind) || "comment",
      createdAt: n.date_created,
      resolvedAt: n.resolved_at ?? undefined,
    })),
    images: {
      registration: r.registration ? [fileIdToUrl(r.registration)] : [],
      license: r.license ? [fileIdToUrl(r.license)] : [],
      emirates: r.emirates ? [fileIdToUrl(r.emirates)] : [],
      vehicleMedia: vehicleMedia.map((m) =>
        m.kind === "video"
          ? { kind: "video" as const, name: "video", size: 0, type: "video/mp4" }
          : { kind: "image" as const, url: fileIdToUrl(m.file) },
      ),
      inspection: r.inspection ? fileIdToUrl(r.inspection) : undefined,
      attachments: attachments.map((a) => ({
        name: a.original_name ?? "file",
        type: "",
        size: 0,
        url: fileIdToUrl(a.file),
      })),
      missingAttachments: missingAttachments.length
        ? missingAttachments.map((a) => ({
            name: a.original_name ?? "file",
            type: "",
            size: 0,
            url: fileIdToUrl(a.file),
          }))
        : undefined,
    },
  };
}

export async function listRequests(opts?: { agentId?: string; branch?: string }): Promise<InsuranceRequest[]> {
  const rows = await dxListRequests({ agentId: opts?.agentId, branch: opts?.branch });
  // For list view we don't fetch notes/attachments per row (too many round-trips).
  return rows.map((r) => mapDxRequestToInsurance(r, [], [], [], []));
}

export async function getRequest(id: string): Promise<InsuranceRequest | null> {
  const row = await dxGetRequest(id);
  if (!row) return null;
  const reqId = String(row.id);
  const [notes, attachments, missing, vehicleMedia] = await Promise.all([
    dxListNotes(reqId).catch(() => [] as DxNote[]),
    dxListAttachments(reqId, false).catch(() => [] as DxAttachment[]),
    dxListAttachments(reqId, true).catch(() => [] as DxAttachment[]),
    dxListVehicleMedia(reqId).catch(() => [] as DxVehicleMedia[]),
  ]);
  return mapDxRequestToInsurance(row, notes, attachments, missing, vehicleMedia);
}

export async function resolveAssetUrl(stored: string): Promise<{ url: string; mime: string }> {
  if (!stored) return { url: "", mime: "" };
  // For Directus assets we fetch with auth and return a blob URL.
  if (isDirectusAssetUrl(stored)) {
    const m = stored.match(/\/assets\/([^/?#]+)/);
    if (m) {
      const fetched = await dxFetchAsset(m[1]);
      if (fetched) return fetched;
    }
  }
  // Fallback: treat as direct URL or data URL.
  let mime = "";
  const m = stored.match(/^data:([^;]+);/);
  if (m) mime = m[1];
  return { url: stored, mime };
}

export async function updateRequestStatus(id: string, status: RequestStatus): Promise<InsuranceRequest> {
  const cur = await dxGetRequest(id);
  if (!cur) throw new Error("Request not found");
  const before = cur.status;
  await dxUpdateRequestStatus(String(cur.id), status);
  const fresh = await getRequest(String(cur.id));
  if (!fresh) throw new Error("Request not found");
  notifyChange();
  if (before !== status) {
    import("./audit").then(({ logEvent }) =>
      logEvent({
        action: "request.status_changed",
        entityType: "request",
        entityId: fresh.id,
        entityLabel: fresh.id,
        branch: fresh.branch ?? null,
        before: { status: before },
        after: { status },
      }),
    );
  }
  return fresh;
}

async function uploadFirst(files: File[]): Promise<string | null> {
  const f = files[0];
  if (!f) return null;
  return await dxUploadFile(f);
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
  // Upload "front" file for the three doc types — Directus stores one file id
  // per slot in the request row; the rest go into the *_attachments tables.
  const [registration, license, emirates] = await Promise.all([
    uploadFirst(input.images.registration),
    uploadFirst(input.images.license),
    uploadFirst(input.images.emirates),
  ]);
  const inspection = input.optional?.inspection
    ? await dxUploadFile(input.optional.inspection)
    : null;

  // Resolve agent's branch label from the cache (best-effort).
  const agent = listAgents().find((a) => a.id === input.agentId || a.userId === input.agentId);
  const branch = agent?.branch ?? "";
  const agentName = agent?.name ?? input.agentId;

  const created = await dxCreateRequest({
    agent_id: input.agentId,
    agent_name: agentName,
    branch,
    registration,
    license,
    emirates,
    inspection,
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    customer_phone: input.customerPhone,
  });
  const reqId = String(created.id);

  // Vehicle media (mixed images + videos).
  for (const f of input.images.vehicleMedia) {
    try {
      const fileId = await dxUploadFile(f);
      await dxCreateVehicleMedia({
        request: reqId,
        file: fileId,
        kind: f.type.startsWith("video/") ? "video" : "image",
      });
    } catch (e) { console.error("vehicle media upload failed", e); }
  }

  // Free-form attachments.
  for (const f of input.images.attachments ?? []) {
    try {
      const fileId = await dxUploadFile(f);
      await dxCreateAttachment({
        request: reqId,
        file: fileId,
        original_name: f.name,
      }, false);
    } catch (e) { console.error("attachment upload failed", e); }
  }

  // Also persist any extra registration/license/emirates pages as attachments.
  const extras = [
    ...input.images.registration.slice(1),
    ...input.images.license.slice(1),
    ...input.images.emirates.slice(1),
  ];
  for (const f of extras) {
    try {
      const fileId = await dxUploadFile(f);
      await dxCreateAttachment({
        request: reqId,
        file: fileId,
        original_name: f.name,
      }, false);
    } catch (e) { console.error("extra page upload failed", e); }
  }

  notifyChange();
  return { id: created.request_display_id || reqId };
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
  const row = await dxGetRequest(requestId);
  if (!row) throw new Error("Request not found");
  await dxCreateNote({
    request: String(row.id),
    text: input.text.trim(),
    kind: input.kind,
    author_id: me.id,
    author_name: me.name,
    author_role: me.role,
  });
  const fresh = await getRequest(String(row.id));
  if (!fresh) throw new Error("Request not found");
  notifyChange();
  return fresh;
}

export async function resolveRequestNote(
  requestId: string,
  noteId: string,
): Promise<InsuranceRequest> {
  const numericId = Number(noteId);
  if (Number.isFinite(numericId)) {
    await dxResolveNote(numericId);
  }
  const fresh = await getRequest(requestId);
  if (!fresh) throw new Error("Request not found");
  notifyChange();
  return fresh;
}

export async function appendAttachmentsToRequest(
  requestId: string,
  files: File[],
): Promise<InsuranceRequest> {
  const row = await dxGetRequest(requestId);
  if (!row) throw new Error("Request not found");
  const reqId = String(row.id);
  for (const f of files) {
    if (f.type.startsWith("video/")) continue;
    try {
      const fileId = await dxUploadFile(f);
      await dxCreateAttachment({
        request: reqId,
        file: fileId,
        original_name: f.name,
      }, true);
    } catch (e) { console.error("missing attachment upload failed", e); }
  }
  // Auto-resolve open "missing" notes and move status back to processing.
  try {
    const notes = await dxListNotes(reqId);
    for (const n of notes) {
      if (n.kind === "missing" && !n.resolved_at) {
        await dxResolveNote(n.id);
      }
    }
    await dxUpdateRequestStatus(reqId, "processing");
  } catch (e) { console.error("failed to flip request status to processing", e); }
  const fresh = await getRequest(reqId);
  if (!fresh) throw new Error("Request not found");
  notifyChange();
  return fresh;
}



// ---------------------------------------------------------------------------
// Agents directory — backed by Directus Users (role = "Agent" or "Supervisor")
// ---------------------------------------------------------------------------

export type AgentRole = "agent" | "supervisor";

export type Agent = {
  userId?: string;
  id: string;
  name: string;
  email?: string;
  branch?: string;
  active: boolean;
  role?: AgentRole;
  supervisorId?: string;
};

function dxUserToAgent(u: DxUser): Agent {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email;
  const roleName = (u.role?.name ?? "").toLowerCase();
  const role: AgentRole = roleName.includes("supervisor") ? "supervisor" : "agent";
  return {
    userId: u.id,
    id: u.agent_id || u.id,
    name,
    email: u.email,
    branch: u.branch,
    active: u.status === "active",
    role,
  };
}

let _agentsCache: Agent[] = [];

export function listAgents(): Agent[] { return _agentsCache; }

export async function getAgents(): Promise<Agent[]> {
  const users = await dxListAgents();
  _agentsCache = users.map(dxUserToAgent);
  notifyAgentsChange();
  return _agentsCache;
}

export async function createAgent(input: {
  id: string; name: string; email?: string; branch?: string; role?: AgentRole; supervisorId?: string;
  password?: string;
}): Promise<Agent> {
  if (!input.email) throw new Error("Email is required");
  if (!input.password || input.password.length < 6) throw new Error("Password (min 6 chars) is required");
  const [first_name, ...rest] = input.name.split(" ");
  const created = await dxCreateAgent({
    email: input.email,
    password: input.password,
    first_name: first_name || input.name,
    last_name: rest.join(" "),
    agent_id: input.id,
    branch: input.branch,
  });
  const agent = dxUserToAgent(created);
  await getAgents();
  import("./audit").then(({ logEvent }) =>
    logEvent({
      action: "agent.created",
      entityType: "agent",
      entityId: agent.id,
      entityLabel: agent.name,
      branch: agent.branch ?? null,
      after: agent,
    }),
  );
  return agent;
}

export async function updateAgent(id: string, patch: Partial<{
  name: string; email: string | null; branch: string | null; active: boolean; supervisorId: string | null;
  password: string;
}>): Promise<Agent> {
  const before = _agentsCache.find((a) => a.id === id || a.userId === id);
  if (!before || !before.userId) throw new Error("Agent not found");
  const dxPatch: Parameters<typeof dxUpdateAgent>[1] = {};
  if (patch.name !== undefined) {
    const [fn, ...rest] = patch.name.split(" ");
    dxPatch.first_name = fn || patch.name;
    dxPatch.last_name = rest.join(" ");
  }
  if (patch.branch !== undefined) dxPatch.branch = patch.branch;
  if (patch.active !== undefined) dxPatch.status = patch.active ? "active" : "suspended";
  if (patch.password) dxPatch.password = patch.password;
  const updated = await dxUpdateAgent(before.userId, dxPatch);
  const after = dxUserToAgent(updated);
  await getAgents();
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  (["name", "email", "branch", "active"] as const).forEach((k) => {
    if ((before as any)[k] !== (after as any)[k]) {
      changed[k] = { before: (before as any)[k], after: (after as any)[k] };
    }
  });
  let action: "agent.updated" | "agent.activated" | "agent.deactivated" = "agent.updated";
  if (Object.keys(changed).length === 1 && "active" in changed) {
    action = after.active ? "agent.activated" : "agent.deactivated";
  }
  import("./audit").then(({ logEvent }) =>
    logEvent({
      action,
      entityType: "agent",
      entityId: after.id,
      entityLabel: after.name,
      branch: after.branch ?? null,
      before, after,
      meta: { changed: Object.keys(changed) },
    }),
  );
  return after;
}

export async function deleteAgent(id: string): Promise<void> {
  const before = _agentsCache.find((a) => a.id === id || a.userId === id);
  if (!before || !before.userId) throw new Error("Agent not found");
  await dxDeleteAgent(before.userId);
  await getAgents();
  import("./audit").then(({ logEvent }) =>
    logEvent({
      action: "agent.deleted",
      entityType: "agent",
      entityId: before.id,
      entityLabel: before.name,
      branch: before.branch ?? null,
      before,
    }),
  );
}
