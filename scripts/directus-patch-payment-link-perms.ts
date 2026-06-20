/**
 * Ensures Agent (sales + underwriter), Supervisor and Admin policies can
 * UPDATE the payment-link fields on the `requests` collection.
 *
 * Earlier patches (notably directus-patch-requests-assigned-underwriter.ts)
 * overwrote the Agent.update field whitelist and dropped
 *   payment_link, payment_message, payment_link_sent_at,
 *   quote_confirmed, quote_confirmed_at, selected_quote, client_type
 * which causes a 403 when an underwriter (or sales agent) tries to send the
 * payment link after the customer confirms the quote.
 *
 * This script merges the missing fields back into each policy's update
 * permission while leaving its `permissions` predicate untouched.
 *
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=<admin_token> \
 *   npx tsx scripts/directus-patch-payment-link-perms.ts
 */

const URL_BASE = (process.env.DIRECTUS_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN ?? "";

if (!URL_BASE || !TOKEN) {
  console.error("Missing DIRECTUS_URL or DIRECTUS_ADMIN_TOKEN env vars.");
  process.exit(1);
}

const PAYMENT_FIELDS = [
  "status",
  "payment_link",
  "payment_message",
  "payment_link_sent_at",
  "quote_confirmed",
  "quote_confirmed_at",
  "selected_quote",
  "client_type",
];

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

type Policy = { id: string; name: string };
type Permission = { id: number | string; fields?: string[] | null };

async function findPolicyId(roleName: "Admin" | "Supervisor" | "Agent"): Promise<string | null> {
  const names = [`App ${roleName} Policy`, `${roleName} Policy`];
  const r = await api<{ data: Policy[] }>(
    `/policies?fields=id,name&limit=-1&filter[name][_in]=${encodeURIComponent(names.join(","))}`,
  );
  const found = r.data.find((p) => names.includes(p.name));
  return found?.id ?? null;
}

async function mergeUpdateFields(policy: string, label: string) {
  const rows = await api<{ data: Permission[] }>(
    `/permissions?fields=id,fields&limit=-1&filter[policy][_eq]=${encodeURIComponent(policy)}&filter[collection][_eq]=requests&filter[action][_eq]=update`,
  ).catch(() => ({ data: [] as Permission[] }));
  if (rows.data.length === 0) {
    console.log(`   - ${label}: no requests.update permission row — skipped`);
    return;
  }
  for (const row of rows.data) {
    const current = Array.isArray(row.fields) ? row.fields : [];
    if (current.includes("*")) {
      console.log(`   = ${label}: already has wildcard (*)`);
      continue;
    }
    const merged = Array.from(new Set([...current, ...PAYMENT_FIELDS]));
    if (merged.length === current.length) {
      console.log(`   = ${label}: payment fields already present`);
      continue;
    }
    await api(`/permissions/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: merged }),
    });
    const added = merged.filter((f) => !current.includes(f));
    console.log(`   ~ ${label}: merged fields → +${added.join(", ")}`);
  }
}

(async () => {
  console.log(`🔧 Patching requests.update payment fields on ${URL_BASE}`);
  for (const role of ["Admin", "Supervisor", "Agent"] as const) {
    const id = await findPolicyId(role);
    if (!id) {
      console.log(`   - ${role}: policy not found — skipped`);
      continue;
    }
    await mergeUpdateFields(id, role);
  }
  console.log("\n✅ Done. Underwriter / Sales / Supervisor / Admin can now send payment links.");
})().catch((e) => {
  console.error("❌ Patch failed:", e);
  process.exit(1);
});