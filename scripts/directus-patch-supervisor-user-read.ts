/**
 * One-off patch: ensure the Supervisor policy can read directus_users in the
 * supervisor's own branch. Without this, /agents shows empty tabs because
 * the bootstrap permission filter was never applied or was overwritten.
 *
 * Sets Supervisor → directus_users.read with:
 *   fields = the app fields we display in /agents
 *   permissions = branch = $CURRENT_USER.branch
 *
 * Idempotent. Re-run safely.
 *
 * Usage on Al Diplomacy:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=<admin_token> \
 *   npx tsx scripts/directus-patch-supervisor-user-read.ts
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

async function findPolicyId(roleName: string): Promise<string> {
  const names = [`App ${roleName} Policy`, `${roleName} Policy`];
  const r = await api<{ data: Policy[] }>(
    `/policies?fields=id,name&limit=-1&filter[name][_in]=${encodeURIComponent(names.join(","))}`,
  );
  const found = r.data.find((p) => names.includes(p.name));
  if (!found) throw new Error(`Policy not found for ${roleName}`);
  return found.id;
}

async function upsertPermission(
  policy: string,
  collection: string,
  action: string,
  patch: { fields?: string[]; permissions?: unknown; validation?: unknown },
) {
  const rows = await api<{ data: Permission[] }>(
    `/permissions?fields=id&limit=-1&filter[policy][_eq]=${encodeURIComponent(policy)}&filter[collection][_eq]=${encodeURIComponent(collection)}&filter[action][_eq]=${encodeURIComponent(action)}`,
  ).catch(() => ({ data: [] as Permission[] }));
  if (rows.data.length) {
    for (const row of rows.data) {
      await api(`/permissions/${row.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    }
    return "updated";
  }
  await api(`/permissions`, {
    method: "POST",
    body: JSON.stringify({ policy, collection, action, fields: ["*"], permissions: {}, validation: {}, ...patch }),
  });
  return "created";
}

async function main() {
  console.log("🔐 Patching Supervisor → directus_users.read (branch-scoped)…");
  const supervisorPolicy = await findPolicyId("Supervisor");

  const supervisorReadFields = [
    "id", "first_name", "last_name", "email",
    "app_role", "staff_type", "branch", "agent_code",
    "supervisor", "assigned_underwriter", "assigned_underwriter_code",
    "pending_approval", "app_active", "app_created_by_role",
    "app_removal_reason", "app_removal_requested_by", "app_removal_requested_at",
  ];

  const result = await upsertPermission(supervisorPolicy, "directus_users", "read", {
    fields: supervisorReadFields,
    permissions: { branch: { _eq: "$CURRENT_USER.branch" } },
  });
  console.log(`   ${result} Supervisor → directus_users.read`);

  // Make sure branches are readable too so the AgentFormDialog branch select
  // can render — supervisors should at least see their own branch.
  const branchRead = await upsertPermission(supervisorPolicy, "branches", "read", {
    fields: ["*"],
    permissions: {},
  });
  console.log(`   ${branchRead} Supervisor → branches.read`);

  console.log("✅ Done. Refresh /agents in the browser.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});