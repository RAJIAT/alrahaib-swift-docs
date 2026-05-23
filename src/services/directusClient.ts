/**
 * Directus client — يتفعّل لما VITE_USE_DIRECTUS=true و VITE_DIRECTUS_URL مضبوط.
 *
 * الحالي: stub معطّل. الـ services/api.ts ما زال يستخدم demoStore.
 * لما نشغّل الـ bootstrap على Directus، نحوّل api.ts ليستهلك هاد الـ client.
 *
 * يدعم: login (access+refresh tokens) → localStorage، auto-refresh،
 * generic request() متوافق مع Directus REST API.
 */

const URL_BASE = (import.meta.env.VITE_DIRECTUS_URL as string | undefined)?.replace(/\/$/, "");
export const DIRECTUS_ENABLED =
  String(import.meta.env.VITE_USE_DIRECTUS).toLowerCase() === "true" && !!URL_BASE;

const STORAGE_KEY = "aib:directus:tokens:v1";

type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch
};

function loadTokens(): TokenSet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch {
    return null;
  }
}

function saveTokens(t: TokenSet | null) {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  else localStorage.removeItem(STORAGE_KEY);
}

let memTokens: TokenSet | null = null;
function getTokens(): TokenSet | null {
  if (memTokens) return memTokens;
  memTokens = loadTokens();
  return memTokens;
}
function setTokens(t: TokenSet | null) {
  memTokens = t;
  saveTokens(t);
}

async function refresh(): Promise<TokenSet | null> {
  const t = getTokens();
  if (!t || !URL_BASE) return null;
  const res = await fetch(`${URL_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: t.refresh_token, mode: "json" }),
  });
  if (!res.ok) {
    setTokens(null);
    return null;
  }
  const j = (await res.json()) as { data: { access_token: string; refresh_token: string; expires: number } };
  const next: TokenSet = {
    access_token: j.data.access_token,
    refresh_token: j.data.refresh_token,
    expires_at: Date.now() + j.data.expires - 30_000,
  };
  setTokens(next);
  return next;
}

async function ensureFreshToken(): Promise<string | null> {
  let t = getTokens();
  if (!t) return null;
  if (Date.now() >= t.expires_at) {
    t = await refresh();
  }
  return t?.access_token ?? null;
}

export type DirectusError = { message: string; status: number };

export async function dxRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!URL_BASE) throw new Error("Directus not configured (VITE_DIRECTUS_URL missing).");
  const token = await ensureFreshToken();
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err: DirectusError = { message: body || res.statusText, status: res.status };
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function dxLogin(email: string, password: string) {
  if (!URL_BASE) throw new Error("Directus not configured.");
  const res = await fetch(`${URL_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, mode: "json" }),
  });
  if (!res.ok) throw new Error("Invalid credentials");
  const j = (await res.json()) as { data: { access_token: string; refresh_token: string; expires: number } };
  setTokens({
    access_token: j.data.access_token,
    refresh_token: j.data.refresh_token,
    expires_at: Date.now() + j.data.expires - 30_000,
  });
  return await dxRequest<{ data: unknown }>(
    "/users/me?fields=id,email,first_name,last_name,app_role,staff_type,branch.*,agent_code,supervisor,assigned_underwriter,app_active,pending_approval",
  );
}

export async function dxLogout() {
  const t = getTokens();
  setTokens(null);
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

export function dxAssetUrl(fileId: string | null | undefined): string {
  if (!fileId || !URL_BASE) return "";
  return `${URL_BASE}/assets/${fileId}`;
}

/**
 * Reassign a request via the server-side flow webhook.
 * The flow validates that the caller is allowed to set this target
 * (sales → only their assigned underwriter; UW → same-branch UW or origin sales;
 * admin/supervisor → unrestricted within their scope).
 *
 * The webhook flow id is published by Directus as part of the flow record;
 * it must be configured here (or fetched once at app boot via /flows).
 */
export async function dxReassignRequest(
  requestId: string,
  newAgentId: string,
  webhookFlowId: string,
): Promise<void> {
  if (!URL_BASE) throw new Error("Directus not configured.");
  const token = await ensureFreshToken();
  const res = await fetch(`${URL_BASE}/flows/trigger/${webhookFlowId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ request_id: requestId, new_agent_id: newAgentId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reassign failed [${res.status}]: ${body}`);
  }
}

/**
 * Look up the reassign webhook flow id once at boot.
 * Cache the returned id and pass it to dxReassignRequest.
 */
export async function dxFindReassignFlowId(): Promise<string | null> {
  const r = await dxRequest<{ data: Array<{ id: string; name: string }> }>(
    "/flows?filter[name][_eq]=lovable: reassign_request&limit=1",
  );
  return r.data[0]?.id ?? null;
}
