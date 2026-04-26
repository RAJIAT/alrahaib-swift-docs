/**
 * Mock API service layer.
 *
 * IMPORTANT: All UI calls go through this module. To switch to a real REST
 * backend later, replace the function bodies with `fetch(...)` calls — the
 * function signatures and return shapes can stay the same.
 *
 * Suggested REST mapping (for later):
 *   POST   /api/uploads          -> submitUpload
 *   POST   /api/auth/login       -> login
 *   GET    /api/requests         -> listRequests (admin sees all, agent scoped)
 *   GET    /api/requests/:id     -> getRequest
 *   PATCH  /api/requests/:id     -> updateRequestStatus
 */

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
};

const SAMPLE_IMG =
  "https://images.unsplash.com/photo-1486006920555-c77dcf18193c?w=800&q=70";

const BRANCHES = ["Abu Dhabi", "Dubai", "Sharjah"];
const AGENTS = [
  { id: "A123", name: "Ahmed Al Mansouri" },
  { id: "A124", name: "Fatima Al Zaabi" },
  { id: "A125", name: "Yousef Al Shamsi" },
];

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
    return s;
  }
  try { return JSON.parse(raw); } catch { return []; }
}

function save(list: InsuranceRequest[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE.requests, JSON.stringify(list));
}

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

// ---------- Auth ----------
export async function login(email: string, _password: string): Promise<AuthUser> {
  await delay(500);
  const e = email.trim().toLowerCase();
  if (e === "admin@aib.com") {
    const u: AuthUser = { id: "U1", email: e, name: "Admin User", role: "admin" };
    localStorage.setItem(STORAGE.user, JSON.stringify(u));
    return u;
  }
  if (e === "agent@aib.com" || e.endsWith("@aib.com")) {
    const u: AuthUser = {
      id: "U2",
      email: e,
      name: "Ahmed Al Mansouri",
      role: "agent",
      agentId: "A123",
      branch: "Abu Dhabi",
    };
    localStorage.setItem(STORAGE.user, JSON.stringify(u));
    return u;
  }
  throw new Error("Invalid credentials");
}

export function logout() {
  if (typeof window !== "undefined") localStorage.removeItem(STORAGE.user);
}

export function getCurrentUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE.user);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------- Requests ----------
export async function listRequests(opts?: { agentId?: string }): Promise<InsuranceRequest[]> {
  await delay(250);
  const all = load().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return opts?.agentId ? all.filter((r) => r.agentId === opts.agentId) : all;
}

export async function getRequest(id: string): Promise<InsuranceRequest | null> {
  await delay(200);
  return load().find((r) => r.id === id) ?? null;
}

export async function updateRequestStatus(id: string, status: RequestStatus): Promise<InsuranceRequest> {
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
  await delay(800);
  // In a real backend we'd upload images. Here we just record a new request with sample images.
  const list = load();
  const id = `REQ-${1000 + list.length}`;
  const agent = AGENTS.find((a) => a.id === input.agentId) ?? AGENTS[0];
  const newReq: InsuranceRequest = {
    id,
    agentId: input.agentId,
    agentName: agent.name,
    branch: BRANCHES[list.length % BRANCHES.length],
    status: "new",
    createdAt: new Date().toISOString(),
    images: { registration: SAMPLE_IMG, license: SAMPLE_IMG, emirates: SAMPLE_IMG },
  };
  save([newReq, ...list]);
  return { id };
}

export function listAgents() { return AGENTS; }
export function listBranches() { return BRANCHES; }
