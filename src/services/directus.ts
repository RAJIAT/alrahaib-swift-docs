/**
 * Directus REST client.
 *
 * Activated automatically when VITE_DIRECTUS_URL is defined.
 * Designed for an on-premise / Azure-UAE Directus instance so that
 * all data and files remain inside the UAE (no external SaaS).
 *
 * See DIRECTUS_SETUP.md for the full schema, roles and permissions.
 */

/**
 * We always go through the same-origin /api/directus proxy.
 *
 * The browser is on HTTPS but Directus is on plain HTTP, so direct calls are
 * blocked by the browser's Mixed Content rule. The /api/directus/* server
 * route forwards every request to the on-premise Directus instance over the
 * server-to-server network where HTTP is fine.
 */
const DEFAULT_DIRECTUS_URL = "/api/directus";

export const DIRECTUS_URL: string | undefined =
  ((import.meta as any).env?.VITE_DIRECTUS_URL || DEFAULT_DIRECTUS_URL)
    ?.replace(/\/$/, "") || undefined;

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
  // Always bypass HTTP cache: dashboards rely on freshly-written rows being
  // visible immediately after a POST/PATCH (notes, status changes, etc.).
  const res = await fetch(`${DIRECTUS_URL}${path}`, { ...init, headers, cache: "no-store" });
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

/** Returns a valid (refreshed) access token for server-to-server endpoints
 *  that need to verify the current Directus user. */
export async function dxAccessToken(): Promise<string | null> {
  return refreshIfNeeded();
}

function safeApiErrorMessage(status: number): string {
  if (status === 400) return "Invalid request. Please check the form and try again.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You are not authorized to perform this action.";
  if (status === 409) return "This record already exists or conflicts with existing data.";
  if (status >= 500) return "The server is temporarily unavailable. Please try again.";
  return "Request failed. Please try again.";
}

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
export type DxRequest = {
  id: string;
  status: string;
  agent_id: string;
  agent_name?: string;
  branch?: string;
  date_created: string;
  request_display_id?: string;
  registration?: string;
  license?: string;
  emirates?: string;
  passport?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  inspection?: string | null;
};

const REQUEST_FIELDS =
  "id,status,agent_id,agent_name,branch,date_created,request_display_id,registration,license,emirates,passport,inspection,customer_name,customer_email,customer_phone";

export async function dxListRequests(opts?: { agentId?: string; branch?: string }): Promise<DxRequest[]> {
  const params = new URLSearchParams({
    "fields": REQUEST_FIELDS,
    "sort": "-date_created",
    "limit": "200",
  });
  if (opts?.agentId) params.set("filter[agent_id][_eq]", opts.agentId);
  if (opts?.branch) params.set("filter[branch][_eq]", opts.branch);
  const json = await dxFetch(`/items/requests?${params.toString()}`);
  return json.data as DxRequest[];
}

export async function dxGetRequest(id: string): Promise<DxRequest | null> {
  try {
    // Try by numeric id first, then by display id.
    const byId = await dxFetch(
      `/items/requests?filter[_or][0][id][_eq]=${encodeURIComponent(id)}&filter[_or][1][request_display_id][_eq]=${encodeURIComponent(id)}&fields=${REQUEST_FIELDS}&limit=1`,
    );
    return (byId.data?.[0] as DxRequest) ?? null;
  } catch {
    return null;
  }
}

export async function dxCreateRequest(input: {
  agent_id: string;
  agent_name?: string;
  branch?: string;
  registration?: string | null;
  license?: string | null;
  emirates?: string | null;
  passport?: string | null;
  inspection?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
}): Promise<DxRequest> {
  // We always set status=new on creation. We do NOT pass auth:false anymore —
  // the customer-facing /api/directus proxy sends a public-policy bearer token
  // upstream when the route is unauthenticated.
  const json = await dxFetch("/items/requests", {
    method: "POST",
    body: JSON.stringify({ ...input, status: "new" }),
  });
  return json.data as DxRequest;
}

export async function dxUpdateRequestStatus(id: string, status: string): Promise<DxRequest> {
  const json = await dxFetch(`/items/requests/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return json.data as DxRequest;
}

// ---------- Branches ----------
export type DxBranch = {
  id: number;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  is_active: boolean;
};

export async function dxListBranches(opts?: { onlyActive?: boolean }): Promise<DxBranch[]> {
  const params = new URLSearchParams({
    fields: "id,name,code,address,phone,is_active",
    sort: "name",
    limit: "200",
  });
  if (opts?.onlyActive) params.set("filter[is_active][_eq]", "true");
  const json = await dxFetch(`/items/branches?${params.toString()}`);
  return json.data as DxBranch[];
}

export async function dxCreateBranch(input: Omit<DxBranch, "id">): Promise<DxBranch> {
  const json = await dxFetch("/items/branches", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return json.data as DxBranch;
}

export async function dxUpdateBranch(id: number, patch: Partial<Omit<DxBranch, "id">>): Promise<DxBranch> {
  const json = await dxFetch(`/items/branches/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return json.data as DxBranch;
}

export async function dxDeleteBranch(id: number): Promise<void> {
  await dxFetch(`/items/branches/${id}`, { method: "DELETE" });
}

// ---------- Request notes ----------
export type DxNote = {
  id: number;
  request: string;
  text: string;
  kind: string;
  author_id?: string;
  author_name?: string;
  author_role?: string;
  date_created: string;
  resolved_at?: string | null;
};

export async function dxListNotes(requestId: string): Promise<DxNote[]> {
  // Try server-side endpoint first (uses admin token, immune to per-role
  // permission gaps on request_notes). Fall back to direct Directus read.
  try {
    const token = await refreshIfNeeded();
    if (token) {
      const res = await fetch(
        `/api/notes?requestId=${encodeURIComponent(requestId)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.ok && Array.isArray(j.notes)) return j.notes as DxNote[];
      }
    }
  } catch (e) {
    console.warn("[notes] server list failed, falling back to direct read", e);
  }
  const params = new URLSearchParams({
    fields: "id,request,text,kind,author_id,author_name,author_role,date_created,resolved_at",
    sort: "date_created",
    limit: "200",
  });
  params.set("filter[request][_eq]", requestId);
  const json = await dxFetch(`/items/request_notes?${params.toString()}`);
  return json.data as DxNote[];
}

export async function dxCreateNote(input: {
  request: string;
  text: string;
  kind: string;
  author_id?: string;
  author_name?: string;
  author_role?: string;
}): Promise<DxNote> {
  const json = await dxFetch("/items/request_notes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return json.data as DxNote;
}

export async function dxResolveNote(noteId: number): Promise<DxNote> {
  const json = await dxFetch(`/items/request_notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify({ resolved_at: new Date().toISOString() }),
  });
  return json.data as DxNote;
}

// ---------- Request attachments ----------
export type DxAttachment = {
  id: number;
  request: string;
  file: string;
  original_name?: string;
  date_created: string;
};

export async function dxListAttachments(requestId: string, missing = false): Promise<DxAttachment[]> {
  const collection = missing ? "request_missing_attachments" : "request_attachments";
  const params = new URLSearchParams({
    fields: "id,request,file,original_name,date_created",
    sort: "date_created",
    limit: "200",
  });
  params.set("filter[request][_eq]", requestId);
  const json = await dxFetch(`/items/${collection}?${params.toString()}`);
  return json.data as DxAttachment[];
}

export async function dxCreateAttachment(input: {
  request: string;
  file: string;
  original_name?: string;
}, missing = false): Promise<DxAttachment> {
  const collection = missing ? "request_missing_attachments" : "request_attachments";
  const json = await dxFetch(`/items/${collection}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return json.data as DxAttachment;
}

// ---------- Vehicle media ----------
export type DxVehicleMedia = {
  id: number;
  request: string;
  file: string;
  kind: string;
  date_created: string;
};

export async function dxListVehicleMedia(requestId: string): Promise<DxVehicleMedia[]> {
  const params = new URLSearchParams({
    fields: "id,request,file,kind,date_created",
    sort: "date_created",
    limit: "200",
  });
  params.set("filter[request][_eq]", requestId);
  const json = await dxFetch(`/items/request_vehicle_media?${params.toString()}`);
  return json.data as DxVehicleMedia[];
}

export async function dxCreateVehicleMedia(input: {
  request: string;
  file: string;
  kind: "image" | "video";
}): Promise<DxVehicleMedia> {
  const json = await dxFetch("/items/request_vehicle_media", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return json.data as DxVehicleMedia;
}

// ---------- Users (Agent management — Admin only) ----------

export type DxUser = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  agent_id?: string;
  branch?: string;
  supervisor_id?: string | null;
  status: "active" | "suspended" | "invited" | "draft" | "archived";
  role?: { id: string; name: string };
};

const USER_FIELDS =
  "id,email,first_name,last_name,agent_id,branch,supervisor_id,status,role.id,role.name";

/** Find a role's UUID by its display name (e.g. "Agent", "Supervisor").
 *  Goes through the server-side helper so non-admin users (Supervisor) can
 *  resolve role ids without needing read permission on /roles.
 *
 *  Role IDs are stable per Directus instance, so we cache resolved values
 *  (and in-flight promises) to avoid hammering /api/role-id every time
 *  dxListAgents() is called. */
const _roleIdCache = new Map<string, string | null>();
const _roleIdInflight = new Map<string, Promise<string | null>>();

export async function dxFindRoleId(name: string): Promise<string | null> {
  if (_roleIdCache.has(name)) return _roleIdCache.get(name) ?? null;
  const existing = _roleIdInflight.get(name);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const r = await fetch(`/api/role-id?name=${encodeURIComponent(name)}`);
      if (!r.ok) return null;
      const j = (await r.json()) as { id?: string | null };
      const id = j.id ?? null;
      // Only cache successful resolutions so transient failures can retry.
      if (id) _roleIdCache.set(name, id);
      return id;
    } catch {
      return null;
    } finally {
      _roleIdInflight.delete(name);
    }
  })();
  _roleIdInflight.set(name, promise);
  return promise;
}

/** List all users with role "Agent" OR "Supervisor". */
export async function dxListAgents(): Promise<DxUser[]> {
  const [agentRoleId, supervisorRoleId] = await Promise.all([
    dxFindRoleId("Agent"),
    dxFindRoleId("Supervisor"),
  ]);
  const roleIds = [agentRoleId, supervisorRoleId].filter(Boolean) as string[];

  const params = new URLSearchParams({
    fields: USER_FIELDS,
    sort: "first_name",
    limit: "500",
  });
  // If we resolved at least one role id, restrict the query to those.
  // Otherwise fall back to listing every user (role names not yet present in Directus).
  if (roleIds.length > 0) {
    roleIds.forEach((id, idx) => {
      params.append(`filter[_or][${idx}][role][_eq]`, id);
    });
  }

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
  role?: "agent" | "supervisor";
  supervisor_id?: string | null;
}): Promise<DxUser> {
  const token = await dxAccessToken();
  if (!token) throw new Error("Your session has expired. Please sign in again.");

  const res = await fetch("/api/agent-users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      first_name: input.first_name,
      last_name: input.last_name ?? "",
      agent_id: input.agent_id,
      branch: input.branch ?? null,
      supervisor_id: input.supervisor_id ?? null,
      role: input.role ?? "agent",
      status: "active",
    }),
  });
  const json = await res
    .json()
    .catch(() => ({} as { ok?: boolean; error?: string; data?: DxUser }));
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || safeApiErrorMessage(res.status));
  }
  return json.data as DxUser;
}

export async function dxUpdateAgent(id: string, patch: Partial<{
  email: string;
  first_name: string;
  last_name: string;
  agent_id: string;
  branch: string | null;
  supervisor_id: string | null;
  role: "agent" | "supervisor";
  status: DxUser["status"];
  password: string;
}>): Promise<DxUser> {
  const body: Record<string, unknown> = {};
  if (patch.email !== undefined) body.email = patch.email;
  if (patch.first_name !== undefined) body.first_name = patch.first_name;
  if (patch.last_name !== undefined) body.last_name = patch.last_name;
  if (patch.agent_id !== undefined) body.agent_id = patch.agent_id;
  if (patch.branch !== undefined) body.branch = patch.branch;
  if (patch.supervisor_id !== undefined) body.supervisor_id = patch.supervisor_id;
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.password) body.password = patch.password;
  if (patch.role !== undefined) {
    const roleName = patch.role === "supervisor" ? "Supervisor" : "Agent";
    const roleId = await dxFindRoleId(roleName);
    if (!roleId) throw new Error(`Role "${roleName}" not found in Directus`);
    body.role = roleId;
  }
  const json = await dxFetch(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return json.data as DxUser;
}

export async function dxDeleteAgent(id: string): Promise<void> {
  await dxFetch(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

