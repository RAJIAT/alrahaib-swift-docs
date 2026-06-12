/**
 * Directus Bootstrap — idempotent.
 *
 * ينشئ كل البنية: collections, fields, relations, roles, policies, permissions, flows.
 * تشغيل:
 *   DIRECTUS_URL=https://… DIRECTUS_ADMIN_TOKEN=… bun run scripts/directus-bootstrap.ts
 *
 * كل خطوة بتتأكد قبل الإنشاء (idempotent). تقدر تشغّله أكثر من مرة.
 */

import permissionsConfig from "./directus-permissions.json" with { type: "json" };

const URL_BASE = process.env.DIRECTUS_URL?.replace(/\/$/, "");
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

if (!URL_BASE || !TOKEN) {
  console.error("❌ Missing DIRECTUS_URL or DIRECTUS_ADMIN_TOKEN env vars.");
  process.exit(1);
}

// ----------------- HTTP helper -----------------

async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[${res.status}] ${init.method ?? "GET"} ${path}\n${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function exists(path: string): Promise<boolean> {
  const res = await fetch(`${URL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.ok;
}

// ----------------- 1. Collections -----------------

type FieldDef = {
  field: string;
  type: string;
  meta?: Record<string, unknown>;
  schema?: Record<string, unknown>;
};

type CollectionDef = {
  collection: string;
  meta?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  fields: FieldDef[];
  singleton?: boolean;
};

const collections: CollectionDef[] = [
  {
    collection: "branches",
    meta: { icon: "store", note: "Branches / فروع" },
    fields: [
      { field: "id", type: "integer", meta: { hidden: true, interface: "input", readonly: true }, schema: { is_primary_key: true, has_auto_increment: true } },
      { field: "name", type: "string", meta: { interface: "input", required: true }, schema: { is_unique: true } },
      { field: "code", type: "string", meta: { interface: "input", required: true }, schema: { is_unique: true } },
      { field: "address", type: "text", meta: { interface: "input-multiline" } },
      { field: "phone", type: "string", meta: { interface: "input" } },
      { field: "is_active", type: "boolean", meta: { interface: "boolean" }, schema: { default_value: true } },
    ],
  },
  {
    collection: "requests",
    meta: { icon: "description", note: "Insurance requests" },
    fields: [
      { field: "id", type: "string", meta: { hidden: false, readonly: true, interface: "input", required: true }, schema: { is_primary_key: true } },
      { field: "uuid", type: "uuid", meta: { interface: "input", readonly: true, special: ["uuid"] } },
      { field: "agent", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"], options: { template: "{{first_name}} {{last_name}} ({{agent_code}})" } } },
      { field: "origin_agent", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"] } },
      { field: "branch", type: "integer", meta: { interface: "select-dropdown-m2o", special: ["m2o"], required: true } },
      {
        field: "status",
        type: "string",
        meta: {
          interface: "select-dropdown",
          options: {
            choices: [
              { text: "New", value: "new" },
              { text: "Link sent", value: "linkSent" },
              { text: "Processing", value: "processing" },
              { text: "Sold", value: "sold" },
              { text: "Rejected", value: "rejected" },
              { text: "Reupload", value: "reupload" },
            ],
          },
        },
        schema: { default_value: "new" },
      },
      { field: "customer_name", type: "string", meta: { interface: "input" } },
      { field: "customer_email", type: "string", meta: { interface: "input" } },
      { field: "customer_phone", type: "string", meta: { interface: "input" } },
      { field: "assigned_at", type: "timestamp", meta: { interface: "datetime" } },
      { field: "date_created", type: "timestamp", meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true } },
      { field: "date_updated", type: "timestamp", meta: { special: ["date-updated"], interface: "datetime", readonly: true, hidden: true } },
    ],
  },
  {
    collection: "request_notes",
    meta: { icon: "comment" },
    fields: [
      { field: "id", type: "uuid", meta: { hidden: true, readonly: true, special: ["uuid"] }, schema: { is_primary_key: true } },
      { field: "request", type: "string", meta: { interface: "select-dropdown-m2o", special: ["m2o"], required: true } },
      { field: "author", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"] } },
      { field: "author_role", type: "string", meta: { interface: "select-dropdown", options: { choices: [ { text: "Admin", value: "admin" }, { text: "Supervisor", value: "supervisor" }, { text: "Agent", value: "agent" } ] } } },
      { field: "text", type: "text", meta: { interface: "input-multiline", required: true } },
      { field: "kind", type: "string", meta: { interface: "select-dropdown", options: { choices: [ { text: "Comment", value: "comment" }, { text: "Missing", value: "missing" } ] } }, schema: { default_value: "comment" } },
      { field: "resolved_at", type: "timestamp", meta: { interface: "datetime" } },
      { field: "date_created", type: "timestamp", meta: { special: ["date-created"], readonly: true, hidden: true } },
    ],
  },
  {
    collection: "request_files",
    meta: { icon: "attachment" },
    fields: [
      { field: "id", type: "uuid", meta: { hidden: true, readonly: true, special: ["uuid"] }, schema: { is_primary_key: true } },
      { field: "request", type: "string", meta: { interface: "select-dropdown-m2o", special: ["m2o"], required: true } },
      { field: "file", type: "uuid", meta: { interface: "file", special: ["file"], required: true } },
      {
        field: "kind",
        type: "string",
        meta: {
          interface: "select-dropdown",
          required: true,
          options: {
            choices: [
              { text: "Registration", value: "registration" },
              { text: "License", value: "license" },
              { text: "Emirates ID", value: "emirates" },
              { text: "Vehicle Image", value: "vehicle_image" },
              { text: "Vehicle Video", value: "vehicle_video" },
              { text: "Inspection", value: "inspection" },
              { text: "Attachment", value: "attachment" },
              { text: "Missing Attachment", value: "missing_attachment" },
              { text: "Quote", value: "quote" },
            ],
          },
        },
      },
      { field: "uploaded_by", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"] } },
      { field: "uploaded_at", type: "timestamp", meta: { interface: "datetime", special: ["date-created"] } },
    ],
  },
  {
    collection: "notifications",
    meta: { icon: "notifications" },
    fields: [
      { field: "id", type: "uuid", meta: { hidden: true, readonly: true, special: ["uuid"] }, schema: { is_primary_key: true } },
      { field: "recipient", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"], required: true } },
      {
        field: "kind",
        type: "string",
        meta: {
          interface: "select-dropdown",
          options: {
            choices: [
              { text: "Removal Requested", value: "removal_requested" },
              { text: "Removal Approved", value: "removal_approved" },
              { text: "Removal Dismissed", value: "removal_dismissed" },
              { text: "User Pending", value: "user_pending" },
              { text: "User Approved", value: "user_approved" },
              { text: "Request New", value: "request_new" },
              { text: "Request Status", value: "request_status" },
              { text: "Info", value: "info" },
            ],
          },
        },
      },
      { field: "title", type: "string", meta: { interface: "input", required: true } },
      { field: "body", type: "text", meta: { interface: "input-multiline" } },
      { field: "link", type: "string", meta: { interface: "input" } },
      { field: "read", type: "boolean", meta: { interface: "boolean" }, schema: { default_value: false } },
      { field: "date_created", type: "timestamp", meta: { special: ["date-created"], readonly: true, hidden: true } },
    ],
  },
  {
    collection: "audit_log",
    meta: { icon: "history" },
    fields: [
      { field: "id", type: "uuid", meta: { hidden: true, readonly: true, special: ["uuid"] }, schema: { is_primary_key: true } },
      { field: "ts", type: "timestamp", meta: { interface: "datetime", special: ["date-created"] } },
      { field: "actor", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"] } },
      { field: "actor_role", type: "string", meta: { interface: "input" } },
      { field: "actor_branch", type: "string", meta: { interface: "input" } },
      { field: "action", type: "string", meta: { interface: "input", required: true } },
      { field: "entity_type", type: "string", meta: { interface: "select-dropdown", options: { choices: [ { text: "Request", value: "request" }, { text: "Agent", value: "agent" }, { text: "Auth", value: "auth" }, { text: "Branch", value: "branch" } ] } } },
      { field: "entity_id", type: "string", meta: { interface: "input" } },
      { field: "entity_label", type: "string", meta: { interface: "input" } },
      { field: "branch", type: "string", meta: { interface: "input" } },
      { field: "before", type: "json", meta: { interface: "input-code", options: { language: "JSON" } } },
      { field: "after", type: "json", meta: { interface: "input-code", options: { language: "JSON" } } },
      { field: "meta", type: "json", meta: { interface: "input-code", options: { language: "JSON" } } },
    ],
  },
  {
    collection: "app_settings",
    singleton: true,
    meta: { icon: "settings", singleton: true },
    fields: [
      { field: "id", type: "integer", meta: { hidden: true, readonly: true, interface: "input" }, schema: { is_primary_key: true, has_auto_increment: true } },
      { field: "require_admin_approval", type: "boolean", meta: { interface: "boolean", note: "If true, new agents require admin approval." }, schema: { default_value: false } },
    ],
  },
];

// Extra fields to add to directus_users
const userFields: FieldDef[] = [
  { field: "app_role", type: "string", meta: { interface: "select-dropdown", options: { choices: [ { text: "Admin", value: "admin" }, { text: "Supervisor", value: "supervisor" }, { text: "Agent", value: "agent" } ] }, required: true } },
  { field: "staff_type", type: "string", meta: { interface: "select-dropdown", options: { choices: [ { text: "Underwriter", value: "underwriter" }, { text: "Sales", value: "sales" } ] } } },
  { field: "branch", type: "integer", meta: { interface: "select-dropdown-m2o", special: ["m2o"] } },
  { field: "agent_code", type: "string", meta: { interface: "input" }, schema: { is_unique: true } },
  { field: "supervisor", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"] } },
  { field: "assigned_underwriter", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"], note: "For sales staff only — the underwriter their requests are routed to." } },
  { field: "pending_approval", type: "boolean", meta: { interface: "boolean" }, schema: { default_value: false } },
  { field: "app_active", type: "boolean", meta: { interface: "boolean" }, schema: { default_value: true } },
  // Added in Phase 3b — sales→underwriter assignment by agent code (matches app domain).
  { field: "assigned_underwriter_code", type: "string", meta: { interface: "input", note: "Sales: agent_code of the underwriter their requests route to." } },
  // Created-by lineage so supervisors can manage users they created and admins see provenance.
  { field: "app_created_by_role", type: "string", meta: { interface: "select-dropdown", options: { choices: [ { text: "Admin", value: "admin" }, { text: "Supervisor", value: "supervisor" } ] } } },
  // Removal-request workflow (supervisor → admin).
  { field: "app_removal_reason", type: "string", meta: { interface: "input" } },
  { field: "app_removal_requested_by", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"] } },
  { field: "app_removal_requested_at", type: "timestamp", meta: { interface: "datetime" } },
];

// Relations to create (M2O foreign keys)
const relations = [
  { collection: "directus_users", field: "branch", related_collection: "branches" },
  { collection: "directus_users", field: "supervisor", related_collection: "directus_users" },
  { collection: "directus_users", field: "assigned_underwriter", related_collection: "directus_users" },
  { collection: "directus_users", field: "app_removal_requested_by", related_collection: "directus_users" },
  { collection: "requests", field: "agent", related_collection: "directus_users" },
  { collection: "requests", field: "origin_agent", related_collection: "directus_users" },
  { collection: "requests", field: "branch", related_collection: "branches" },
  { collection: "request_notes", field: "request", related_collection: "requests", on_delete: "CASCADE" },
  { collection: "request_notes", field: "author", related_collection: "directus_users" },
  { collection: "request_files", field: "request", related_collection: "requests", on_delete: "CASCADE" },
  { collection: "request_files", field: "file", related_collection: "directus_files" },
  { collection: "request_files", field: "uploaded_by", related_collection: "directus_users" },
  { collection: "notifications", field: "recipient", related_collection: "directus_users" },
  { collection: "audit_log", field: "actor", related_collection: "directus_users" },
];

async function ensureCollections() {
  console.log("\n📦 Collections…");
  for (const def of collections) {
    if (await exists(`/collections/${def.collection}`)) {
      console.log(`   = ${def.collection} (exists)`);
      continue;
    }
    await api("/collections", { method: "POST", body: JSON.stringify(def) });
    console.log(`   + ${def.collection}`);
  }
}

async function ensureUserFields() {
  console.log("\n👤 directus_users extension fields…");
  for (const f of userFields) {
    if (await exists(`/fields/directus_users/${f.field}`)) {
      console.log(`   = ${f.field} (exists)`);
      continue;
    }
    await api("/fields/directus_users", { method: "POST", body: JSON.stringify(f) });
    console.log(`   + ${f.field}`);
  }
}

async function ensureRelations() {
  console.log("\n🔗 Relations…");
  // Pull all existing relations once so we can skip any (collection, field)
  // pair that already has a relation row, regardless of how it was created
  // (bootstrap re-run, manual setup, partial previous run, etc.).
  const allRel = await api<{
    data: Array<{ collection: string; field: string; related_collection: string | null }>;
  }>("/relations?limit=-1").catch(() => ({ data: [] as Array<{ collection: string; field: string; related_collection: string | null }> }));
  const have = new Set(allRel.data.map((r) => `${r.collection}.${r.field}`));

  for (const r of relations) {
    const id = `${r.collection}.${r.field}`;
    if (have.has(id)) {
      console.log(`   = ${id} (exists)`);
      continue;
    }

    // Directus 11.x relations API expects collection/field/related_collection
    // at the top level plus a `meta` block. The `schema` block is what
    // creates the underlying FK constraint — but only if both columns
    // already exist with compatible types. We let Directus infer the FK
    // (omit `schema`) and only pass on_delete via meta if provided, then
    // fall back to a no-schema payload if the DB-level FK fails.
    const payload: Record<string, unknown> = {
      collection: r.collection,
      field: r.field,
      related_collection: r.related_collection,
      meta: {
        many_collection: r.collection,
        many_field: r.field,
        one_collection: r.related_collection,
      },
      schema: { on_delete: r.on_delete ?? "SET NULL" },
    };

    try {
      await api("/relations", { method: "POST", body: JSON.stringify(payload) });
      console.log(`   + ${id}`);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      // Already present (race / partial bootstrap) — treat as success.
      if (/already exists|RecordNotUnique|duplicate/i.test(msg)) {
        console.log(`   = ${id} (already present)`);
        continue;
      }
      // Some DB states (existing column without FK, or self-referential
      // user→user FKs on an external auth table) reject the FK creation
      // with a misleading "Collection X doesn't exist". Retry as a
      // metadata-only relation so the Directus UI still wires it up.
      if (/doesn't exist|does not exist|Invalid payload/i.test(msg)) {
        try {
          const metaOnly = { ...payload };
          delete (metaOnly as { schema?: unknown }).schema;
          await api("/relations", { method: "POST", body: JSON.stringify(metaOnly) });
          console.log(`   + ${id} (meta-only, no FK)`);
          continue;
        } catch (e2) {
          const msg2 = String((e2 as Error).message ?? e2);
          if (/already exists|RecordNotUnique|duplicate/i.test(msg2)) {
            console.log(`   = ${id} (already present)`);
            continue;
          }
          console.warn(`   ! ${id} skipped: ${msg2.split("\n")[0]}`);
          continue;
        }
      }
      throw e;
    }
  }
}

// ----------------- 2. Roles & Permissions -----------------

const ROLE_NAMES = ["Admin", "Supervisor", "Agent"] as const;
type RoleName = (typeof ROLE_NAMES)[number];

async function ensureRoles(): Promise<Record<RoleName, string>> {
  console.log("\n🛡️  Roles…");
  const existing = await api<{ data: Array<{ id: string; name: string }> }>(
    "/roles?fields=id,name&limit=-1",
  );
  const map = {} as Record<RoleName, string>;

  for (const name of ROLE_NAMES) {
    const found = existing.data.find((r) => r.name === name);
    if (found) {
      map[name] = found.id;
      console.log(`   = ${name}`);
      continue;
    }
    const created = await api<{ data: { id: string } }>("/roles", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: `App role: ${name}`,
      }),
    });
    map[name] = created.data.id;
    console.log(`   + ${name}`);
  }
  return map;
}

// Directus 11 moved admin_access / app_access / permissions from roles onto
// POLICIES. Each role needs a policy attached via the directus_access junction.
// We create one policy per app role and attach it. Admin also gets explicit
// CRUD rows below because Directus 11 portal/API item access is policy-based.
async function ensurePolicies(
  roleMap: Record<RoleName, string>,
): Promise<Record<RoleName, string>> {
  console.log("\n📜 Policies…");
  const existing = await api<{ data: Array<{ id: string; name: string }> }>(
    "/policies?fields=id,name&limit=-1",
  );
  const map = {} as Record<RoleName, string>;

  for (const name of ROLE_NAMES) {
    const policyName = `${name} Policy`;
    let policy = existing.data.find((p) => p.name === policyName);
    if (!policy) {
      const created = await api<{ data: { id: string } }>("/policies", {
        method: "POST",
        body: JSON.stringify({
          name: policyName,
          icon: "policy",
          description: `App policy for ${name}`,
          admin_access: name === "Admin",
          app_access: true,
        }),
      });
      policy = { id: created.data.id, name: policyName };
      console.log(`   + ${policyName}`);
    } else {
      // Ensure admin_access flag is correct on the Admin policy (in case it
      // was created earlier without it).
      try {
        await api(`/policies/${policy.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            admin_access: name === "Admin",
            app_access: true,
          }),
        });
      } catch {
        // ignore
      }
      console.log(`   = ${policyName}`);
    }
    map[name] = policy.id;

    // Attach policy to role via directus_access junction (idempotent).
    try {
      const links = await api<{ data: Array<{ id: string }> }>(
        `/access?fields=id&filter[role][_eq]=${roleMap[name]}&filter[policy][_eq]=${policy.id}&limit=1`,
      );
      if (!links.data.length) {
        await api("/access", {
          method: "POST",
          body: JSON.stringify({ role: roleMap[name], policy: policy.id }),
        });
        console.log(`     ↳ linked ${name} role → policy`);
      }
    } catch (e) {
      const msg = String((e as Error).message ?? e).split("\n")[0];
      console.warn(`     ! link ${name} role↔policy skipped: ${msg}`);
    }
  }
  return map;
}

type PermissionEntry = {
  _comment?: string;
  validation?: unknown;
  permissions?: unknown;
  fields?: string[];
  action: string;
  collection: string;
};

const ADMIN_PERMISSION_COLLECTIONS = [
  "branches",
  "requests",
  "request_notes",
  "request_files",
  "notifications",
  "audit_log",
  "app_settings",
  "directus_users",
  "directus_files",
  "directus_roles",
] as const;

const ADMIN_PERMISSION_ACTIONS = ["create", "read", "update", "delete"] as const;

const adminPermissions: PermissionEntry[] = ADMIN_PERMISSION_COLLECTIONS.flatMap((collection) =>
  ADMIN_PERMISSION_ACTIONS.map((action) => ({
    collection,
    action,
    fields: ["*"],
    permissions: {},
    validation: {},
    _comment: "Admin full CRUD for portal",
  })),
);

function isAppendOnlyPermissionSuccess(message: string): boolean {
  return /RecordNotUnique|duplicate|already exists|violates unique constraint|409|400/i.test(message);
}

async function ensurePermissions(roleMap: Record<RoleName, string>) {
  // Resolve policy IDs (one per role). Directus 11 is policy-based, so Admin
  // needs explicit CRUD permission rows on its policy; do not rely only on
  // role/admin_access fields, which are often forbidden to read in 11.x.
  const policyMap = await ensurePolicies(roleMap);

  console.log("\n🔐 Permissions…");
  // Directus 11.3.5 restricts reads on directus_permissions (the `role`
  // field is not introspectable via the items API, and `comment` no longer
  // exists). We therefore skip introspection entirely and run the step as
  // append-only: attempt to POST every configured permission and treat any
  // "already exists" / 400 / 409 response as success.

  const config = permissionsConfig as Record<string, PermissionEntry[]>;
  const batches: Array<{ role: RoleName; entries: PermissionEntry[] }> = [
    { role: "Admin", entries: adminPermissions },
    { role: "Supervisor", entries: config.supervisor },
    { role: "Agent", entries: config.agent },
  ];

  // Substitute the dynamic Agent role UUID anywhere it appears as the
  // literal string "$AGENT_ROLE_ID" inside validation/permissions JSON.
  const agentRoleId = roleMap.Agent;
  const substitute = (v: unknown): unknown => {
    if (typeof v === "string") return v === "$AGENT_ROLE_ID" ? agentRoleId : v;
    if (Array.isArray(v)) return v.map(substitute);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) o[k] = substitute(val);
      return o;
    }
    return v;
  };

  for (const { role, entries } of batches) {
    for (const entry of entries) {
      const { _comment, validation, permissions, fields, action, collection } = entry;
      try {
        await api("/permissions", {
          method: "POST",
          body: JSON.stringify({
            policy: policyMap[role],
            collection,
            action,
            fields: fields ?? ["*"],
            permissions: substitute(permissions ?? {}),
            validation: substitute(validation ?? {}),
          }),
        });
        console.log(`   + ${role} → ${collection}.${action}${_comment ? " // " + _comment : ""}`);
      } catch (e) {
        // Append-only: any failure (duplicate, 400, 409, validation) is
        // logged and skipped — never abort the bootstrap.
        const msg = String((e as Error).message ?? e).split("\n")[0];
        if (isAppendOnlyPermissionSuccess(msg)) {
          console.log(`   = ${role} → ${collection}.${action} (already present or rejected, skipped)`);
        } else {
          console.warn(`   ! ${role} → ${collection}.${action} skipped: ${msg}`);
        }
      }
    }
  }
}

// ----------------- 3. Flows -----------------
//
// Each flow's operations are a chain. We create them in order, then PATCH each
// operation's `resolve` to point at the next one. The flow's `operation` field
// is set to the first operation. `reject` paths are wired explicitly when the
// op definition includes `rejectKey`.
//
// Note on `exec` operations: Directus exec ops receive only the data envelope
// (previous-step results, payload, accountability). They cannot call services.
// Cross-collection lookups MUST use `item-read` ops, not `services.usersService`.

type OpDef = {
  key: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
  position_x?: number;
  position_y?: number;
  rejectKey?: string;
};

type FlowDef = {
  name: string;
  icon: string;
  color: string;
  description: string;
  status: string;
  trigger: string;
  accountability: string;
  options: Record<string, unknown>;
  operations: OpDef[];
};

const flows: FlowDef[] = [
  // ---- Stamp assigned_at when agent changes (pure payload mutation, no DB) ----
  {
    name: "lovable: auto_assigned_at",
    icon: "schedule",
    color: "#3498DB",
    description: "Sets assigned_at when agent changes.",
    status: "active",
    trigger: "event",
    accountability: "all",
    options: { type: "filter", scope: ["items.update"], collections: ["requests"] },
    operations: [
      {
        key: "stamp",
        name: "Stamp timestamp",
        type: "exec",
        options: {
          code: "module.exports = async function({ $trigger }) { const p = $trigger.payload; if (p && 'agent' in p) { p.assigned_at = new Date().toISOString(); } return { payload: p }; };",
        },
      },
    ],
  },

  // ---- Reject sales reassignment to wrong UW ----
  // Chain: read_me → condition (sales? AND agent changed AND target != my UW) → reject_exec
  {
    name: "lovable: enforce_sales_routing",
    icon: "policy",
    color: "#E74C3C",
    description: "Sales staff can only reassign to their assigned underwriter.",
    status: "active",
    trigger: "event",
    accountability: "all",
    options: { type: "filter", scope: ["items.update"], collections: ["requests"] },
    operations: [
      {
        key: "read_me",
        name: "Read current user",
        type: "item-read",
        options: {
          collection: "directus_users",
          key: "{{$accountability.user}}",
          query: { fields: ["id", "app_role", "staff_type", "assigned_underwriter"] },
        },
      },
      {
        key: "is_violation",
        name: "Sales reassigning to wrong UW?",
        type: "condition",
        options: {
          filter: {
            _and: [
              { "$last.staff_type": { _eq: "sales" } },
              { "$last.app_role": { _eq: "agent" } },
              { "$trigger.payload.agent": { _nnull: true } },
            ],
          },
        },
        // condition resolves on match, rejects on no-match. We want to reject (=throw) only on match,
        // so we put the throwing exec on the resolve path AND check the underwriter match inside it.
      },
      {
        key: "verify_target",
        name: "Verify target is assigned UW",
        type: "exec",
        options: {
          code: "module.exports = async function({ $last, $trigger }) { const me = $last; const target = $trigger.payload.agent; if (target && me && me.assigned_underwriter && target !== me.assigned_underwriter) { throw new Error('Sales agents can only reassign to their assigned underwriter.'); } return {}; };",
        },
      },
    ],
  },

  // ---- Block non-underwriters from uploading kind=quote ----
  {
    name: "lovable: quote_kind_guard",
    icon: "verified",
    color: "#9B59B6",
    description: "Only underwriters / supervisors / admins can upload kind=quote files.",
    status: "active",
    trigger: "event",
    accountability: "all",
    options: { type: "filter", scope: ["items.create"], collections: ["request_files"] },
    operations: [
      {
        key: "is_quote",
        name: "Is quote upload?",
        type: "condition",
        options: {
          filter: { "$trigger.payload.kind": { _eq: "quote" } },
        },
      },
      {
        key: "read_me",
        name: "Read current user",
        type: "item-read",
        options: {
          collection: "directus_users",
          key: "{{$accountability.user}}",
          query: { fields: ["id", "app_role", "staff_type"] },
        },
      },
      {
        key: "guard",
        name: "Reject if not underwriter",
        type: "exec",
        options: {
          code: "module.exports = async function({ $last }) { const ok = $last && ($last.app_role === 'admin' || $last.app_role === 'supervisor' || $last.staff_type === 'underwriter'); if (!ok) throw new Error('Only underwriters can upload quotes.'); return {}; };",
        },
      },
    ],
  },

  // ---- Webhook flow for sales reassignment (server-side enforced) ----
  // POST /flows/trigger/<id>  body: { request_id, new_agent_id }
  // 1. read_me → 2. condition (am I authorized for this target?) → 3. patch request
  {
    name: "lovable: reassign_request",
    icon: "swap_horiz",
    color: "#27AE60",
    description: "Authorized reassignment endpoint. Validates server-side then patches request.agent.",
    status: "active",
    trigger: "webhook",
    accountability: "all",
    options: { method: "POST", async: false, return: "$last" },
    operations: [
      {
        key: "read_me",
        name: "Read current user",
        type: "item-read",
        options: {
          collection: "directus_users",
          key: "{{$accountability.user}}",
          query: { fields: ["id", "app_role", "staff_type", "branch", "assigned_underwriter"] },
        },
      },
      {
        key: "validate",
        name: "Validate reassignment",
        type: "exec",
        options: {
          code: "module.exports = async function({ $last, $trigger }) { const me = $last; const body = $trigger.body || {}; if (!body.request_id || !body.new_agent_id) throw new Error('request_id and new_agent_id required'); if (!me) throw new Error('Unauthenticated'); if (me.app_role === 'admin' || me.app_role === 'supervisor') return { request_id: body.request_id, new_agent_id: body.new_agent_id }; if (me.staff_type === 'sales') { if (body.new_agent_id !== me.assigned_underwriter) throw new Error('Sales agents can only reassign to their assigned underwriter.'); return { request_id: body.request_id, new_agent_id: body.new_agent_id }; } if (me.staff_type === 'underwriter') { return { request_id: body.request_id, new_agent_id: body.new_agent_id }; } throw new Error('Not authorized'); };",
        },
      },
      {
        key: "patch",
        name: "Patch request.agent",
        type: "item-update",
        options: {
          collection: "requests",
          key: "{{$last.request_id}}",
          payload: { agent: "{{$last.new_agent_id}}", assigned_at: "{{$now}}" },
        },
      },
    ],
  },
];

async function ensureFlows() {
  console.log("\n⚡ Flows…");
  const existing = await api<{ data: Array<{ id: string; name: string }> }>("/flows?limit=-1");
  for (const f of flows) {
    const found = existing.data.find((x) => x.name === f.name);
    if (found) {
      console.log(`   = ${f.name} (exists)`);
      continue;
    }
    const { operations, ...flowMeta } = f;
    const created = await api<{ data: { id: string } }>("/flows", {
      method: "POST",
      body: JSON.stringify(flowMeta),
    });
    const flowId = created.data.id;

    // Create operations in order, capturing their IDs
    const opIds: string[] = [];
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const created = await api<{ data: { id: string } }>("/operations", {
        method: "POST",
        body: JSON.stringify({
          flow: flowId,
          key: op.key,
          name: op.name,
          type: op.type,
          options: op.options,
          position_x: 20 + i * 200,
          position_y: 20,
        }),
      });
      opIds.push(created.data.id);
    }

    // Wire resolve chain: each op's resolve points to the next
    for (let i = 0; i < opIds.length - 1; i++) {
      await api(`/operations/${opIds[i]}`, {
        method: "PATCH",
        body: JSON.stringify({ resolve: opIds[i + 1] }),
      });
    }

    // Set flow entry point
    await api(`/flows/${flowId}`, {
      method: "PATCH",
      body: JSON.stringify({ operation: opIds[0] }),
    });

    console.log(`   + ${f.name} (${opIds.length} ops)`);
  }
}

// ----------------- Main -----------------

async function main() {
  console.log(`🚀 Bootstrapping Directus at ${URL_BASE}`);
  await ensureCollections();
  await ensureUserFields();
  await ensureRelations();
  const roleMap = await ensureRoles();
  await ensurePermissions(roleMap);
  await ensureFlows();
  console.log("\n✅ Done. Run scripts/directus-seed.ts next to add demo data.");
}

main().catch((err) => {
  console.error("\n💥 Bootstrap failed:", err);
  process.exit(1);
});
