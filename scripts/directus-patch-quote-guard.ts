/**
 * One-off patch: fixes the existing `lovable: quote_kind_guard` flow on the
 * live Directus so that uploads with kind != "quote" are NOT blocked.
 *
 * Symptom this fixes:
 *   POST /items/request_files → 400  "$trigger.payload.kind" is required
 *
 * Cause:
 *   The flow's `is_quote` condition op had no `reject` branch, so any payload
 *   where kind !== "quote" caused the filter flow to fail and block the create.
 *
 * Fix:
 *   Add a no-op `passthrough` exec op and wire `is_quote.reject` → passthrough.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN= \
 *   npx tsx scripts/directus-patch-quote-guard.ts
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

async function main() {
  console.log(`🔧 Patching quote_kind_guard on ${URL_BASE}`);
  const flows = await api<{ data: Array<{ id: string; name: string; operation: string }> }>(
    "/flows?limit=-1&fields=id,name,operation",
  );
  const flow = flows.data.find((f) => f.name === "lovable: quote_kind_guard");
  if (!flow) {
    console.error("Flow not found. Run scripts/directus-bootstrap.ts first.");
    process.exit(1);
  }
  const ops = await api<{
    data: Array<{ id: string; key: string; resolve: string | null; reject: string | null; flow: string }>;
  }>(`/operations?limit=-1&filter[flow][_eq]=${flow.id}&fields=id,key,resolve,reject,flow`);

  const isQuote = ops.data.find((o) => o.key === "is_quote");
  if (!isQuote) {
    console.error("is_quote op not found.");
    process.exit(1);
  }

  let passthrough = ops.data.find((o) => o.key === "passthrough");
  if (!passthrough) {
    console.log("   + creating passthrough op");
    const created = await api<{ data: { id: string; key: string; resolve: string | null; reject: string | null; flow: string } }>(
      "/operations",
      {
        method: "POST",
        body: JSON.stringify({
          flow: flow.id,
          key: "passthrough",
          name: "Allow non-quote uploads",
          type: "exec",
          options: { code: "module.exports = async function() { return {}; };" },
          position_x: 20,
          position_y: 220,
        }),
      },
    );
    passthrough = created.data;
  } else {
    console.log("   = passthrough op exists");
  }

  if (isQuote.reject === passthrough.id) {
    console.log("   = is_quote.reject already wired");
  } else {
    console.log("   ~ wiring is_quote.reject → passthrough");
    await api(`/operations/${isQuote.id}`, {
      method: "PATCH",
      body: JSON.stringify({ reject: passthrough.id }),
    });
  }

  console.log("✅ Done. Public uploads with kind != 'quote' will now pass through.");
}

main().catch((err) => {
  console.error("💥 Patch failed:", err);
  process.exit(1);
});