/**
 * Directus client — production backend.
 *
 * - Auth: /auth/login + auto refresh, tokens in localStorage.
 * - Profile snapshot cached in localStorage so getCurrentUser() can stay sync.
 * - Generic dxRequest<T>(path, init) for REST + items.
 * - File upload returns { id, name, type, size } meta.
 * - Asset URL is `${BASE}/assets/{id}` — public read enabled by bootstrap.
 */

const URL_BASE = (import.meta.env.VITE_DIRECTUS_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export function dxBase(): string {
  if (!URL_BASE) throw new Error("VITE_DIRECTUS_URL is not configured.");
  return URL_BASE;
}

const TOKENS_KEY = "aib:dx:tokens:v2";
const PROFILE_KEY = "aib:dx:profile:v2";

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch (with 30s skew)
};

export type ProfileSnapshot = {
  id: string;        // directus_users.id (uuid)
  email: string;
  name: string;
  role: "admin" | "supervisor" | "agent";
  branch?: string;
  agentId?: string;  // agent_code, or user id for older agents without a code
};

// ---------- token + profile storage ----------

let memTokens: TokenSet | null = null;
let memProfile: ProfileSnapshot | null = null;

function loadTokens(): TokenSet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch { return null; }
}
function saveTokens(t: TokenSet | null) {
  memTokens = t;
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
  else localStorage.removeItem(TOKENS_KEY);
}
function getTokens(): TokenSet | null {
  if (memTokens) return memTokens;
  memTokens = loadTokens();
  return memTokens;
}

function loadProfile(): ProfileSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as ProfileSnapshot) : null;
  } catch { return null; }
}
export function getProfile(): ProfileSnapshot | null {
  if (memProfile) return memProfile;
  memProfile = loadProfile();
  return memProfile;
}
export function setProfile(p: ProfileSnapshot | null) {
  memProfile = p;
  if (typeof window === "undefined") return;
  if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  else localStorage.removeItem(PROFILE_KEY);
}

// ---------- token refresh ----------

let refreshPromise: Promise<TokenSet | null> | null = null;

async function refreshTokens(): Promise<TokenSet | null> {
  const t = getTokens();
  if (!t || !URL_BASE) return null;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${URL_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: t.refresh_token, mode: "json" }),
      });
      if (!res.ok) { saveTokens(null); setProfile(null); return null; }
      const j = (await res.json()) as { data: { access_token: string; refresh_token: string; expires: number } };
      const next: TokenSet = {
        access_token: j.data.access_token,
        refresh_token: j.data.refresh_token,
        expires_at: Date.now() + j.data.expires - 30_000,
      };
      saveTokens(next);
      return next;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function ensureFreshToken(): Promise<string | null> {
  let t = getTokens();
  if (!t) return null;
  if (Date.now() >= t.expires_at) t = await refreshTokens();
  return t?.access_token ?? null;
}

// ---------- generic REST ----------

export type DirectusError = Error & { status: number; body?: string };

function buildError(status: number, body: string): DirectusError {
  let msg = body || `HTTP ${status}`;
  try {
    const j = JSON.parse(body);
    if (j?.errors?.[0]?.message) msg = j.errors[0].message;
  } catch { /* keep body */ }
  const e = new Error(msg) as DirectusError;
  e.status = status;
  e.body = body;
  return e;
}

export async function dxRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!URL_BASE) throw new Error("VITE_DIRECTUS_URL is not configured.");
  const token = await ensureFreshToken();
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${URL_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw buildError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------- auth ----------

export type DxUserRecord = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  app_role?: "admin" | "supervisor" | "agent" | null;
  branch?: { id: number; code: string } | number | null;
  agent_code?: string | null;
  staff_type?: "underwriter" | "sales" | null;
  supervisor?: string | null;
  assigned_underwriter_code?: string | null;
  pending_approval?: boolean | null;
  app_active?: boolean | null;
  app_created_by_role?: string | null;
  app_removal_reason?: string | null;
  app_removal_requested_by?: string | null;
  app_removal_requested_at?: string | null;
  role?: string | null;
  status?: string | null;
};

export const USER_FIELDS = [
  "id", "email", "first_name", "last_name", "role", "status",
  "app_role", "agent_code", "staff_type",
  "branch.id", "branch.code",
  "supervisor", "assigned_underwriter_code",
  "pending_approval", "app_active", "app_created_by_role",
  "app_removal_reason", "app_removal_requested_by", "app_removal_requested_at",
].join(",");

function fullName(u: { first_name?: string | null; last_name?: string | null; email: string }) {
  const fn = (u.first_name ?? "").trim();
  const ln = (u.last_name ?? "").trim();
  const joined = `${fn} ${ln}`.trim();
  return joined || u.email;
}

export function userBranchCode(u: DxUserRecord): string | undefined {
  const b = u.branch;
  if (!b) return undefined;
  if (typeof b === "object" && "code" in b) return b.code ?? undefined;
  return undefined;
}

export function userRecordToProfile(u: DxUserRecord): ProfileSnapshot {
  return {
    id: u.id,
    email: u.email,
    name: fullName(u),
    role: (u.app_role ?? "agent"),
    branch: userBranchCode(u),
    agentId: u.app_role === "agent" ? (u.agent_code || u.id) : (u.agent_code ?? undefined),
  };
}

export async function dxLogin(email: string, password: string): Promise<ProfileSnapshot> {
  if (!URL_BASE) throw new Error("VITE_DIRECTUS_URL is not configured.");
  const res = await fetch(`${URL_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, mode: "json" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw buildError(res.status, body);
  }
  const j = (await res.json()) as { data: { access_token: string; refresh_token: string; expires: number } };
  saveTokens({
    access_token: j.data.access_token,
    refresh_token: j.data.refresh_token,
    expires_at: Date.now() + j.data.expires - 30_000,
  });
  const me = await dxRequest<{ data: DxUserRecord }>(`/users/me?fields=${USER_FIELDS}`);
  if (me.data.app_active === false) {
    await dxLogout();
    throw new Error("Your account is disabled");
  }
  if (me.data.pending_approval === true) {
    await dxLogout();
    throw new Error("Your account is pending approval");
  }
  const profile = userRecordToProfile(me.data);
  setProfile(profile);
  return profile;
}

export async function dxLogout(): Promise<void> {
  const t = getTokens();
  saveTokens(null);
  setProfile(null);
  if (!t || !URL_BASE) return;
  await fetch(`${URL_BASE}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: t.refresh_token, mode: "json" }),
  }).catch(() => {});
}

export function dxIsLoggedIn(): boolean {
  return !!getTokens();
}

// ---------- files ----------

export type UploadedFile = { id: string; name: string; type: string; size: number; url: string };

export function dxAssetUrl(fileId: string | null | undefined): string {
  if (!fileId || !URL_BASE) return "";
  return `${URL_BASE}/assets/${fileId}`;
}

export function dxIsAssetUrl(s: string): boolean {
  if (!s || !URL_BASE) return false;
  return s.startsWith(`${URL_BASE}/assets/`);
}

/**
 * Upload a single file. Works for both authenticated users and the public
 * uploader role (configured by bootstrap to allow CREATE on directus_files).
 */
export async function dxUploadFile(file: File): Promise<UploadedFile> {
  if (!URL_BASE) throw new Error("VITE_DIRECTUS_URL is not configured.");
  const fd = new FormData();
  fd.append("file", file, file.name);
  // Pass auth header only if signed in (public uploads don't have one).
  const token = await ensureFreshToken();
  const res = await fetch(`${URL_BASE}/files`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw buildError(res.status, body);
  }
  const j = (await res.json()) as {
    data: { id: string; filename_download: string; type: string; filesize: number };
  };
  return {
    id: j.data.id,
    name: j.data.filename_download ?? file.name,
    type: j.data.type ?? file.type,
    size: j.data.filesize ?? file.size,
    url: `${URL_BASE}/assets/${j.data.id}`,
  };
}

export async function dxUploadFiles(files: File[]): Promise<UploadedFile[]> {
  return Promise.all(files.map(dxUploadFile));
}
