/**
 * Server-side proxy to the on-premise Directus instance.
 *
 * Why: the browser runs on HTTPS but Directus is on plain HTTP, which causes
 * a Mixed Content block. By proxying through this server route every request
 * goes HTTPS (browser -> our server) and then plain HTTP server-to-server to
 * Directus. No browser security warning, no SSL needed on Directus yet.
 *
 * All HTTP methods are forwarded transparently. Headers, query string and
 * body are passed through. The response is streamed back as-is.
 */

import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS_TARGET = "http://74.162.122.193:8055";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

type DirectusJson<T = any> = { data?: T } & Record<string, any>;
type MaintenanceState = { done: boolean; promise: Promise<void> | null; lastFailure: number };

const maintenanceState: MaintenanceState = ((globalThis as any).__aibDirectusMaintenance ??= {
  done: false,
  promise: null,
  lastFailure: 0,
});

async function adminDx<T = any>(path: string, init: RequestInit = {}): Promise<DirectusJson<T>> {
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!token) throw new Error("DIRECTUS_ADMIN_TOKEN not configured");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${DIRECTUS_TARGET}${path}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

function policyForRole(policies: any[], roleId: string | null) {
  if (roleId === null) {
    return policies.find((policy) => policy.name?.toLowerCase().includes("public")) ?? null;
  }
  return (
    policies.find(
      (policy) =>
        Array.isArray(policy.roles) &&
        policy.roles.some((role: any) => (typeof role === "string" ? role === roleId : role?.role === roleId)),
    ) ?? null
  );
}

async function ensurePermission(policyId: string, collection: string, action: string, fields: string | string[] = "*") {
  const existing = await adminDx<any[]>(
    `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${collection}&filter[action][_eq]=${action}&limit=1`,
  );
  if (existing.data?.length) return;

  await adminDx("/permissions", {
    method: "POST",
    body: JSON.stringify({
      policy: policyId,
      collection,
      action,
      fields,
      permissions: {},
      validation: {},
      presets: null,
    }),
  });
}

async function ensureUsersField(field: string, definition: Record<string, any>) {
  try {
    await adminDx(`/fields/directus_users/${field}`);
    return; // already exists
  } catch {
    // not found → create
  }
  try {
    await adminDx("/fields/directus_users", {
      method: "POST",
      body: JSON.stringify(definition),
    });
  } catch (error) {
    console.error(`[directus-maintenance] failed to add field ${field}`, error);
  }
}

async function ensureRole(name: string): Promise<string | null> {
  try {
    const existing = await adminDx<any[]>(
      `/roles?filter[name][_eq]=${encodeURIComponent(name)}&fields=id&limit=1`,
    );
    if (existing.data?.[0]?.id) return existing.data[0].id;
    const created = await adminDx<any>("/roles", {
      method: "POST",
      body: JSON.stringify({ name, icon: "supervised_user_circle", description: `${name} role (auto-created)` }),
    });
    return created.data?.id ?? null;
  } catch (error) {
    console.error(`[directus-maintenance] failed to ensure role ${name}`, error);
    return null;
  }
}

async function runDirectusMaintenance() {
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!token) return;

  // 1) Ensure custom fields on directus_users (agent_id, supervisor_id, branch).
  await ensureUsersField("agent_id", {
    field: "agent_id",
    type: "string",
    meta: { interface: "input", note: "Public agent identifier (e.g. A123)", width: "half" },
    schema: { is_nullable: true, is_unique: false },
  });
  await ensureUsersField("supervisor_id", {
    field: "supervisor_id",
    type: "uuid",
    meta: {
      interface: "select-dropdown-m2o",
      note: "Supervising user (for agents)",
      width: "half",
      special: ["m2o"],
      options: { template: "{{first_name}} {{last_name}}" },
    },
    schema: { is_nullable: true, foreign_key_table: "directus_users", foreign_key_column: "id" },
  });
  await ensureUsersField("branch", {
    field: "branch",
    type: "string",
    meta: { interface: "input", note: "Branch name", width: "half" },
    schema: { is_nullable: true },
  });

  // 2) Ensure Agent + Supervisor roles exist.
  await ensureRole("Agent");
  await ensureRole("Supervisor");

  const [collections, roles, policies] = await Promise.all([
    adminDx<any[]>("/collections?limit=-1"),
    adminDx<any[]>("/roles?fields=id,name"),
    adminDx<any[]>("/policies?fields=id,name,roles"),
  ]);

  const collectionNames = new Set((collections.data ?? []).map((collection: any) => collection.collection));
  const agentRole = (roles.data ?? []).find((role: any) => role.name === "Agent");
  const agentPolicy = agentRole ? policyForRole(policies.data ?? [], agentRole.id) : null;

  if (agentPolicy) {
    if (collectionNames.has("audit_log")) await ensurePermission(agentPolicy.id, "audit_log", "create");
    if (collectionNames.has("request_missing_attachments")) {
      await ensurePermission(agentPolicy.id, "request_missing_attachments", "read");
      await ensurePermission(agentPolicy.id, "request_missing_attachments", "create");
    }
  }

  const supervisorRole = (roles.data ?? []).find((role: any) => role.name === "Supervisor");
  const supervisorPolicy = supervisorRole ? policyForRole(policies.data ?? [], supervisorRole.id) : null;
  if (supervisorPolicy) {
    if (collectionNames.has("audit_log")) await ensurePermission(supervisorPolicy.id, "audit_log", "create");
    if (collectionNames.has("request_missing_attachments")) {
      await ensurePermission(supervisorPolicy.id, "request_missing_attachments", "read");
      await ensurePermission(supervisorPolicy.id, "request_missing_attachments", "create");
    }
  }

  const publicPolicy = policyForRole(policies.data ?? [], null);
  if (publicPolicy && collectionNames.has("requests")) {
    const publicReads = await adminDx<any[]>(
      `/permissions?filter[policy][_eq]=${publicPolicy.id}&filter[collection][_eq]=requests&filter[action][_eq]=read`,
    );
    for (const permission of publicReads.data ?? []) {
      await adminDx(`/permissions/${permission.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fields: ["id", "status", "reference_number", "created_at", "updated_at"],
          permissions: {},
        }),
      });
    }
  }

  for (const legacyCollection of ["agents", "requests_files"]) {
    if (collectionNames.has(legacyCollection)) {
      await adminDx(`/collections/${legacyCollection}`, { method: "DELETE" });
    }
  }
}

async function ensureDirectusMaintenance() {
  if (maintenanceState.done) return;
  if (maintenanceState.promise) return maintenanceState.promise;
  if (Date.now() - maintenanceState.lastFailure < 60_000) return;

  maintenanceState.promise = runDirectusMaintenance()
    .then(() => {
      maintenanceState.done = true;
    })
    .catch((error) => {
      maintenanceState.lastFailure = Date.now();
      console.error("[directus-maintenance]", error);
    })
    .finally(() => {
      maintenanceState.promise = null;
    });

  return maintenanceState.promise;
}

async function proxy(request: Request, splat: string) {
  await ensureDirectusMaintenance();

  const url = new URL(request.url);
  const targetUrl = `${DIRECTUS_TARGET}/${splat}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(targetUrl, init);

  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      respHeaders.set(key, value);
    }
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const Route = createFileRoute("/api/directus/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => proxy(request, params._splat ?? ""),
      POST: async ({ request, params }) => proxy(request, params._splat ?? ""),
      PUT: async ({ request, params }) => proxy(request, params._splat ?? ""),
      PATCH: async ({ request, params }) => proxy(request, params._splat ?? ""),
      DELETE: async ({ request, params }) => proxy(request, params._splat ?? ""),
      OPTIONS: async ({ request, params }) => proxy(request, params._splat ?? ""),
    },
  },
});
