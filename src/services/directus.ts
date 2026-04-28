/**
 * Directus REST client.
 *
 * Activated automatically when VITE_DIRECTUS_URL is defined.
 * Designed for an on-premise / Azure-UAE Directus instance so that
 * all data and files remain inside the UAE (no external SaaS).
 *
 * See DIRECTUS_SETUP.md for the full schema, roles and permissions.
 */

export const DIRECTUS_URL: string | undefined =
  (import.meta as any).env?.VITE_DIRECTUS_URL?.replace(/\/$/, "") || undefined;

export const isDirectusEnabled = () => !!DIRECTUS_URL;

const TOKEN_KEY = "aib_directus_token";
const REFRESH_KEY = "aib_directus_refresh";

type TokenBundle = { access_token: string; refresh_token: string; expires: number };

function readToken(): TokenBundle | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function writeToken(t: TokenBundle | null) {
  if (typeof window === "undefined") return;
  if (!t) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } else {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    localStorage.setItem(REFRESH_KEY, t.refresh_token);
  }
}

async function refreshIfNeeded(): Promise<string | null> {
  const t = readToken();
  if (!t) return null;
  if (Date.now() < t.expires - 30_000) return t.access_token;
  try {
    const res = await fetch(`${DIRECTUS_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: t.refresh_token, mode: "json" }),
    });
    if (!res.ok) { writeToken(null); return null; }
    const { data } = await res.json();
    const next: TokenBundle = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires: Date.now() + (data.expires ?? 900_000),
    };
    writeToken(next);
    return next.access_token;
  } catch {
    writeToken(null);
    return null;
  }
}

export async function dxFetch(path: string, init: RequestInit = {}, opts?: { auth?: boolean }) {
  if (!DIRECTUS_URL) throw new Error("Directus URL not configured");
  const headers = new Headers(init.headers);
  if (opts?.auth !== false) {
    const token = await refreshIfNeeded();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${DIRECTUS_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Log the raw backend body to the console for debugging only — never
    // surface it to end users (it can leak collection names, constraint
    // names, validation rule paths and other backend internals).
    if (typeof console !== "undefined") {
      console.error(`[directus] ${res.status} ${path}`, text);
    }
    throw new Error(safeErrorMessage(res.status));
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Map HTTP status codes to safe, user-friendly messages. */
function safeErrorMessage(status: number): string {
  if (status === 400) return "Invalid request. Please check the form and try again.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You are not authorized to perform this action.";
  if (status === 404) return "The requested item could not be found.";
  if (status === 409) return "This record already exists or conflicts with existing data.";
  if (status === 413) return "The file is too large.";
  if (status === 422) return "Some fields are invalid. Please review and try again.";
  if (status === 429) return "Too many requests. Please slow down and try again.";
  if (status >= 500) return "The server is temporarily unavailable. Please try again.";
  return "Request failed. Please try again.";
}

// ---------- Auth ----------
export async function dxLogin(email: string, password: string) {
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, mode: "json" }),
  });
  if (!res.ok) throw new Error("Invalid credentials");
  const { data } = await res.json();
  const t: TokenBundle = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires: Date.now() + (data.expires ?? 900_000),
  };
  writeToken(t);
  const me = await dxFetchMe();
  return me;
}

/** Fetch the currently authenticated Directus user. */
export async function dxFetchMe(): Promise<{
  id: string; email: string;
  first_name?: string; last_name?: string;
  role?: { name?: string };
  agent_id?: string; branch?: string; status?: string;
}> {
  const me = await dxFetch("/users/me?fields=id,email,first_name,last_name,role.name,agent_id,branch,status");
  return me.data as {
    id: string; email: string;
    first_name?: string; last_name?: string;
    role?: { name?: string };
    agent_id?: string; branch?: string; status?: string;
  };
}

export function dxLogout() { writeToken(null); }

export function dxHasSession() { return !!readToken(); }

// ---------- Files ----------
export async function dxUploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const json = await dxFetch("/files", { method: "POST", body: fd });
  return json.data.id as string;
}

/**
 * Returns the canonical asset URL for a Directus file. The URL deliberately
 * does NOT include the bearer token — never embed tokens in URLs (they leak
 * via browser history, server access logs and HTTP Referer headers).
 *
 * To actually load the binary, use `dxFetchAsset(fileId)` which sends the
 * token in an `Authorization` header and returns an object URL.
 */
export function dxAssetUrl(fileId: string) {
  if (!fileId) return "";
  return `${DIRECTUS_URL}/assets/${fileId}`;
}

/**
 * Fetch a Directus asset using a Bearer token in the Authorization header,
 * then expose it to the browser as an `blob:` object URL. The caller is
 * responsible for revoking the URL with `URL.revokeObjectURL` when done.
 */
export async function dxFetchAsset(fileId: string): Promise<{ url: string; mime: string } | null> {
  if (!fileId || !DIRECTUS_URL) return null;
  const token = await refreshIfNeeded();
  const res = await fetch(`${DIRECTUS_URL}/assets/${fileId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), mime: blob.type };
}

/** True if the URL points at the Directus assets endpoint (needs auth fetch). */
export function isDirectusAssetUrl(url: string) {
  return !!DIRECTUS_URL && typeof url === "string" && url.startsWith(`${DIRECTUS_URL}/assets/`);
}

// ---------- Requests ----------
type DxRequest = {
  id: string;
  status: string;
  agent_id: string;
  agent_name?: string;
  branch?: string;
  date_created: string;
  registration: string;
  license: string;
  emirates: string;
  passport?: string | null;
  vehicle_photos?: string[] | null;
  customer_name?: string | null;
  customer_email?: string | null;
};

const REQUEST_FIELDS =
  "id,status,agent_id,agent_name,branch,date_created,registration,license,emirates,passport,vehicle_photos,customer_name,customer_email";

export async function dxListRequests(opts?: { agentId?: string }): Promise<DxRequest[]> {
  const params = new URLSearchParams({
    "fields": REQUEST_FIELDS,
    "sort": "-date_created",
    "limit": "200",
  });
  if (opts?.agentId) params.set("filter[agent_id][_eq]", opts.agentId);
  const json = await dxFetch(`/items/requests?${params.toString()}`);
  return json.data as DxRequest[];
}

export async function dxGetRequest(id: string): Promise<DxRequest | null> {
  try {
    const json = await dxFetch(
      `/items/requests/${encodeURIComponent(id)}?fields=${REQUEST_FIELDS}`,
    );
    return json.data as DxRequest;
  } catch {
    return null;
  }
}

export async function dxCreateRequest(input: {
  agent_id: string;
  agent_name?: string;
  branch?: string;
  registration: string;
  license: string;
  emirates: string;
  passport?: string | null;
  vehicle_photos?: string[] | null;
  customer_name?: string | null;
  customer_email?: string | null;
}): Promise<DxRequest> {
  const json = await dxFetch("/items/requests", {
    method: "POST",
    body: JSON.stringify({ ...input, status: "new" }),
  }, { auth: false });
  return json.data as DxRequest;
}

export async function dxUpdateRequestStatus(id: string, status: string): Promise<DxRequest> {
  const json = await dxFetch(`/items/requests/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return json.data as DxRequest;
}

// ---------- Users (Agent management — Admin only) ----------

export type DxUser = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  agent_id?: string;
  branch?: string;
  status: "active" | "suspended" | "invited" | "draft" | "archived";
  role?: { id: string; name: string };
};

const USER_FIELDS = "id,email,first_name,last_name,agent_id,branch,status,role.id,role.name";

/** Find a role's UUID by its display name (e.g. "Agent", "Admin"). */
export async function dxFindRoleId(name: string): Promise<string | null> {
  const json = await dxFetch(
    `/roles?filter[name][_eq]=${encodeURIComponent(name)}&fields=id,name&limit=1`,
  );
  return json.data?.[0]?.id ?? null;
}

export async function dxListAgents(): Promise<DxUser[]> {
  // List all users with role "Agent". We resolve role id first to keep the query indexed.
  const roleId = await dxFindRoleId("Agent");
  const params = new URLSearchParams({
    fields: USER_FIELDS,
    sort: "first_name",
    limit: "500",
  });
  if (roleId) params.set("filter[role][_eq]", roleId);
  const json = await dxFetch(`/users?${params.toString()}`);
  return json.data as DxUser[];
}

export async function dxCreateAgent(input: {
  email: string;
  password: string;
  first_name: string;
  last_name?: string;
  agent_id: string;
  branch?: string;
}): Promise<DxUser> {
  const roleId = await dxFindRoleId("Agent");
  if (!roleId) throw new Error('Role "Agent" not found in Directus. Create it first (see DIRECTUS_SETUP.md).');
  const json = await dxFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      first_name: input.first_name,
      last_name: input.last_name ?? "",
      agent_id: input.agent_id,
      branch: input.branch ?? null,
      role: roleId,
      status: "active",
    }),
  });
  return json.data as DxUser;
}

export async function dxUpdateAgent(id: string, patch: Partial<{
  first_name: string;
  last_name: string;
  agent_id: string;
  branch: string | null;
  status: DxUser["status"];
  password: string;
}>): Promise<DxUser> {
  const json = await dxFetch(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return json.data as DxUser;
}

export async function dxDeleteAgent(id: string): Promise<void> {
  await dxFetch(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type { DxRequest };
