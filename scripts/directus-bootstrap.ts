/**
 * Directus Bootstrap — idempotent.
 *
 * ينشئ كل البنية: collections, fields, relations, roles, policies, permissions, flows.
 * تشغيل:
 *   DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN= DATABASE_URL=postgres://… npx tsx scripts/directus-bootstrap.ts
 *
 * كل خطوة بتتأكد قبل الإنشاء (idempotent). تقدر تشغّله أكثر من مرة.
 */

import permissionsConfig from "./directus-permissions.json" with { type: "json" };
import postgres from "postgres";

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

type SqlRow = Record<string, unknown>;
type SqlClient = {
  unsafe<T extends SqlRow = SqlRow>(query: string, params?: unknown[]): Promise<T[]>;
  end?: () => Promise<void>;
};

let dbClient: SqlClient | null = null;

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECTUS_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL (or DIRECTUS_DATABASE_URL) is required so bootstrap can verify and repair physical Directus SQL tables.",
    );
  }
  return databaseUrl;
}

function db(): SqlClient {
  if (!dbClient) {
    const sql = postgres(getDatabaseUrl(), { max: 4, prepare: false });
    dbClient = {
      unsafe: <T extends SqlRow = SqlRow>(query: string, params?: unknown[]) =>
        sql.unsafe(query, (params ?? []) as never[]) as unknown as Promise<T[]>,
      end: () => sql.end({ timeout: 5 }),
    };
  }
  return dbClient;
}

async function closeDatabase() {
  await dbClient?.end?.();
}

function quoteIdent(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
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
      { field: "date_created", type: "timestamp", meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true } },
      { field: "date_updated", type: "timestamp", meta: { special: ["date-updated"], interface: "datetime", readonly: true, hidden: true } },
      { field: "user_created", type: "uuid", meta: { special: ["user-created"], interface: "select-dropdown-m2o", readonly: true, hidden: true } },
      { field: "user_updated", type: "uuid", meta: { special: ["user-updated"], interface: "select-dropdown-m2o", readonly: true, hidden: true } },
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
              { text: "Quoted", value: "quoted" },
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
      { field: "quote_confirmed", type: "boolean", meta: { interface: "boolean", note: "Customer confirmed quote from public quote page." }, schema: { default_value: false } },
      { field: "quote_confirmed_at", type: "timestamp", meta: { interface: "datetime" } },
      { field: "payment_link", type: "string", meta: { interface: "input" } },
      { field: "payment_message", type: "text", meta: { interface: "input-multiline" } },
      { field: "payment_link_sent_at", type: "timestamp", meta: { interface: "datetime" } },
      { field: "assigned_at", type: "timestamp", meta: { interface: "datetime" } },
      { field: "date_created", type: "timestamp", meta: { special: ["date-created"], interface: "datetime", readonly: true, hidden: true } },
      { field: "date_updated", type: "timestamp", meta: { special: ["date-updated"], interface: "datetime", readonly: true, hidden: true } },
      { field: "user_created", type: "uuid", meta: { special: ["user-created"], interface: "select-dropdown-m2o", readonly: true, hidden: true } },
      { field: "user_updated", type: "uuid", meta: { special: ["user-updated"], interface: "select-dropdown-m2o", readonly: true, hidden: true } },
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

function sqlTypeForField(field: FieldDef): string {
  const schema = field.schema ?? {};
  const isPrimaryKey = schema.is_primary_key === true;
  const hasAutoIncrement = schema.has_auto_increment === true;
  const special = Array.isArray(field.meta?.special) ? field.meta.special : [];
  const defaultValue = schema.default_value;

  let type: string;
  if (field.type === "integer") {
    type = isPrimaryKey && hasAutoIncrement ? "integer GENERATED BY DEFAULT AS IDENTITY" : "integer";
  } else if (field.type === "uuid") {
    const needsUuidDefault = isPrimaryKey || special.includes("uuid") || field.field === "uuid";
    type = `uuid${needsUuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;
  } else if (field.type === "timestamp") {
    const needsNowDefault = special.includes("date-created") || special.includes("date-updated") || field.field === "ts";
    type = `timestamp with time zone${needsNowDefault ? " DEFAULT now()" : ""}`;
  } else if (field.type === "boolean") {
    type = `boolean${typeof defaultValue === "boolean" ? ` DEFAULT ${defaultValue}` : ""}`;
  } else if (field.type === "text") {
    type = "text";
  } else if (field.type === "json") {
    type = "jsonb";
  } else {
    type = isPrimaryKey ? "varchar(255)" : "varchar(255)";
  }

  if (isPrimaryKey) type += " PRIMARY KEY";
  return type;
}

function columnDefinition(field: FieldDef): string {
  return `${quoteIdent(field.field)} ${sqlTypeForField(field)}`;
}

async function tableExists(collection: string): Promise<boolean> {
  const rows = await db().unsafe<{ exists: boolean }>(
    "select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = $1) as exists",
    [collection],
  );
  return rows[0]?.exists === true;
}

async function existingColumns(collection: string): Promise<Set<string>> {
  const rows = await db().unsafe<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
    [collection],
  );
  return new Set(rows.map((row) => row.column_name));
}

async function ensureUniqueIndexes(def: CollectionDef) {
  for (const field of def.fields) {
    if (field.schema?.is_unique !== true) continue;
    const indexName = `${def.collection}_${field.field}_unique`;
    await db().unsafe(
      `create unique index if not exists ${quoteIdent(indexName)} on ${quoteIdent(def.collection)} (${quoteIdent(field.field)})`,
    );
  }
}

async function ensurePhysicalTable(def: CollectionDef) {
  const collection = def.collection;
  await db().unsafe("create extension if not exists pgcrypto");
  const existsInSql = await tableExists(collection);

  if (!existsInSql) {
    await db().unsafe(
      `create table ${quoteIdent(collection)} (${def.fields.map(columnDefinition).join(", ")})`,
    );
    console.log(`   + ${collection} SQL table (repaired missing physical table)`);
    await ensureUniqueIndexes(def);
    return;
  }

  const have = await existingColumns(collection);
  for (const field of def.fields) {
    if (have.has(field.field)) continue;
    await db().unsafe(
      `alter table ${quoteIdent(collection)} add column ${columnDefinition(field)}`,
    );
    console.log(`   + ${collection}.${field.field} SQL column`);
  }
  await ensureUniqueIndexes(def);
}

async function ensureCollections() {
  console.log("\n📦 Collections…");
  for (const def of collections) {
    if (await exists(`/collections/${def.collection}`)) {
      console.log(`   = ${def.collection} (exists)`);
    } else {
      await api("/collections", { method: "POST", body: JSON.stringify(def) });
      console.log(`   + ${def.collection}`);
    }

    // Directus metadata can exist while the real SQL table is missing
    // (orphaned directus_collections row). Always verify and repair the
    // physical table + columns before field metadata/permissions run.
    await ensurePhysicalTable(def);
  }

  // Defensive: every app collection must have meta.accountability = "all"
  // so item permission policies are enforced (and writes don't bypass them
  // via a null accountability path). Patch in place — idempotent.
  for (const def of collections) {
    try {
      await api(`/collections/${def.collection}`, {
        method: "PATCH",
        body: JSON.stringify({ meta: { accountability: "all" } }),
      });
    } catch (e) {
      const msg = String((e as Error).message ?? e).split("\n")[0];
      console.warn(`   ! accountability patch ${def.collection}: ${msg}`);
    }
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

// Ensure every field listed on each app collection actually has a
// directus_fields row. Critical: if the collection table was created
// outside of Directus (raw SQL / restored dump), the API will list the
// collection but `directus_fields` stays empty — every read/write then
// 403s because the permission engine has no field metadata to authorize
// against. POST /fields/<collection> is idempotent on Directus 11: it
// registers the metadata when the column already exists, and creates the
// column when it doesn't.
async function ensureCollectionFields() {
  console.log("\n🧱 Collection fields…");
  for (const def of collections) {
    for (const f of def.fields) {
      if (await exists(`/fields/${def.collection}/${f.field}`)) {
        continue;
      }
      try {
        await api(`/fields/${def.collection}`, {
          method: "POST",
          body: JSON.stringify(f),
        });
        console.log(`   + ${def.collection}.${f.field}`);
      } catch (e) {
        const msg = String((e as Error).message ?? e).split("\n")[0];
        if (/already exists|RecordNotUnique|duplicate/i.test(msg)) {
          console.log(`   = ${def.collection}.${f.field} (already present)`);
          continue;
        }
        // Retry as metadata-only (no schema) — covers the case where the
        // column already exists in the DB but Directus tries to ALTER it.
        try {
          const metaOnly = { field: f.field, type: f.type, meta: f.meta ?? {} };
          await api(`/fields/${def.collection}`, {
            method: "POST",
            body: JSON.stringify(metaOnly),
          });
          console.log(`   + ${def.collection}.${f.field} (meta-only)`);
        } catch (e2) {
          const msg2 = String((e2 as Error).message ?? e2).split("\n")[0];
          console.warn(`   ! ${def.collection}.${f.field}: ${msg2}`);
        }
      }
    }
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
type RoleMap = Record<RoleName, string> & { adminTargetRoleIds: string[] };

async function ensureRoles(): Promise<RoleMap> {
  console.log("\n🛡️  Roles…");
  const existing = await api<{ data: Array<{ id: string; name: string }> }>(
    "/roles?fields=id,name&limit=-1",
  );
  const map = {} as RoleMap;

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

  const administratorRole = existing.data.find((r) => r.name === "Administrator");
  map.adminTargetRoleIds = Array.from(new Set([
    map.Admin,
    ...(administratorRole ? [administratorRole.id] : []),
  ]));
  if (administratorRole) console.log("   = Administrator (will receive Admin policy)");
  return map;
}

// Directus 11 moved admin_access / app_access / permissions from roles onto
// POLICIES. Each role needs a policy attached via the directus_access junction.
// We create one policy per app role and attach it. Admin also gets explicit
// CRUD rows below because Directus 11 portal/API item access is policy-based.
async function ensurePolicies(
  roleMap: RoleMap,
): Promise<Record<RoleName, string>> {
  console.log("\n📜 Policies…");
  const existing = await api<{ data: Array<{ id: string; name: string }> }>(
    "/policies?fields=id,name&limit=-1",
  );
  const map = {} as Record<RoleName, string>;

  for (const name of ROLE_NAMES) {
    const policyName = `App ${name} Policy`;
    const legacyName = `${name} Policy`;
    let policy =
      existing.data.find((p) => p.name === policyName) ??
      existing.data.find((p) => p.name === legacyName);
    // If we found the legacy-named policy, rename it to the standardized name.
    if (policy && policy.name === legacyName) {
      try {
        await api(`/policies/${policy.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: policyName }),
        });
        console.log(`   ~ renamed "${legacyName}" → "${policyName}"`);
      } catch {
        // ignore — name conflict means the standardized one already exists
      }
    }
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

    const targetRoleIds = name === "Admin" ? roleMap.adminTargetRoleIds : [roleMap[name]];
    for (const targetRoleId of targetRoleIds) {
      try {
        await api("/access", {
          method: "POST",
          body: JSON.stringify({ role: targetRoleId, policy: policy.id }),
        });
        console.log(`     ↳ linked ${name} policy → role ${targetRoleId}`);
      } catch (e) {
        const msg = String((e as Error).message ?? e).split("\n")[0];
        if (isAppendOnlyPermissionSuccess(msg)) {
          console.log(`     = ${name} policy → role ${targetRoleId} (already linked)`);
        } else {
          console.warn(`     ! link ${name} policy→role ${targetRoleId} skipped: ${msg}`);
        }
      }
    }

    // Defensive: also attach the App Admin Policy directly to every user
    // whose app_role = "admin". This guarantees the policy is in the user's
    // resolved permission set even if their role assignment didn't pick it
    // up (e.g. custom Admin role vs built-in Administrator role).
    if (name === "Admin") {
      try {
        const adminUsers = await api<{ data: Array<{ id: string }> }>(
          "/users?filter[app_role][_eq]=admin&fields=id&limit=-1",
        );
        for (const u of adminUsers.data) {
          try {
            await api("/access", {
              method: "POST",
              body: JSON.stringify({ user: u.id, policy: policy.id }),
            });
            console.log(`     ↳ linked Admin policy → user ${u.id}`);
          } catch (e) {
            const msg = String((e as Error).message ?? e).split("\n")[0];
            if (isAppendOnlyPermissionSuccess(msg)) {
              console.log(`     = Admin policy → user ${u.id} (already linked)`);
            } else {
              console.warn(`     ! link Admin policy→user ${u.id} skipped: ${msg}`);
            }
          }
        }
      } catch (e) {
        const msg = String((e as Error).message ?? e).split("\n")[0];
        console.warn(`     ! admin user lookup skipped: ${msg}`);
      }
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

async function ensurePermissions(roleMap: RoleMap) {
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

  await ensurePublicUploadPermissions();
}

// Anonymous public upload page (/?agent=<id-or-code>) needs a narrow set of
// permissions on the Public policy so customers can submit a request + files
// without logging in. See scripts/directus-patch-public-upload.ts for the
// stand-alone patch script that mirrors this exact set.
async function ensurePublicUploadPermissions(): Promise<void> {
  console.log("\n🔐 Public policy (anonymous customer upload)…");
  let publicPolicyId: string | null = null;
  try {
    const access = await api<{
      data: Array<{ policy: string | { id: string } }>;
    }>(`/access?limit=-1&fields=id,policy,role&filter[role][_null]=true`);
    for (const row of access.data) {
      const pid = typeof row.policy === "string" ? row.policy : row.policy?.id;
      if (pid) {
        publicPolicyId = pid;
        break;
      }
    }
  } catch (e) {
    console.warn(`   ! could not resolve Public policy: ${(e as Error).message}`);
  }
  if (!publicPolicyId) {
    try {
      const created = await api<{ data: { id: string } }>("/policies", {
        method: "POST",
        body: JSON.stringify({ name: "Public", icon: "public", description: "Public policy" }),
      });
      publicPolicyId = created.data.id;
      try {
        await api("/access", {
          method: "POST",
          body: JSON.stringify({ role: null, policy: publicPolicyId }),
        });
      } catch {
        /* tolerated — may already be linked */
      }
    } catch (e) {
      console.warn(`   ! could not create Public policy: ${(e as Error).message}`);
      return;
    }
  }

  const publicPerms: PermissionEntry[] = [
    {
      collection: "directus_users",
      action: "read",
      fields: ["id", "first_name", "last_name", "agent_code", "app_role", "staff_type", "branch", "app_active"],
      permissions: {
        _and: [
          { app_role: { _eq: "agent" } },
          { app_active: { _eq: true } },
        ],
      },
      _comment: "Resolve sales agent from public upload link",
    },
    {
      collection: "branches",
      action: "read",
      fields: ["id", "code", "name_en", "name_ar"],
      _comment: "Branch cache warmup",
    },
    {
      collection: "requests",
      action: "create",
      fields: ["id", "status", "customer_name", "customer_email", "customer_phone", "agent", "origin_agent", "branch"],
      validation: { status: { _eq: "new" } },
      _comment: "Public customer upload",
    },
    {
      collection: "directus_files",
      action: "create",
      _comment: "Upload customer documents",
    },
    {
      collection: "directus_files",
      action: "read",
      fields: ["id", "filename_download", "type", "filesize"],
      _comment: "Read just-uploaded file metadata",
    },
    {
      collection: "request_files",
      action: "create",
      fields: ["id", "request", "kind", "file", "uploaded_at", "uploaded_by"],
      _comment: "Link uploaded files to the new request",
    },
    {
      collection: "audit_log",
      action: "create",
      fields: ["action", "entity_type", "entity_id", "entity_label", "branch", "before", "after", "meta", "actor", "actor_role", "actor_branch"],
      validation: { entity_type: { _eq: "request" } },
      _comment: "Write Request History entry for anonymous customer uploads",
    },
  ];

  for (const entry of publicPerms) {
    const { _comment, validation, permissions, fields, action, collection } = entry;
    try {
      await api("/permissions", {
        method: "POST",
        body: JSON.stringify({
          policy: publicPolicyId,
          collection,
          action,
          fields: fields ?? ["*"],
          permissions: permissions ?? {},
          validation: validation ?? {},
        }),
      });
      console.log(`   + Public → ${collection}.${action}${_comment ? " // " + _comment : ""}`);
    } catch (e) {
      const msg = String((e as Error).message ?? e).split("\n")[0];
      if (isAppendOnlyPermissionSuccess(msg)) {
        console.log(`   = Public → ${collection}.${action} (already present, skipped)`);
      } else {
        console.warn(`   ! Public → ${collection}.${action} skipped: ${msg}`);
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
  // Chain: agent_changed? → read_me → read_target → exec validate. Non-agent updates
  // (status/buttons/customer fields) pass through without reading directus_users.
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
        key: "agent_changed",
        name: "Agent field changed?",
        type: "condition",
        options: {
          filter: { "$trigger.payload.agent": { _nnull: true } },
        },
        rejectKey: "passthrough",
      },
      {
        key: "read_me",
        name: "Read current user",
        type: "item-read",
        options: {
          collection: "directus_users",
          key: "{{$accountability.user}}",
          query: { fields: ["id", "app_role", "staff_type", "assigned_underwriter", "assigned_underwriter_code"] },
        },
      },
      {
        key: "read_target",
        name: "Read target agent",
        type: "item-read",
        options: {
          collection: "directus_users",
          key: "{{$trigger.payload.agent}}",
          query: { fields: ["id", "agent_code", "staff_type"] },
        },
      },
      {
        key: "verify_target",
        name: "Verify target is assigned UW",
        type: "exec",
        options: {
          code: "module.exports = async function(data) { const me = data.read_me || {}; const targetUser = data.$last || {}; const target = data.$trigger && data.$trigger.payload ? data.$trigger.payload.agent : null; if (!target) return {}; if (me.app_role !== 'agent' || me.staff_type !== 'sales') return {}; const assignedId = me.assigned_underwriter && typeof me.assigned_underwriter === 'object' ? me.assigned_underwriter.id : me.assigned_underwriter; const assignedCode = me.assigned_underwriter_code; const ok = (assignedId && target === assignedId) || (assignedCode && targetUser.agent_code === assignedCode); if (!ok) throw new Error('Sales agents can only reassign to their assigned underwriter.'); return {}; };",
        },
      },
      {
        key: "passthrough",
        name: "Allow non-agent updates",
        type: "exec",
        options: {
          code: "module.exports = async function() { return {}; };",
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
        rejectKey: "passthrough",
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
      {
        key: "passthrough",
        name: "Allow non-quote uploads",
        type: "exec",
        options: {
          code: "module.exports = async function() { return {}; };",
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

  // ---- After a customer upload, flip parent request "new"/"reupload" → "processing" ----
  // Trigger: items.create on request_files (action, non-blocking).
  // Accountability "null" so it bypasses the public role's missing
  // update-permission on requests.
  {
    name: "lovable: customer_upload_status",
    icon: "autorenew",
    color: "#16A085",
    description: "When a customer uploads a file, move parent request from 'new'/'reupload' to 'processing'.",
    status: "active",
    trigger: "event",
    accountability: "null",
    options: { type: "action", scope: ["items.create"], collections: ["request_files"] },
    operations: [
      {
        key: "is_customer_upload",
        name: "Skip quote uploads",
        type: "condition",
        options: {
          filter: { "$trigger.payload.kind": { _nin: ["quote"] } },
        },
      },
      {
        key: "read_request",
        name: "Read parent request",
        type: "item-read",
        options: {
          collection: "requests",
          key: "{{$trigger.payload.request}}",
          query: { fields: ["id", "status"] },
        },
      },
      {
        key: "is_new",
        name: "Status is 'new' or 'reupload'?",
        type: "condition",
        options: {
          filter: { "$last.status": { _in: ["new", "reupload"] } },
        },
      },
      {
        key: "set_processing",
        name: "Set status = processing",
        type: "item-update",
        options: {
          collection: "requests",
          key: "{{read_request.id}}",
          payload: { status: "processing" },
        },
      },
      {
        key: "log_status_change",
        name: "Request History: status changed",
        type: "item-create",
        options: {
          collection: "audit_log",
          payload: {
            action: "request.status_changed",
            entity_type: "request",
            entity_id: "{{read_request.id}}",
            entity_label: "{{read_request.id}}",
            actor_role: "anonymous",
            before: { status: "{{read_request.status}}" },
            after: { status: "processing" },
            meta: { auto: true, reason: "customer_upload" },
          },
        },
      },
    ],
  },

  // ---- After a customer upload, notify owner/origin agents + assigned UW ----
  // Trigger: items.create on request_files (action).
  // Accountability "null" so notifications can be created server-side
  // even when the upload came from an unauthenticated public link.
  {
    name: "lovable: customer_upload_notify",
    icon: "notifications_active",
    color: "#2980B9",
    description: "Create notifications for owner/origin agents and assigned underwriter when a customer uploads files.",
    status: "active",
    trigger: "event",
    accountability: "null",
    options: { type: "action", scope: ["items.create"], collections: ["request_files"] },
    operations: [
      {
        key: "is_customer_upload",
        name: "Skip quote uploads",
        type: "condition",
        options: {
          filter: { "$trigger.payload.kind": { _nin: ["quote"] } },
        },
      },
      {
        key: "read_request",
        name: "Read parent request",
        type: "item-read",
        options: {
          collection: "requests",
          key: "{{$trigger.payload.request}}",
          query: { fields: ["id", "agent", "origin_agent"] },
        },
      },
      {
        key: "read_agent",
        name: "Read owner agent routing",
        type: "item-read",
        options: {
          collection: "directus_users",
          key: "{{read_request.agent}}",
          query: { fields: ["id", "assigned_underwriter"] },
        },
      },
      {
        key: "build_items",
        name: "Build notification rows",
        type: "exec",
        options: {
          code:
            "module.exports = async function(data) {" +
            " const req = data.read_request || {};" +
            " const owner = data.read_agent || {};" +
            " const seen = new Set();" +
            " const recipients = [];" +
            " function add(uid) { if (uid && !seen.has(uid)) { seen.add(uid); recipients.push(uid); } }" +
            " add(req.agent);" +
            " add(req.origin_agent);" +
            " const assigned = owner.assigned_underwriter && typeof owner.assigned_underwriter === 'object' ? owner.assigned_underwriter.id : owner.assigned_underwriter;" +
            " add(assigned);" +
            " const items = recipients.map(function(uid){ return {" +
            "   recipient: uid," +
            "   kind: 'request_new'," +
            "   title: 'New documents uploaded for request ' + req.id," +
            "   body: 'New documents uploaded for request ' + req.id," +
            "   link: '/requests/' + req.id," +
            "   read: false," +
            " }; });" +
            " return { items: items, has_any: items.length > 0, request_id: req.id };" +
            "};",
        },
      },
      {
        key: "has_recipients",
        name: "Any recipients?",
        type: "condition",
        options: {
          filter: { "$last.has_any": { _eq: true } },
        },
      },
      {
        key: "create_notifications",
        name: "Insert notification rows",
        type: "item-create",
        options: {
          collection: "notifications",
          payload: "{{$last.items}}",
        },
      },
    ],
  },
];

async function ensureFlows() {
  console.log("\n⚡ Flows…");
  const existing = await api<{ data: Array<{ id: string; name: string }> }>("/flows?limit=-1");
  const recreateIfExists = new Set([
    "lovable: enforce_sales_routing",
    "lovable: customer_upload_status",
    "lovable: customer_upload_notify",
  ]);
  for (const f of flows) {
    const found = existing.data.find((x) => x.name === f.name);
    if (found) {
      if (recreateIfExists.has(f.name)) {
        const ops = await api<{ data: Array<{ id: string }> }>(
          `/operations?limit=-1&fields=id&filter[flow][_eq]=${found.id}`,
        );
        try {
          await api(`/flows/${found.id}`, {
            method: "PATCH",
            body: JSON.stringify({ operation: null }),
          });
        } catch {
          // Already unset / partially deleted; continue repair.
        }
        if (ops.data.length) {
          await api(`/operations`, {
            method: "DELETE",
            body: JSON.stringify(ops.data.map((o) => o.id)),
          });
        }
        await api(`/flows/${found.id}`, { method: "DELETE" });
        console.log(`   ~ ${f.name} (recreating)`);
      } else {
      console.log(`   = ${f.name} (exists)`);
      continue;
      }
    }
    const { operations, ...flowMeta } = f;
    const created = await api<{ data: { id: string } }>("/flows", {
      method: "POST",
      body: JSON.stringify(flowMeta),
    });
    const flowId = created.data.id;

    // Create operations in order, capturing their IDs
    const opIds: string[] = [];
    const opKeyToId: Record<string, string> = {};
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
      opKeyToId[op.key] = created.data.id;
    }

    // Wire each op's resolve to the next sequential op UNLESS the next op is
    // referenced as someone's reject branch (it's a side-branch, not main path).
    const rejectTargets = new Set(
      operations.map((o) => o.rejectKey).filter((k): k is string => !!k),
    );
    for (let i = 0; i < operations.length - 1; i++) {
      const next = operations[i + 1];
      if (rejectTargets.has(next.key)) continue;
      await api(`/operations/${opIds[i]}`, {
        method: "PATCH",
        body: JSON.stringify({ resolve: opIds[i + 1] }),
      });
    }

    // Wire explicit reject branches
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.rejectKey && opKeyToId[op.rejectKey]) {
        await api(`/operations/${opIds[i]}`, {
          method: "PATCH",
          body: JSON.stringify({ reject: opKeyToId[op.rejectKey] }),
        });
      }
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
  await ensureCollectionFields();
  await ensureUserFields();
  await ensureRelations();
  const roleMap = await ensureRoles();
  await ensurePermissions(roleMap);
  await ensureFlows();
  console.log("\n✅ Done. Run scripts/directus-seed.ts next to add demo data.");
}

main()
  .catch((err) => {
    console.error("\n💥 Bootstrap failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
