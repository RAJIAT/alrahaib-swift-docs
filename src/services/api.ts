/**
 * API service layer — DEMO MODE (localStorage only, no backend).
 *
 * Keeps the same exports as before so the rest of the app keeps working,
 * but every call reads/writes browser localStorage. Nothing is sent to
 * any server.
 */

export type RequestStatus = "new" | "processing" | "sold" | "rejected" | "reupload";

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
  images: {
    registration: string;
    license: string;
    emirates: string;
    inspection?: string;
    vehiclePhotos?: string[];
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

/** Permission helpers — single source of truth for role gates. */
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

const REQUESTS_KEY = "aib_requests";
const AGENTS_KEY = "aib_agents";
const AUTH_KEY = "aib_auth_user";
const SEQ_KEY = "aib_req_seq";
const CHANGE_EVENT = "aib:requests-changed";
const AGENTS_CHANGE_EVENT = "aib:agents-changed";

const BRANCHES = ["Abu Dhabi", "Dubai", "Sharjah"];

// ---------------------------------------------------------------------------
// storage helpers
// ---------------------------------------------------------------------------

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function notifyChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function notifyAgentsChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENTS_CHANGE_EVENT));
}

function nextDisplayId(): string {
  const cur = Number(localStorage.getItem(SEQ_KEY) ?? "1000");
  const next = cur + 1;
  localStorage.setItem(SEQ_KEY, String(next));
  return `REQ-${next}`;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

export function subscribeRequests(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function subscribeAgents(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(AGENTS_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(AGENTS_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// ---------------------------------------------------------------------------
// Auth (demo)
// ---------------------------------------------------------------------------

const DEMO_USERS: Array<AuthUser & { password: string }> = [
  {
    id: "u-admin",
    email: "admin@aib.com",
    password: "admin123",
    name: "Admin",
    role: "admin",
  },
  {
    id: "u-supervisor",
    email: "supervisor@aib.com",
    password: "demo",
    name: "Demo Supervisor",
    role: "supervisor",
    branch: "Abu Dhabi",
  },
  {
    id: "u-agent",
    email: "agent@aib.com",
    password: "agent123",
    name: "Demo Agent",
    role: "agent",
    agentId: "A001",
    branch: "Abu Dhabi",
  },
];

export async function login(email: string, _password: string): Promise<AuthUser> {
  // Demo mode: any password is accepted for the demo accounts.
  const u = DEMO_USERS.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!u) throw new Error("Invalid credentials");
  const { password: _pw, ...auth } = u;
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  // Audit (lazy import to avoid circular dep)
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

export async function signUp(email: string, _password: string, fullName: string): Promise<AuthUser> {
  const auth: AuthUser = {
    id: uuid(),
    email,
    name: fullName || email,
    role: "agent",
    agentId: "A" + Math.floor(100 + Math.random() * 900),
    branch: BRANCHES[0],
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  return auth;
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
  localStorage.removeItem(AUTH_KEY);
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
// Requests
// ---------------------------------------------------------------------------

function readRequests(): InsuranceRequest[] {
  return readJSON<InsuranceRequest[]>(REQUESTS_KEY, []);
}

function writeRequests(list: InsuranceRequest[]) {
  writeJSON(REQUESTS_KEY, list);
}

export async function resolveAssetUrl(stored: string): Promise<{ url: string; mime: string }> {
  if (!stored) return { url: "", mime: "" };
  // In demo mode we store data URLs directly.
  let mime = "";
  const m = stored.match(/^data:([^;]+);/);
  if (m) mime = m[1];
  return { url: stored, mime };
}

export async function listRequests(opts?: { agentId?: string; branch?: string }): Promise<InsuranceRequest[]> {
  const all = readRequests().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  let out = all;
  if (opts?.agentId) out = out.filter((r) => r.agentId === opts.agentId);
  if (opts?.branch) out = out.filter((r) => r.branch === opts.branch);
  return out;
}

export async function getRequest(id: string): Promise<InsuranceRequest | null> {
  const all = readRequests();
  return all.find((r) => r.id === id || r.uuid === id) ?? null;
}

export async function updateRequestStatus(id: string, status: RequestStatus): Promise<InsuranceRequest> {
  const all = readRequests();
  const idx = all.findIndex((r) => r.id === id || r.uuid === id);
  if (idx === -1) throw new Error("Request not found");
  const before = all[idx];
  all[idx] = { ...before, status };
  writeRequests(all);
  notifyChange();
  if (before.status !== status) {
    import("./audit").then(({ logEvent }) =>
      logEvent({
        action: "request.status_changed",
        entityType: "request",
        entityId: before.id,
        entityLabel: before.id,
        branch: before.branch ?? null,
        before: { status: before.status },
        after: { status },
      }),
    );
  }
  return all[idx];
}

export async function submitUpload(input: {
  agentId: string;
  customerName?: string;
  customerEmail?: string;
  images: { registration: File; license: File; emirates: File };
  optional?: { inspection?: File | null; vehiclePhotos?: File[] };
}): Promise<{ id: string }> {
  const [registration, license, emirates] = await Promise.all([
    fileToDataUrl(input.images.registration),
    fileToDataUrl(input.images.license),
    fileToDataUrl(input.images.emirates),
  ]);
  const inspection = input.optional?.inspection ? await fileToDataUrl(input.optional.inspection) : undefined;
  const vehiclePhotos = input.optional?.vehiclePhotos?.length
    ? await Promise.all(input.optional.vehiclePhotos.map((f) => fileToDataUrl(f)))
    : undefined;

  const agent = listAgents().find((a) => a.id === input.agentId);
  const all = readRequests();
  const id = nextDisplayId();
  const req: InsuranceRequest = {
    id,
    uuid: uuid(),
    agentId: input.agentId,
    agentName: agent?.name ?? input.agentId,
    branch: agent?.branch ?? "—",
    status: "new",
    createdAt: new Date().toISOString(),
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    images: { registration, license, emirates, inspection, vehiclePhotos },
  };
  all.unshift(req);
  writeRequests(all);
  notifyChange();
  return { id };
}

export function isDemoMode() { return true; }

export function resetDemo() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(REQUESTS_KEY);
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(SEQ_KEY);
  localStorage.removeItem(AGENTS_KEY);
  notifyChange();
  notifyAgentsChange();
}

// ---------------------------------------------------------------------------
// Agents directory
// ---------------------------------------------------------------------------

export type AgentRole = "agent" | "supervisor";

export type Agent = {
  userId?: string;
  id: string;
  name: string;
  email?: string;
  branch?: string;
  active: boolean;
  /** Role of this directory entry. Defaults to "agent" for legacy records. */
  role?: AgentRole;
};

const DEFAULT_AGENTS: Agent[] = [
  { id: "A001", name: "Demo Agent", email: "agent@aib.com", branch: "Abu Dhabi", active: true, role: "agent" },
  { id: "A002", name: "Dubai Agent", branch: "Dubai", active: true, role: "agent" },
  { id: "S001", name: "Demo Supervisor", email: "supervisor@aib.com", branch: "Abu Dhabi", active: true, role: "supervisor" },
];

function readAgents(): Agent[] {
  const list = readJSON<Agent[] | null>(AGENTS_KEY, null);
  if (!list) {
    writeJSON(AGENTS_KEY, DEFAULT_AGENTS);
    return [...DEFAULT_AGENTS];
  }
  return list;
}

export function listAgents(): Agent[] { return readAgents(); }
export function listBranches(): string[] { return BRANCHES; }

export async function getAgents(): Promise<Agent[]> { return readAgents(); }

export async function createAgent(input: {
  id: string; name: string; email?: string; branch?: string; role?: AgentRole;
}): Promise<Agent> {
  const list = readAgents();
  if (list.some((a) => a.id === input.id)) throw new Error("Agent ID already exists");
  const agent: Agent = { ...input, role: input.role ?? "agent", active: true };
  list.push(agent);
  writeJSON(AGENTS_KEY, list);
  notifyAgentsChange();
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
  name: string; email: string | null; branch: string | null; active: boolean;
}>): Promise<Agent> {
  const list = readAgents();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error("Agent not found");
  const before = list[idx];
  const after: Agent = {
    ...before,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.email !== undefined ? { email: patch.email ?? undefined } : {}),
    ...(patch.branch !== undefined ? { branch: patch.branch ?? undefined } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
  };
  list[idx] = after;
  writeJSON(AGENTS_KEY, list);
  notifyAgentsChange();
  // Detect changed fields
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  (["name", "email", "branch", "active"] as const).forEach((k) => {
    if (before[k] !== after[k]) changed[k] = { before: before[k], after: after[k] };
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
      before,
      after,
      meta: { changed: Object.keys(changed) },
    }),
  );
  return after;
}

export async function deleteAgent(id: string): Promise<void> {
  const before = readAgents().find((a) => a.id === id);
  const list = readAgents().filter((a) => a.id !== id);
  writeJSON(AGENTS_KEY, list);
  notifyAgentsChange();
  if (before) {
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
}
