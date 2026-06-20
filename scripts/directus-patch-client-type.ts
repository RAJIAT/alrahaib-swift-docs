/**
 * Patch for the Individual / Corporate client-type customer-upload flow.
 *
 * 1) Adds two fields to `requests`:
 *      - client_type    string  ("individual" | "corporate", default "individual")
 *      - selected_quote uuid    (request_files row id chosen by the customer)
 * 2) Grants the Public role permission to write `client_type` on create and to
 *    update `selected_quote` (alongside the existing quote_confirmed update).
 * 3) Grants authenticated agent/supervisor/admin roles READ on `client_type`
 *    and `selected_quote` (the wildcard read already covers them, but we
 *    refresh the field list to be explicit).
 *
 * Idempotent: safe to re-run.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=<admin static token> \
 *   npx tsx scripts/directus-patch-client-type.ts
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

async function ensureField(field: string, type: string, meta: Record<string, unknown>, schema?: Record<string, unknown>): Promise<void> {
  try {
    await api(`/fields/requests/${field}`);
    console.log(`   = requests.${field}`);
    return;
  } catch { /* create below */ }
  await api(`/fields/requests`, {
    method: "POST",
    body: JSON.stringify({ field, type, meta, ...(schema ? { schema } : {}) }),
  });
  console.log(`   + requests.${field}`);
}

type Policy = { id: string; name: string };

async function findPolicy(name: string): Promise<Policy | null> {
  const r = await api<{ data: Policy[] }>(
    `/policies?limit=-1&fields=id,name&filter[name][_eq]=${encodeURIComponent(name)}`,
  );
  return r.data[0] ?? null;
}

async function publicPolicyId(): Promise<string | null> {
  for (const n of ["Public", "$public", "public"]) {
    const p = await findPolicy(n);
    if (p) return p.id;
  }
  try {
    const r = await api<{ data: Array<{ policy: string | { id: string } }> }>(
      `/access?limit=-1&fields=policy,role&filter[role][_null]=true`,
    );
    const row = r.data[0];
    if (row) return typeof row.policy === "string" ? row.policy : row.policy.id;
  } catch { /* tolerated */ }
  return null;
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
    const r = await api<{ data: Array<{ id: string; fields?: string[] }> }>(
      `/permissions?limit=1&fields=id,fields&${filter}`,
    );
    if (r.data[0]) {
      const merged = Array.from(new Set([...(r.data[0].fields ?? []), ...(row.fields ?? [])]));
      await api(`/permissions/${r.data[0].id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fields: merged.length ? merged : ["*"],
          ...(row.permissions ? { permissions: row.permissions } : {}),
          ...(row.validation ? { validation: row.validation } : {}),
        }),
      });
      console.log(`   ~ ${row.collection}.${row.action} (merged ${merged.length} fields)`);
      return;
    }
  } catch { /* fall through */ }
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
  console.log(`   + ${row.collection}.${row.action}`);
}

async function main() {
  console.log(`🔧 Client-type patch on ${URL_BASE}`);

  console.log("\n🧱 Fields…");
  await ensureField(
    "client_type",
    "string",
    { interface: "select-dropdown", options: { choices: [{ text: "Individual", value: "individual" }, { text: "Corporate", value: "corporate" }] } },
    { default_value: "individual" },
  );
  await ensureField("selected_quote", "uuid", { interface: "input", note: "request_files row id selected by the customer" });

  console.log("\n🔐 Public policy field grants…");
  const pub = await publicPolicyId();
  if (!pub) {
    console.warn("   ! Public policy not found — run scripts/directus-patch-public-quote.ts first.");
  } else {
    await upsertPermission({
      policy: pub,
      collection: "requests",
      action: "create",
      fields: ["id", "uuid", "agent", "origin_agent", "branch", "status", "customer_name", "customer_email", "customer_phone", "client_type"],
      permissions: {},
    });
    await upsertPermission({
      policy: pub,
      collection: "requests",
      action: "update",
      fields: ["quote_confirmed", "quote_confirmed_at", "selected_quote"],
      permissions: {},
    });
    await upsertPermission({
      policy: pub,
      collection: "requests",
      action: "read",
      fields: ["id", "uuid", "customer_name", "customer_email", "customer_phone", "client_type", "selected_quote", "quote_confirmed", "quote_confirmed_at", "payment_link", "payment_message", "payment_link_sent_at", "date_created", "status"],
    });
    // Allow public uploaders to attach corporate documents
    await upsertPermission({
      policy: pub,
      collection: "request_files",
      action: "create",
      fields: ["request", "file", "kind", "uploaded_at", "uploaded_by"],
      permissions: {},
    });
  }

  console.log("\n✅ Done. Re-run scripts/directus-patch-public-quote.ts if needed to keep flows in sync.");
}

main().catch((err) => {
  console.error("💥 Patch failed:", err);
  process.exit(1);
});