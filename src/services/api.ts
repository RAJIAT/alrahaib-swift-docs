/**
 * API service layer — backed by Lovable Cloud (Supabase).
 *
 * Customer flow (anon): submitUpload — uploads files to `request-docs` bucket,
 * inserts a row in `requests` with KYC + paths.
 *
 * Authenticated flow: agents/admins read their requests via RLS.
 */

import { supabase } from "@/integrations/supabase/client";

export type RequestStatus = "new" | "processing" | "sold" | "rejected" | "reupload";

export type InsuranceRequest = {
  id: string;            // display_id (REQ-1001) or uuid fallback
  uuid: string;          // real DB uuid
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
    passport?: string;
    vehiclePhotos?: string[];
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

const BUCKET = "request-docs";
const CHANGE_EVENT = "aib:requests-changed";

function notifyChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// =====================================================================
// Live updates
// =====================================================================

export function subscribeRequests(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(CHANGE_EVENT, onChange);

  const channel = supabase
    .channel("requests-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, () => cb())
    .subscribe();

  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    supabase.removeChannel(channel);
  };
}

// =====================================================================
// Auth
// =====================================================================

export async function login(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error("Invalid credentials");
  return await loadAuthUser(data.user.id, data.user.email ?? email);
}

export async function signUp(email: string, password: string, fullName: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/login`,
      data: { full_name: fullName },
    },
  });
  if (error || !data.user) throw new Error(error?.message ?? "Sign up failed");
  return await loadAuthUser(data.user.id, data.user.email ?? email, fullName);
}

export async function logout() {
  await supabase.auth.signOut();
}

export function getCurrentUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("aib_auth_user");
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthUser; } catch { return null; }
}

export async function refreshCurrentUser(): Promise<AuthUser | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    localStorage.removeItem("aib_auth_user");
    return null;
  }
  return await loadAuthUser(data.user.id, data.user.email ?? "");
}

async function loadAuthUser(userId: string, email: string, fallbackName?: string): Promise<AuthUser> {
  // Determine role
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = roles?.some((r) => r.role === "admin");
  const role: Role = isAdmin ? "admin" : "agent";

  // Try to find linked agent record
  let agentRecord: { id: string; name: string; branch: string | null } | null = null;
  if (!isAdmin) {
    const { data: ag } = await supabase
      .from("agents")
      .select("id,name,branch")
      .eq("user_id", userId)
      .maybeSingle();
    agentRecord = ag ?? null;
  }

  const user: AuthUser = {
    id: userId,
    email,
    name: agentRecord?.name ?? fallbackName ?? email,
    role,
    agentId: agentRecord?.id,
    branch: agentRecord?.branch ?? undefined,
  };
  localStorage.setItem("aib_auth_user", JSON.stringify(user));
  return user;
}

// =====================================================================
// Requests
// =====================================================================

function signedUrl(path: string | null | undefined): string {
  if (!path) return "";
  // Use public path placeholder; actual signed URL is fetched on demand below.
  return `storage:${path}`;
}

/** Resolve a `storage:path` placeholder into a real signed URL (1 hour). */
export async function resolveAssetUrl(stored: string): Promise<{ url: string; mime: string }> {
  if (!stored) return { url: "", mime: "" };
  if (!stored.startsWith("storage:")) return { url: stored, mime: "" };
  const path = stored.slice("storage:".length);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return { url: "", mime: "" };
  // Best-effort MIME from extension
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime =
    ext === "pdf" ? "application/pdf" :
    ext === "png" ? "image/png" :
    ext === "webp" ? "image/webp" :
    ext === "heic" || ext === "heif" ? `image/${ext}` :
    "image/jpeg";
  return { url: data.signedUrl, mime };
}

type DbRequestRow = {
  id: string;
  display_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  branch: string | null;
  status: RequestStatus;
  created_at: string;
  customer_name: string | null;
  customer_email: string | null;
  registration: string | null;
  license: string | null;
  emirates: string | null;
  passport: string | null;
  vehicle_photos: string[] | null;
};

function mapRow(r: DbRequestRow): InsuranceRequest {
  return {
    id: r.display_id ?? r.id,
    uuid: r.id,
    agentId: r.agent_id ?? "",
    agentName: r.agent_name ?? r.agent_id ?? "—",
    branch: r.branch ?? "—",
    status: r.status,
    createdAt: r.created_at,
    customerName: r.customer_name ?? undefined,
    customerEmail: r.customer_email ?? undefined,
    images: {
      registration: signedUrl(r.registration),
      license: signedUrl(r.license),
      emirates: signedUrl(r.emirates),
      passport: r.passport ? signedUrl(r.passport) : undefined,
      vehiclePhotos: r.vehicle_photos && r.vehicle_photos.length
        ? r.vehicle_photos.map((p) => signedUrl(p))
        : undefined,
    },
  };
}

export async function listRequests(opts?: { agentId?: string }): Promise<InsuranceRequest[]> {
  let query = supabase.from("requests").select("*").order("created_at", { ascending: false }).limit(500);
  if (opts?.agentId) query = query.eq("agent_id", opts.agentId);
  const { data, error } = await query;
  if (error) {
    console.error("[listRequests]", error);
    return [];
  }
  return (data as DbRequestRow[]).map(mapRow);
}

export async function getRequest(id: string): Promise<InsuranceRequest | null> {
  // id may be display_id (REQ-xxxx) or uuid
  const isUuid = /^[0-9a-f]{8}-/i.test(id);
  const col = isUuid ? "id" : "display_id";
  const { data, error } = await supabase
    .from("requests")
    .select("*")
    .eq(col, id)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as DbRequestRow);
}

export async function updateRequestStatus(id: string, status: RequestStatus): Promise<InsuranceRequest> {
  const isUuid = /^[0-9a-f]{8}-/i.test(id);
  const col = isUuid ? "id" : "display_id";
  const { data, error } = await supabase
    .from("requests")
    .update({ status })
    .eq(col, id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Update failed");
  notifyChange();
  return mapRow(data as DbRequestRow);
}

async function uploadOne(file: File, folder: string, kind: string): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const path = `${folder}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}

export async function submitUpload(input: {
  agentId: string;
  customerName?: string;
  customerEmail?: string;
  images: { registration: File; license: File; emirates: File };
  optional?: { passport?: File | null; vehiclePhotos?: File[] };
}): Promise<{ id: string }> {
  const folder = `${input.agentId || "anon"}/${Date.now()}`;

  const [registration, license, emirates] = await Promise.all([
    uploadOne(input.images.registration, folder, "registration"),
    uploadOne(input.images.license, folder, "license"),
    uploadOne(input.images.emirates, folder, "emirates"),
  ]);

  const passport = input.optional?.passport
    ? await uploadOne(input.optional.passport, folder, "passport")
    : null;

  const vehicleFiles = input.optional?.vehiclePhotos ?? [];
  const vehicle_photos = vehicleFiles.length
    ? await Promise.all(vehicleFiles.map((f, i) => uploadOne(f, folder, `vehicle-${i}`)))
    : [];

  // Look up agent for snapshot data
  const { data: agentRow } = await supabase
    .from("agents").select("id,name,branch").eq("id", input.agentId).maybeSingle();

  const { data, error } = await supabase
    .from("requests")
    .insert({
      agent_id: agentRow?.id ?? input.agentId,
      agent_name: agentRow?.name ?? null,
      branch: agentRow?.branch ?? null,
      customer_name: input.customerName ?? null,
      customer_email: input.customerEmail ?? null,
      registration, license, emirates,
      passport,
      vehicle_photos,
      status: "new",
    })
    .select("display_id,id")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Submit failed");
  notifyChange();
  return { id: data.display_id ?? data.id };
}

export function isDemoMode() { return false; }

export function resetDemo() {
  // No-op when running on real backend.
  if (typeof window === "undefined") return;
  localStorage.removeItem("aib_auth_user");
  notifyChange();
}

// =====================================================================
// Agents directory
// =====================================================================

export type Agent = {
  userId?: string;
  id: string;
  name: string;
  email?: string;
  branch?: string;
  active: boolean;
};

const AGENTS_CHANGE_EVENT = "aib:agents-changed";

function notifyAgentsChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENTS_CHANGE_EVENT));
}

export function subscribeAgents(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(AGENTS_CHANGE_EVENT, onChange);
  const channel = supabase
    .channel("agents-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => cb())
    .subscribe();
  return () => {
    window.removeEventListener(AGENTS_CHANGE_EVENT, onChange);
    supabase.removeChannel(channel);
  };
}

// Sync cache for agents (used by admin filters & dropdowns).
let cachedAgents: Agent[] = [];
const BRANCHES = ["Abu Dhabi", "Dubai", "Sharjah"];

export function listAgents(): Agent[] { return cachedAgents; }
export function listBranches(): string[] { return BRANCHES; }

export async function getAgents(): Promise<Agent[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("id,user_id,name,email,branch,active")
    .order("name");
  if (error) {
    console.error("[getAgents]", error);
    return [];
  }
  return (data ?? []).map((a) => ({
    userId: a.user_id ?? undefined,
    id: a.id,
    name: a.name,
    email: a.email ?? undefined,
    branch: a.branch ?? undefined,
    active: a.active,
  }));
}

export async function createAgent(input: {
  id: string; name: string; email?: string; branch?: string;
}): Promise<Agent> {
  const { data, error } = await supabase
    .from("agents")
    .insert({
      id: input.id, name: input.name,
      email: input.email ?? null, branch: input.branch ?? null,
      active: true,
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Create failed");
  notifyAgentsChange();
  return {
    id: data.id, name: data.name, email: data.email ?? undefined,
    branch: data.branch ?? undefined, active: data.active,
  };
}

export async function updateAgent(id: string, patch: Partial<{
  name: string; email: string | null; branch: string | null; active: boolean;
}>): Promise<Agent> {
  const { data, error } = await supabase
    .from("agents")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Update failed");
  notifyAgentsChange();
  return {
    id: data.id, name: data.name, email: data.email ?? undefined,
    branch: data.branch ?? undefined, active: data.active,
  };
}

export async function deleteAgent(id: string): Promise<void> {
  const { error } = await supabase.from("agents").delete().eq("id", id);
  if (error) throw error;
  notifyAgentsChange();
}
