/**
 * Directus REST client.
 *
 * Activated automatically when VITE_DIRECTUS_URL is defined.
 * Designed for an on-premise / Azure-UAE Directus instance so that
 * all data and files remain inside the UAE (no external SaaS).
 *
 * Expected Directus setup (one-time, by ops):
 *
 *   Collection: requests
 *     - id              (uuid, primary, auto)
 *     - status          (string, default "new")  — new|processing|sold|rejected|reupload
 *     - agent_id        (string)
 *     - agent_name      (string, nullable)
 *     - branch          (string, nullable)
 *     - registration    (uuid → directus_files)
 *     - license         (uuid → directus_files)
 *     - emirates        (uuid → directus_files)
 *     - date_created    (timestamp, special: date-created)
 *
 *   Roles:
 *     - Public:  files.create + requests.create  (for /upload page)
 *     - Agent :  requests.read (filter: agent_id == $CURRENT_USER.agent_id)
 *     - Admin :  full read/update on requests
 *
 * Auth:
 *     - Login with email/password → POST /auth/login
 *     - Tokens stored in localStorage; refresh handled lazily.
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
  // Refresh 30s before expiry.
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
    throw new Error(`Directus ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
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
  // Fetch the user with their role + custom fields.
  const me = await dxFetch("/users/me?fields=id,email,first_name,last_name,role.name,agent_id,branch");
  return me.data as {
    id: string; email: string;
    first_name?: string; last_name?: string;
    role?: { name?: string };
    agent_id?: string; branch?: string;
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

export function dxAssetUrl(fileId: string) {
  if (!fileId) return "";
  const t = readToken();
  const qs = t?.access_token ? `?access_token=${encodeURIComponent(t.access_token)}` : "";
  return `${DIRECTUS_URL}/assets/${fileId}${qs}`;
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
};

export async function dxListRequests(opts?: { agentId?: string }): Promise<DxRequest[]> {
  const params = new URLSearchParams({
    "fields": "id,status,agent_id,agent_name,branch,date_created,registration,license,emirates",
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
      `/items/requests/${encodeURIComponent(id)}?fields=id,status,agent_id,agent_name,branch,date_created,registration,license,emirates`,
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
}): Promise<DxRequest> {
  // Public role uses no auth header — the request collection's create permission is granted to Public.
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

export type { DxRequest };
