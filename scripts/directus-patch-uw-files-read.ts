/**
 * Patch: allow Underwriters (agent role, staff_type=underwriter) to
 * continue reading request_files and request_notes after a request is
 * handed back to sales.
 *
 * Symptom before the patch: after the underwriter uploads a quote and
 * the request is reassigned back to the sales agent, the underwriter
 * still sees the request listed (because the requests.read policy
 * already includes assigned_underwriter) but the Document Records
 * section is empty — request_files.read and request_notes.read only
 * matched agent / origin_agent.
 *
 * Idempotent.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=... \
 *   npx tsx scripts/directus-patch-uw-files-read.ts
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

type Policy = { id: string; name: string };
type Permission = { id: number | string };

async function findAgentPolicy(): Promise<string> {
  const names = ["App Agent Policy", "Agent Policy"];
  const r = await api<{ data: Policy[] }>(
    `/policies?fields=id,name&limit=-1&filter[name][_in]=${encodeURIComponent(names.join(","))}`,
  );
  const found = r.data.find((p) => names.includes(p.name));
  if (!found) throw new Error("Agent policy not found");
  return found.id;
}

const SCOPE = {
  request: {
    _or: [
      { agent: { _eq: "$CURRENT_USER" } },
      { origin_agent: { _eq: "$CURRENT_USER" } },
      { assigned_underwriter: { _eq: "$CURRENT_USER" } },
    ],
  },
};

async function upsert(policy: string, collection: string) {
  const rows = await api<{ data: Permission[] }>(
    `/permissions?fields=id&limit=-1&filter[policy][_eq]=${encodeURIComponent(policy)}&filter[collection][_eq]=${encodeURIComponent(collection)}&filter[action][_eq]=read`,
  ).catch(() => ({ data: [] as Permission[] }));

  const body = { fields: ["*"], permissions: SCOPE, validation: {} };
  if (rows.data.length) {
    for (const row of rows.data) {
      await api(`/permissions/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
    }
    return "updated";
  }
  await api(`/permissions`, {
    method: "POST",
    body: JSON.stringify({ policy, collection, action: "read", ...body }),
  });
  return "created";
}

async function main() {
  console.log("🔐 Patching Agent → request_files/request_notes read scope…");
  const policy = await findAgentPolicy();
  console.log(`   ${await upsert(policy, "request_files")} Agent → request_files.read`);
  console.log(`   ${await upsert(policy, "request_notes")} Agent → request_notes.read`);
  console.log("✅ Done. Underwriters can now read files/notes for requests where they are assigned_underwriter.");
}

main().catch((e) => {
  console.error("Patch failed:", e);
  process.exit(1);
});