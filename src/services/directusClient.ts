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
const DEACTIVATED_FLAG_KEY = "aib:auth-deactivated";

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch (with 30s skew)
};

export type ProfileSnapshot = {
  id: string;        // directus_users.id (uuid)
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  role: "admin" | "supervisor" | "agent";
  branch?: string;
  branchId?: number;
  agentId?: string;  // agent_code, or user id for older agents without a code
  staffType?: "underwriter" | "sales";
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

export function markAccountDeactivated() {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(DEACTIVATED_FLAG_KEY, "1"); } catch { /* ignore */ }
}

export function consumeAccountDeactivatedFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const fromSession = sessionStorage.getItem(DEACTIVATED_FLAG_KEY) === "1";
    const fromUrl = new URLSearchParams(window.location.search).get("deactivated") === "1";
    sessionStorage.removeItem(DEACTIVATED_FLAG_KEY);
    return fromSession || fromUrl;
  } catch {
    return false;
  }
}

export function clearAuthCache() {
  refreshPromise = null;
  saveTokens(null);
  setProfile(null);
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKENS_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch { /* ignore */ }
}

export function redirectToLoginForDeactivatedAccount() {
  if (typeof window === "undefined") return;
  markAccountDeactivated();
  if (window.location.pathname !== "/login") {
    window.location.replace("/login?deactivated=1");
  }
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
  // Refresh proactively when within 60s of expiry, or when already expired.
  if (Date.now() >= t.expires_at - 60_000) t = await refreshTokens();
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
  let token = await ensureFreshToken();
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  let headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  let res = await fetch(`${URL_BASE}${path}`, { ...init, headers });
  // Token may have been invalidated server-side between calls — retry once
  // with a forced refresh so idle users don't get bounced.
  if (res.status === 401 && getTokens()) {
    const refreshed = await refreshTokens();
    if (refreshed?.access_token) {
      token = refreshed.access_token;
      headers = {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${token}`,
        ...((init.headers as Record<string, string>) ?? {}),
      };
      res = await fetch(`${URL_BASE}${path}`, { ...init, headers });
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 403) {
      markAccountDeactivated();
      throw createAccountDeactivatedError();
    }
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
  assigned_underwriter?: string | { id: string; agent_code?: string | null } | null;
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
  "supervisor", "assigned_underwriter", "assigned_underwriter.id", "assigned_underwriter.agent_code", "assigned_underwriter_code",
  "pending_approval", "app_active", "app_created_by_role",
  "app_removal_reason", "app_removal_requested_by", "app_removal_requested_at",
].join(",");

function isFalseLike(value: unknown): boolean {
  if (typeof value === "string") return ["false", "0", "f", "no", "off", "inactive", "disabled"].includes(value.trim().toLowerCase());
  return value === false || value === 0;
}

function isTrueLike(value: unknown): boolean {
  if (typeof value === "string") return ["true", "1", "t", "yes", "on", "active", "enabled"].includes(value.trim().toLowerCase());
  return value === true || value === 1;
}

export function isDeactivatedUserRecord(u: Pick<DxUserRecord, "app_active" | "status">): boolean {
  const status = typeof u.status === "string" ? u.status.trim().toLowerCase() : "";
  return isFalseLike(u.app_active) || (!!status && status !== "active");
}

function createAccountDeactivatedError(): Error & { code: string } {
  const err = new Error("ACCOUNT_DEACTIVATED") as Error & { code: string };
  err.code = "ACCOUNT_DEACTIVATED";
  return err;
}

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

export function userBranchId(u: DxUserRecord): number | undefined {
  const b = u.branch;
  if (!b) return undefined;
  if (typeof b === "number") return b;
  if (typeof b === "object" && "id" in b) return b.id ?? undefined;
  return undefined;
}

export function userRecordToProfile(u: DxUserRecord): ProfileSnapshot {
  return {
    id: u.id,
    email: u.email,
    name: fullName(u),
    firstName: (u.first_name ?? "").trim() || undefined,
    lastName: (u.last_name ?? "").trim() || undefined,
    role: (u.app_role ?? "agent"),
    branch: userBranchCode(u),
    branchId: userBranchId(u),
    agentId: u.app_role === "agent" ? (u.agent_code || u.id) : (u.agent_code ?? undefined),
    staffType: u.staff_type ?? undefined,
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
  let me: { data: DxUserRecord };
  try {
    me = await dxRequest<{ data: DxUserRecord }>(`/users/me?fields=${USER_FIELDS}`);
  } catch (e) {
    await dxLogout();
    if ((e as DirectusError | null)?.status === 403) {
      markAccountDeactivated();
      throw createAccountDeactivatedError();
    }
    throw e;
  }
  if (isDeactivatedUserRecord(me.data)) {
    await dxLogout();
    markAccountDeactivated();
    throw createAccountDeactivatedError();
  }
  if (me.data.pending_approval === true) {
    await dxLogout();
    const err = new Error("ACCOUNT_PENDING_APPROVAL");
    (err as Error & { code?: string }).code = "ACCOUNT_PENDING_APPROVAL";
    throw err;
  }
  const profile = userRecordToProfile(me.data);
  setProfile(profile);
  return profile;
}

export async function dxLogout(): Promise<void> {
  const t = getTokens();
  clearAuthCache();
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
  // Directus /assets requires the file to be readable by the requesting role.
  // <img> tags don't send Authorization headers, so for authenticated users
  // we append the access token as a query param to keep private assets viewable.
  const tok = getTokens()?.access_token;
  return tok
    ? `${URL_BASE}/assets/${fileId}?access_token=${encodeURIComponent(tok)}`
    : `${URL_BASE}/assets/${fileId}`;
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
