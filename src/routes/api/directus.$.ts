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

// Directus target. Override via DIRECTUS_TARGET env var if the domain changes.
const DIRECTUS_TARGET = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";

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

const maintenanceState: MaintenanceState = ((globalThis as any).__aibDirectusMaintenance_v3 ??= {
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

/**
 * Create or update a permission row for (policy, collection, action) so that
 * the listed fields and row filter are exactly what we want. Used to repair
 * over-restrictive permissions that block the Agent/Supervisor dashboards.
 */
async function upsertPermission(
  policyId: string,
  collection: string,
  action: string,
  fields: string[],
  permissions: Record<string, any> = {},
) {
  const existing = await adminDx<any[]>(
    `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${collection}&filter[action][_eq]=${action}&limit=1`,
  );
  const body = {
    policy: policyId,
    collection,
    action,
    fields,
    permissions,
    validation: {},
    presets: null,
  };
  if (existing.data?.length) {
    const id = existing.data[0].id;
    await adminDx(`/permissions/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  } else {
    await adminDx("/permissions", { method: "POST", body: JSON.stringify(body) });
  }
}

const REQUEST_READ_FIELDS = [
  "id",
  "status",
  "agent_id",
  "agent_name",
  "branch",
  "date_created",
  "request_display_id",
  "registration",
  "license",
  "emirates",
  "passport",
  "inspection",
  "customer_name",
  "customer_email",
  "customer_phone",
];

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

  // Fields the dashboards need to read on directus_users so that filters like
  // `$CURRENT_USER.agent_id` and `$CURRENT_USER.branch` resolve correctly.
  // Without explicit read access on these custom fields, Directus treats them
  // as null when evaluating row filters → the requests query returns 0 rows.
  const USER_SELF_FIELDS = [
    "id",
    "email",
    "first_name",
    "last_name",
    "role",
    "agent_id",
    "branch",
    "supervisor_id",
    "status",
  ];

  if (agentPolicy) {
    if (collectionNames.has("audit_log")) {
      await ensurePermission(agentPolicy.id, "audit_log", "create");
      await ensurePermission(agentPolicy.id, "audit_log", "read");
    }
    if (collectionNames.has("request_missing_attachments")) {
      await ensurePermission(agentPolicy.id, "request_missing_attachments", "read");
      await ensurePermission(agentPolicy.id, "request_missing_attachments", "create");
      await ensurePermission(agentPolicy.id, "request_missing_attachments", "update");
    }
    if (collectionNames.has("request_notes")) {
      await ensurePermission(agentPolicy.id, "request_notes", "read");
      await ensurePermission(agentPolicy.id, "request_notes", "create");
      await ensurePermission(agentPolicy.id, "request_notes", "update");
    }
    if (collectionNames.has("request_attachments")) {
      await ensurePermission(agentPolicy.id, "request_attachments", "read");
    }
    if (collectionNames.has("request_vehicle_media")) {
      await ensurePermission(agentPolicy.id, "request_vehicle_media", "read");
    }
    if (collectionNames.has("requests")) {
      // Agent can read only their own requests, but with full business fields.
      await upsertPermission(
        agentPolicy.id,
        "requests",
        "read",
        REQUEST_READ_FIELDS,
        { agent_id: { _eq: "$CURRENT_USER.agent_id" } },
      );
    }
    // Agent reads their OWN user row (needed so $CURRENT_USER.agent_id resolves).
    await upsertPermission(
      agentPolicy.id,
      "directus_users",
      "read",
      USER_SELF_FIELDS,
      { id: { _eq: "$CURRENT_USER" } },
    );
  }

  const supervisorRole = (roles.data ?? []).find((role: any) => role.name === "Supervisor");
  const supervisorPolicy = supervisorRole ? policyForRole(policies.data ?? [], supervisorRole.id) : null;
  if (supervisorPolicy) {
    if (collectionNames.has("audit_log")) {
      await ensurePermission(supervisorPolicy.id, "audit_log", "create");
      await ensurePermission(supervisorPolicy.id, "audit_log", "read");
    }
    if (collectionNames.has("request_missing_attachments")) {
      await ensurePermission(supervisorPolicy.id, "request_missing_attachments", "read");
      await ensurePermission(supervisorPolicy.id, "request_missing_attachments", "create");
      await ensurePermission(supervisorPolicy.id, "request_missing_attachments", "update");
    }
    if (collectionNames.has("request_notes")) {
      await ensurePermission(supervisorPolicy.id, "request_notes", "read");
      await ensurePermission(supervisorPolicy.id, "request_notes", "create");
      await ensurePermission(supervisorPolicy.id, "request_notes", "update");
    }
    if (collectionNames.has("request_attachments")) {
      await ensurePermission(supervisorPolicy.id, "request_attachments", "read");
    }
    if (collectionNames.has("request_vehicle_media")) {
      await ensurePermission(supervisorPolicy.id, "request_vehicle_media", "read");
    }
    if (collectionNames.has("requests")) {
      // Supervisor sees all requests in their branch (or everything if branch is empty).
      await upsertPermission(
        supervisorPolicy.id,
        "requests",
        "read",
        REQUEST_READ_FIELDS,
        {
          _or: [
            { branch: { _eq: "$CURRENT_USER.branch" } },
            { _and: [
              { branch: { _empty: true } },
              { agent_id: { _empty: false } },
            ] },
          ],
        },
      );
    }
    // Supervisor reads themselves + agents in their branch / under their supervision.
    await upsertPermission(
      supervisorPolicy.id,
      "directus_users",
      "read",
      USER_SELF_FIELDS,
      {
        _or: [
          { id: { _eq: "$CURRENT_USER" } },
          { branch: { _eq: "$CURRENT_USER.branch" } },
          { supervisor_id: { _eq: "$CURRENT_USER" } },
        ],
      },
    );
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

// Public endpoints reachable without a logged-in session — the proxy injects
// the admin token so customers using a shared agent link can submit a request
// even though they have no Directus account.
const PUBLIC_FALLBACK_PREFIXES = [
  "files",                        // file uploads from the customer form
  "items/requests",               // creating the request row
  "items/request_attachments",    // optional attachments
  "items/request_vehicle_media",  // vehicle photos / videos
  "items/request_missing_attachments",
];

function shouldUseAdminFallback(splat: string, method: string): boolean {
  // Only allow anonymous POSTs (creating a new row / uploading a file).
  // PATCH / PUT / DELETE on an existing row must require a real session.
  if (method !== "POST") return false;
  return PUBLIC_FALLBACK_PREFIXES.some((p) => splat === p || splat.startsWith(`${p}/`));
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

  // If the customer is unauthenticated (no Authorization header) and is hitting
  // an upload / create endpoint, inject the admin token so the request goes
  // through with full backend privileges. This is the only way a public client
  // link can persist data without exposing service credentials in the browser.
  const hasAuth = headers.has("authorization") || headers.has("Authorization");
  const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!hasAuth && adminToken && shouldUseAdminFallback(splat, request.method)) {
    headers.set("Authorization", `Bearer ${adminToken}`);
  }

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
