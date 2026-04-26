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
  dxLogin, dxLogout, dxHasSession, dxAssetUrl,
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
  const agentMatch = AGENTS.find((a) => a.id === r.agent_id);
  return {
    id: r.id,
    agentId: r.agent_id,
    agentName: r.agent_name || agentMatch?.name || r.agent_id,
    branch: r.branch || "—",
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

  await delay(500);
  const e = email.trim().toLowerCase();
  if (e === "admin@aib.com") {
    const u: AuthUser = { id: "U1", email: e, name: "Admin User", role: "admin" };
    localStorage.setItem(STORAGE.user, JSON.stringify(u));
    return u;
  }
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
    // 1) Upload the three files in parallel — Public role can create files.
    const [registration, license, emirates] = await Promise.all([
      dxUploadFile(input.images.registration),
      dxUploadFile(input.images.license),
      dxUploadFile(input.images.emirates),
    ]);
    // 2) Create the request — Public role has create on `requests`.
    const agent = AGENTS.find((a) => a.id === input.agentId);
    const r = await dxCreateRequest({
      agent_id: input.agentId,
      agent_name: agent?.name,
      branch: agent ? BRANCHES[Math.abs(hash(input.agentId)) % BRANCHES.length] : undefined,
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
  const agent = AGENTS.find((a) => a.id === input.agentId) ?? AGENTS[0];
  const newReq: InsuranceRequest = {
    id, agentId: agent.id, agentName: agent.name,
    branch: BRANCHES[list.length % BRANCHES.length],
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

export function listAgents() { return AGENTS; }
export function listBranches() { return BRANCHES; }
