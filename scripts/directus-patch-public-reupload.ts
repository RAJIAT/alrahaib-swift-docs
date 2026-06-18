/**
 * One-off patch: allow the **anonymous Public** role to use the customer
 * reupload page (`/r/:requestId`) to view a request's missing items and
 * upload the requested documents — without logging in.
 *
 * Grants on the Public policy (idempotent):
 *   - requests.read           limited fields (id, uuid, status, customer_name,
 *                             agent, branch, created_at)
 *   - requests.update         only `status`, validation status _in [processing]
 *   - request_notes.read      (id, request, text, kind, author_role,
 *                              date_created, resolved_at, resolved_by)
 *   - request_notes.update    only `resolved_at` (so the reupload page can
 *                              mark missing notes as resolved)
 *   - request_files.read      (id, request, kind, file, uploaded_at,
 *                              uploaded_by) so the page can show what was
 *                              already uploaded (no harm — only the row's
 *                              metadata, not the binary).
 *
 * The existing public-upload patch already grants directus_files create/read
 * and request_files.create, which the reupload page reuses.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=<admin_token> \
 *   npx tsx scripts/directus-patch-public-reupload.ts
 */

const URL_BASE = (process.env.DIRECTUS_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN ?? "";

if (!URL_BASE || !TOKEN) {
  console.error("Missing DIRECTUS_URL or DIRECTUS_ADMIN_TOKEN env vars.");
  process.exit(1);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function ensurePublicPolicy(): Promise<string> {
  const access = await api<{ data: Array<{ policy: string | { id: string } }> }>(
    `/access?limit=-1&fields=id,policy,role&filter[role][_null]=true`,
  );
  for (const row of access.data) {
    const pid = typeof row.policy === "string" ? row.policy : row.policy.id;
    if (pid) return pid;
  }
  const created = await api<{ data: { id: string } }>("/policies", {
    method: "POST",
    body: JSON.stringify({ name: "Public", icon: "public", description: "Public policy" }),
  });
  await api("/access", {
    method: "POST",
    body: JSON.stringify({ role: null, policy: created.data.id }),
  });
  return created.data.id;
}

type PermRow = {
  policy: string;
  collection: string;
  action: "read" | "create" | "update" | "delete";
  fields?: string[];
  permissions?: Record<string, unknown>;
  validation?: Record<string, unknown>;
};

async function upsertPermission(row: PermRow): Promise<void> {
  const filter =
    `filter[policy][_eq]=${encodeURIComponent(row.policy)}` +
    `&filter[collection][_eq]=${encodeURIComponent(row.collection)}` +
    `&filter[action][_eq]=${encodeURIComponent(row.action)}`;
  try {
    const r = await api<{ data: Array<{ id: string }> }>(
      `/permissions?limit=1&fields=id&${filter}`,
    );
    if (r.data[0]) {
      await api(`/permissions/${r.data[0].id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fields: row.fields ?? ["*"],
          permissions: row.permissions ?? {},
          validation: row.validation ?? {},
        }),
      });
      console.log(`   ~ updated ${row.collection}.${row.action}`);
      return;
    }
  } catch {
    /* fall through to POST */
  }
  await api("/permissions", {
    method: "POST",
    body: JSON.stringify({
      policy: row.policy,
      collection: row.collection,
      action: row.action,
      fields: row.fields ?? ["*"],
      permissions: row.permissions ?? {},
      validation: row.validation ?? {},
    }),
  });
  console.log(`   + created ${row.collection}.${row.action}`);
}

async function main() {
  console.log(`🔧 Public reupload-page permissions patch on ${URL_BASE}`);
  const publicPolicy = await ensurePublicPolicy();
  console.log(`   = Public policy id: ${publicPolicy}`);

  // Read the request itself (the reupload page looks it up by id/uuid).
  await upsertPermission({
    policy: publicPolicy,
    collection: "requests",
    action: "read",
    fields: [
      "id",
      "uuid",
      "status",
      "customer_name",
      "customer_email",
      "customer_phone",
      "agent",
      "origin_agent",
      "branch",
      "assigned_at",
      "date_created",
    ],
  });

  // Update only the status, and only to "processing" (after a successful
  // customer reupload). Cannot mutate any other field.
  await upsertPermission({
    policy: publicPolicy,
    collection: "requests",
    action: "update",
    fields: ["status"],
    validation: { status: { _eq: "processing" } },
  });

  // Read notes so the page can show what the agent asked for.
  await upsertPermission({
    policy: publicPolicy,
    collection: "request_notes",
    action: "read",
    fields: [
      "id",
      "request",
      "text",
      "kind",
      "author_role",
      "date_created",
      "resolved_at",
      "resolved_by",
    ],
  });

  // Mark a missing note resolved (only the resolved_at field).
  await upsertPermission({
    policy: publicPolicy,
    collection: "request_notes",
    action: "update",
    fields: ["resolved_at"],
  });

  // Read existing file rows so the page can display what's already attached.
  await upsertPermission({
    policy: publicPolicy,
    collection: "request_files",
    action: "read",
    fields: ["id", "request", "kind", "file", "uploaded_at", "uploaded_by"],
  });

  console.log("\n✅ Done.");
  console.log("   • Public /r/:requestId page can read the request + missing notes,");
  console.log("     upload attachments, resolve those notes, and flip status to processing.");
}

main().catch((err) => {
  console.error("💥 Patch failed:", err);
  process.exit(1);
});