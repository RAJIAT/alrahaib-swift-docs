/**
 * API service layer.
 *
 * Two backends are supported via the same interface:
 *   1. Directus REST (when VITE_DIRECTUS_URL is set)  — production
 *   2. localStorage mock (when not set)               — demo / dev
 *
 * UI never imports the Directus client directly. To switch deployments,
 * just set VITE_DIRECTUS_URL in the build environment — no UI changes needed.
 *
 * REST mapping (Directus):
 *   POST   /auth/login                 -> login
 *   GET    /users/me                   -> getCurrentUser refresh
 *   GET    /items/requests             -> listRequests (filtered by agent for agents)
 *   GET    /items/requests/:id         -> getRequest
 *   PATCH  /items/requests/:id         -> updateRequestStatus
 *   POST   /files                      -> file upload (returns file id)
 *   POST   /items/requests             -> submitUpload (Public role)
 */

import { fileToStoredDataUrl } from "@/lib/imageUtils";
import {
  isDirectusEnabled,
  dxLogin, dxLogout, dxHasSession, dxAssetUrl, dxFetchMe,
  dxListRequests, dxGetRequest, dxCreateRequest, dxUpdateRequestStatus, dxUploadFile,
  dxListAgents, dxCreateAgent, dxUpdateAgent, dxDeleteAgent,
  type DxRequest, type DxUser,
} from "@/services/directus";

export type RequestStatus = "new" | "processing" | "sold" | "rejected" | "reupload";

export type InsuranceRequest = {
  id: string;
  agentId: string;
  agentName: string;
  branch: string;
  status: RequestStatus;
  createdAt: string; // ISO
  images: {
    registration: string;
    license: string;
    emirates: string;
  };
};

export type Role = "agent" | "admin";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  agentId?: string;
  branch?: string;
};

const STORAGE = {
  user: "aib_auth_user",
  requests: "aib_requests",
  seq: "aib_seq",
};

const CHANGE_EVENT = "aib:requests-changed";

const SAMPLE_IMG =
  "https://images.unsplash.com/photo-1486006920555-c77dcf18193c?w=800&q=70";

const BRANCHES = ["Abu Dhabi", "Dubai", "Sharjah"];
const AGENTS = [
  { id: "A123", name: "Ahmed Al Mansouri" },
  { id: "A124", name: "Fatima Al Zaabi" },
  { id: "A125", name: "Yousef Al Shamsi" },
];

// =====================================================================
// Mock helpers (used only when Directus is not configured)
// =====================================================================

function seed(): InsuranceRequest[] {
  const statuses: RequestStatus[] = ["new", "new", "processing", "sold", "rejected", "reupload", "new", "processing"];
  const now = Date.now();
  return statuses.map((status, i) => {
    const agent = AGENTS[i % AGENTS.length];
    return {
      id: `REQ-${1000 + i}`,
      agentId: agent.id,
      agentName: agent.name,
      branch: BRANCHES[i % BRANCHES.length],
      status,
      createdAt: new Date(now - i * 86400000 * 0.7).toISOString(),
      images: { registration: SAMPLE_IMG, license: SAMPLE_IMG, emirates: SAMPLE_IMG },
    };
  });
}

function load(): InsuranceRequest[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE.requests);
  if (!raw) {
    const s = seed();
    localStorage.setItem(STORAGE.requests, JSON.stringify(s));
    localStorage.setItem(STORAGE.seq, String(1000 + s.length));
    return s;
  }
  try { return JSON.parse(raw); } catch { return []; }
}

function save(list: InsuranceRequest[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE.requests, JSON.stringify(list));
  } catch {
    const trimmed = list.map((r, idx) =>
      idx < 5 ? r : { ...r, images: { registration: "", license: "", emirates: "" } },
    );
    try { localStorage.setItem(STORAGE.requests, JSON.stringify(trimmed)); } catch { /* ignore */ }
  }
  notifyChange();
}

function nextId(): string {
  if (typeof window === "undefined") return `REQ-${Date.now()}`;
  const cur = Number(localStorage.getItem(STORAGE.seq) ?? "1000");
  const next = cur + 1;
  localStorage.setItem(STORAGE.seq, String(next));
  return `REQ-${next}`;
}

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function notifyChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// =====================================================================
// Directus → InsuranceRequest mapping
// =====================================================================

function mapDx(r: DxRequest): InsuranceRequest {
  const cached = cachedAgents?.find((a) => a.id === r.agent_id);
  const agentMatch = cached ?? AGENTS.find((a) => a.id === r.agent_id);
  return {
    id: r.id,
    agentId: r.agent_id,
    agentName: r.agent_name || agentMatch?.name || r.agent_id,
    branch: r.branch || cached?.branch || "—",
    status: (r.status as RequestStatus) ?? "new",
    createdAt: r.date_created,
    images: {
      registration: dxAssetUrl(r.registration),
      license: dxAssetUrl(r.license),
      emirates: dxAssetUrl(r.emirates),
    },
  };
}

// =====================================================================
// Live updates
// =====================================================================

export function subscribeRequests(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE.requests) cb();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  // When Directus is enabled, lightly poll so admins see new uploads from
  // anonymous customers (they can't dispatch our local CustomEvent).
  let interval: ReturnType<typeof setInterval> | null = null;
  if (isDirectusEnabled()) {
    interval = setInterval(cb, 15000);
  }
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    if (interval) clearInterval(interval);
  };
}

// =====================================================================
// Auth
// =====================================================================

/**
 * Build-time guard: demo mode (no Directus URL configured) MUST NOT run in
 * production builds. In demo mode the login function ignores passwords by
 * design, so silently shipping it to production would mean any visitor can
 * sign in as admin. We hard-fail instead.
 */
function assertNotProductionDemo() {
  if (isDirectusEnabled()) return;
  // Lovable preview builds are technically production builds too, but they are
  // used for client demos. Keep demo-login disabled on published/custom domains
  // while allowing it on localhost and preview URLs.
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const isSafeDemoHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname.includes("-preview--");
  if (isSafeDemoHost) return;

  const isProd = typeof import.meta !== "undefined" && (import.meta as any).env?.PROD;
  if (isProd) {
    throw new Error(
      "Demo mode is not available in production. Set VITE_DIRECTUS_URL at build time to enable a real backend.",
    );
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  if (isDirectusEnabled()) {
    const me = await dxLogin(email, password);
    const roleName = (me.role?.name || "").toLowerCase();
    const role: Role = roleName.includes("admin") ? "admin" : "agent";
    const user: AuthUser = {
      id: me.id,
      email: me.email,
      name: [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email,
      role,
      agentId: me.agent_id,
      branch: me.branch,
    };
    localStorage.setItem(STORAGE.user, JSON.stringify(user));
    return user;
  }

  assertNotProductionDemo();
  await delay(500);
  const e = email.trim().toLowerCase();
  if (e === "admin@aib.com" || e === "admin@aib.local") {
    const u: AuthUser = { id: "U1", email: e, name: "Admin User", role: "admin" };
    localStorage.setItem(STORAGE.user, JSON.stringify(u));
    return u;
  }
  // Match against mock agents directory (created via /admin/agents)
  const directory = loadMockAgents();
  const match = directory.find((a) => a.email?.toLowerCase() === e && a.active);
  if (match) {
    const u: AuthUser = {
      id: match.userId ?? `U-${match.id}`, email: e, name: match.name,
      role: "agent", agentId: match.id, branch: match.branch,
    };
    localStorage.setItem(STORAGE.user, JSON.stringify(u));
    return u;
  }
  // Legacy demo fallback
  if (e === "agent@aib.com" || e.endsWith("@aib.com")) {
    const u: AuthUser = {
      id: "U2", email: e, name: "Ahmed Al Mansouri",
      role: "agent", agentId: "A123", branch: "Abu Dhabi",
    };
    localStorage.setItem(STORAGE.user, JSON.stringify(u));
    return u;
  }
  throw new Error("Invalid credentials");
}

export function logout() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE.user);
  if (isDirectusEnabled()) dxLogout();
}

export function getCurrentUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE.user);
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as AuthUser;
    // If Directus is enabled but the session token vanished, drop the local user too.
    if (isDirectusEnabled() && !dxHasSession()) {
      localStorage.removeItem(STORAGE.user);
      return null;
    }
    return u;
  } catch { return null; }
}

/**
 * Re-verify the current user against the backend. In Directus mode this calls
 * `/users/me` and refreshes the cached AuthUser (including role) so a user
 * cannot escalate privileges by editing localStorage. Returns null if the
 * session is no longer valid or if the cached role doesn't match the server.
 */
export async function refreshCurrentUser(): Promise<AuthUser | null> {
  if (typeof window === "undefined") return null;
  if (!isDirectusEnabled()) return getCurrentUser();
  if (!dxHasSession()) {
    localStorage.removeItem(STORAGE.user);
    return null;
  }
  try {
    const me = await dxFetchMe();
    const roleName = (me.role?.name || "").toLowerCase();
    const role: Role = roleName.includes("admin") ? "admin" : "agent";
    const user: AuthUser = {
      id: me.id,
      email: me.email,
      name: [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email,
      role,
      agentId: me.agent_id,
      branch: me.branch,
    };
    localStorage.setItem(STORAGE.user, JSON.stringify(user));
    return user;
  } catch {
    // Session invalid or network down — clear cached user to avoid a stale
    // role being trusted by the UI.
    localStorage.removeItem(STORAGE.user);
    dxLogout();
    return null;
  }
}

// =====================================================================
// Requests
// =====================================================================

export async function listRequests(opts?: { agentId?: string }): Promise<InsuranceRequest[]> {
  if (isDirectusEnabled()) {
    const rows = await dxListRequests(opts);
    return rows.map(mapDx);
  }
  await delay(250);
  const all = load().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return opts?.agentId ? all.filter((r) => r.agentId === opts.agentId) : all;
}

export async function getRequest(id: string): Promise<InsuranceRequest | null> {
  if (isDirectusEnabled()) {
    const r = await dxGetRequest(id);
    return r ? mapDx(r) : null;
  }
  await delay(200);
  return load().find((r) => r.id === id) ?? null;
}

export async function updateRequestStatus(id: string, status: RequestStatus): Promise<InsuranceRequest> {
  if (isDirectusEnabled()) {
    const r = await dxUpdateRequestStatus(id, status);
    notifyChange();
    return mapDx(r);
  }
  await delay(300);
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("Not found");
  list[idx] = { ...list[idx], status };
  save(list);
  return list[idx];
}

export async function submitUpload(input: {
  agentId: string;
  images: { registration: File; license: File; emirates: File };
}): Promise<{ id: string }> {
  if (isDirectusEnabled()) {
    const [registration, license, emirates] = await Promise.all([
      dxUploadFile(input.images.registration),
      dxUploadFile(input.images.license),
      dxUploadFile(input.images.emirates),
    ]);
    const agent = (cachedAgents ?? []).find((a) => a.id === input.agentId);
    const r = await dxCreateRequest({
      agent_id: input.agentId,
      agent_name: agent?.name,
      branch: agent?.branch,
      registration, license, emirates,
    });
    notifyChange();
    return { id: r.id };
  }

  // Mock path
  await delay(700 + Math.floor(Math.random() * 500));
  const [registration, license, emirates] = await Promise.all([
    fileToStoredDataUrl(input.images.registration),
    fileToStoredDataUrl(input.images.license),
    fileToStoredDataUrl(input.images.emirates),
  ]);
  const list = load();
  const id = nextId();
  const directory = loadMockAgents();
  const agent = directory.find((a) => a.id === input.agentId) ?? directory[0];
  const newReq: InsuranceRequest = {
    id, agentId: agent.id, agentName: agent.name,
    branch: agent.branch ?? BRANCHES[list.length % BRANCHES.length],
    status: "new", createdAt: new Date().toISOString(),
    images: { registration, license, emirates },
  };
  save([newReq, ...list]);
  return { id };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// =====================================================================
// Demo helpers
// =====================================================================

export function resetDemo() {
  if (typeof window === "undefined") return;
  if (isDirectusEnabled()) {
    // In a real Directus deployment we never wipe data from the client.
    localStorage.removeItem(STORAGE.user);
    dxLogout();
    notifyChange();
    return;
  }
  localStorage.removeItem(STORAGE.requests);
  localStorage.removeItem(STORAGE.user);
  localStorage.removeItem(STORAGE.seq);
  load();
  notifyChange();
}

export function isDemoMode() { return !isDirectusEnabled(); }

// =====================================================================
// Agents directory (Admin manages, others read)
// =====================================================================

export type Agent = {
  userId?: string;        // Directus user UUID (undefined in demo mode)
  id: string;             // agent_id (business identifier used in URLs and requests)
  name: string;
  email?: string;
  branch?: string;
  active: boolean;
};

const AGENTS_CHANGE_EVENT = "aib:agents-changed";
const MOCK_AGENTS_KEY = "aib_agents";

function notifyAgentsChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENTS_CHANGE_EVENT));
}

export function subscribeAgents(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(AGENTS_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(AGENTS_CHANGE_EVENT, onChange);
}

function mapDxUser(u: DxUser): Agent {
  return {
    userId: u.id,
    id: u.agent_id || u.id,
    name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
    email: u.email,
    branch: u.branch,
    active: u.status === "active",
  };
}

function loadMockAgents(): Agent[] {
  if (typeof window === "undefined") return AGENTS.map((a) => ({ ...a, active: true }));
  const raw = localStorage.getItem(MOCK_AGENTS_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* ignore */ }
  }
  const seeded: Agent[] = AGENTS.map((a, i) => ({
    id: a.id, name: a.name,
    email: `${a.id.toLowerCase()}@aib.local`,
    branch: BRANCHES[i % BRANCHES.length],
    active: true,
  }));
  localStorage.setItem(MOCK_AGENTS_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveMockAgents(list: Agent[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(MOCK_AGENTS_KEY, JSON.stringify(list));
  notifyAgentsChange();
}

// Async source-of-truth (used by admin agents page)
export async function getAgents(): Promise<Agent[]> {
  if (isDirectusEnabled()) {
    const users = await dxListAgents();
    const list = users.map(mapDxUser);
    cachedAgents = list;
    return list;
  }
  await delay(150);
  const list = loadMockAgents();
  cachedAgents = list;
  return list;
}

// Synchronous snapshot (used by filters and labels — refreshed by getAgents)
let cachedAgents: Agent[] | null = null;
export function listAgents(): Agent[] {
  if (cachedAgents) return cachedAgents;
  // Fall back to mock seed in demo, or static names so UI still labels rows
  // before the async fetch completes in production.
  if (typeof window !== "undefined" && !isDirectusEnabled()) {
    cachedAgents = loadMockAgents();
    return cachedAgents;
  }
  return AGENTS.map((a) => ({ id: a.id, name: a.name, active: true }));
}

export function listBranches() { return BRANCHES; }

export async function createAgent(input: {
  email: string; password: string; name: string;
  agentId: string; branch?: string;
}): Promise<Agent> {
  const [first_name, ...rest] = input.name.trim().split(/\s+/);
  const last_name = rest.join(" ");
  if (isDirectusEnabled()) {
    const u = await dxCreateAgent({
      email: input.email, password: input.password,
      first_name, last_name, agent_id: input.agentId, branch: input.branch,
    });
    notifyAgentsChange();
    return mapDxUser(u);
  }
  await delay(300);
  const list = loadMockAgents();
  if (list.some((a) => a.id === input.agentId)) throw new Error("Agent ID already exists");
  if (list.some((a) => a.email === input.email)) throw new Error("Email already exists");
  const next: Agent = {
    id: input.agentId, name: input.name, email: input.email,
    branch: input.branch, active: true,
  };
  saveMockAgents([...list, next]);
  return next;
}

export async function updateAgent(agent: Agent, patch: {
  name?: string; branch?: string; active?: boolean; password?: string;
}): Promise<Agent> {
  if (isDirectusEnabled() && agent.userId) {
    const [first_name, ...rest] = (patch.name ?? agent.name).trim().split(/\s+/);
    const last_name = rest.join(" ");
    const dxPatch: Parameters<typeof dxUpdateAgent>[1] = {};
    if (patch.name !== undefined) { dxPatch.first_name = first_name; dxPatch.last_name = last_name; }
    if (patch.branch !== undefined) dxPatch.branch = patch.branch || null;
    if (patch.active !== undefined) dxPatch.status = patch.active ? "active" : "suspended";
    if (patch.password) dxPatch.password = patch.password;
    const u = await dxUpdateAgent(agent.userId, dxPatch);
    notifyAgentsChange();
    return mapDxUser(u);
  }
  await delay(250);
  const list = loadMockAgents();
  const idx = list.findIndex((a) => a.id === agent.id);
  if (idx < 0) throw new Error("Agent not found");
  list[idx] = {
    ...list[idx],
    name: patch.name ?? list[idx].name,
    branch: patch.branch ?? list[idx].branch,
    active: patch.active ?? list[idx].active,
  };
  saveMockAgents(list);
  return list[idx];
}

export async function deleteAgent(agent: Agent): Promise<void> {
  if (isDirectusEnabled() && agent.userId) {
    await dxDeleteAgent(agent.userId);
    notifyAgentsChange();
    return;
  }
  await delay(200);
  const list = loadMockAgents().filter((a) => a.id !== agent.id);
  saveMockAgents(list);
}

