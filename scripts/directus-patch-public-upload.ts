/**
 * One-off patch: allow the **anonymous Public** role to submit a request
 * via the customer upload page (`/?agent=<sales-agent-id-or-code>`).
 *
 * Without this patch, the public upload page fails with:
 *   "You don't have permission to "create" from collection "requests" or it does not exist."
 *
 * Grants on the Public policy (idempotent):
 *   - directus_users.read    fields whitelist used by dxResolveUploadAgent
 *                            (id, first_name, last_name, agent_code, app_role,
 *                             staff_type, branch, app_active)
 *                            permissions: app_role _eq "agent" AND app_active _eq true
 *   - branches.read          (id, code, name_en, name_ar) so the cache warmup works
 *   - requests.create        fields whitelist (id, status, customer_name,
 *                            customer_email, customer_phone, agent,
 *                            origin_agent, branch)
 *                            validation: status _eq "new"
 *   - directus_files.create  needed for /files multipart upload
 *   - directus_files.read    (id, filename_download, type, filesize) so the
 *                            response can be parsed
 *   - request_files.create   fields whitelist (id, request, kind, file,
 *                            uploaded_at, uploaded_by)
 *
 * After this patch the existing `customer_upload_status` and
 * `customer_upload_notify` flows (run with accountability "null") flip the
 * status to `processing` and notify the sales agent. Public users cannot
 * read or list other requests — only create one and the files attached to it.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=<admin_token> \
 *   npx tsx scripts/directus-patch-public-upload.ts
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
  // The Public policy in Directus 11 is linked to role=null via /access.
  const access = await api<{ data: Array<{ policy: string | { id: string } }> }>(
    `/access?limit=-1&fields=id,policy,role&filter[role][_null]=true`,
  );
  for (const row of access.data) {
    const pid = typeof row.policy === "string" ? row.policy : row.policy.id;
    if (pid) return pid;
  }
  // Create one if it doesn't exist.
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
  try {
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
  } catch (e) {
    const msg = (e as Error).message;
    if (/duplicate|already exists|RecordNotUnique|409|unique constraint/i.test(msg)) {
      console.log(`   = ${row.collection}.${row.action} (exists)`);
    } else {
      throw e;
    }
  }
}

async function main() {
  console.log(`🔧 Public customer-upload permissions patch on ${URL_BASE}`);
  const publicPolicy = await ensurePublicPolicy();
  console.log(`   = Public policy id: ${publicPolicy}`);

  // Agent resolution (dxResolveUploadAgent) — only active sales/underwriter
  // user records are exposed to anonymous lookups.
  await upsertPermission({
    policy: publicPolicy,
    collection: "directus_users",
    action: "read",
    fields: ["id", "first_name", "last_name", "agent_code", "app_role", "staff_type", "branch", "app_active"],
    permissions: {
      _and: [
        { app_role: { _eq: "agent" } },
        { app_active: { _eq: true } },
      ],
    },
  });

  // Branch cache warmup.
  await upsertPermission({
    policy: publicPolicy,
    collection: "branches",
    action: "read",
    fields: ["id", "code", "name_en", "name_ar"],
  });

  // Create the request itself. Field whitelist + status validation ensure
  // the public caller cannot set arbitrary status or extra columns.
  await upsertPermission({
    policy: publicPolicy,
    collection: "requests",
    action: "create",
    fields: [
      "id",
      "status",
      "customer_name",
      "customer_email",
      "customer_phone",
      "agent",
      "origin_agent",
      "branch",
    ],
    validation: { status: { _eq: "new" } },
  });

  // File upload + file metadata read (Directus returns the row on POST /files).
  await upsertPermission({
    policy: publicPolicy,
    collection: "directus_files",
    action: "create",
  });
  await upsertPermission({
    policy: publicPolicy,
    collection: "directus_files",
    action: "read",
    fields: ["id", "filename_download", "type", "filesize"],
  });

  // Link uploaded files to the just-created request.
  await upsertPermission({
    policy: publicPolicy,
    collection: "request_files",
    action: "create",
    fields: ["id", "request", "kind", "file", "uploaded_at", "uploaded_by"],
  });

  console.log("\n✅ Done.");
  console.log("   • Public upload page can now create a request + upload files.");
  console.log("   • Public users still cannot read, list or modify other requests.");
}

main().catch((err) => {
  console.error("💥 Patch failed:", err);
  process.exit(1);
});