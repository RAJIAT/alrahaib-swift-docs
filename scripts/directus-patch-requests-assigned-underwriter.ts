/**
 * Adds a sticky `assigned_underwriter` (m2o → directus_users) column on the
 * `requests` collection and widens the Agent role's read/update permissions
 * to match. This is what gives underwriters visibility on requests they
 * handled even after the request is auto-returned to the originating sales
 * agent (quote uploaded, payment link sent, sold, etc.).
 *
 * Idempotent: safe to re-run. Existing column / permissions are patched
 * rather than recreated.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=... \
 *   npx tsx scripts/directus-patch-requests-assigned-underwriter.ts
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
type Permission = {
  id: number | string;
  policy: string;
  collection: string;
  action: string;
  fields?: string[] | null;
};
type FieldRow = { field: string };

async function fieldExists(collection: string, field: string): Promise<boolean> {
  try {
    const r = await api<{ data: FieldRow }>(
      `/fields/${encodeURIComponent(collection)}/${encodeURIComponent(field)}`,
    );
    return !!r?.data?.field;
  } catch {
    return false;
  }
}

async function ensureAssignedUnderwriterField() {
  const exists = await fieldExists("requests", "assigned_underwriter");
  if (exists) {
    console.log("   = requests.assigned_underwriter already exists");
    return;
  }
  await api("/fields/requests", {
    method: "POST",
    body: JSON.stringify({
      field: "assigned_underwriter",
      type: "uuid",
      schema: { is_nullable: true },
      meta: {
        interface: "select-dropdown-m2o",
        special: ["m2o"],
        options: { template: "{{first_name}} {{last_name}} ({{agent_code}})" },
      },
    }),
  });
  await api("/relations", {
    method: "POST",
    body: JSON.stringify({
      collection: "requests",
      field: "assigned_underwriter",
      related_collection: "directus_users",
      schema: { on_delete: "SET NULL" },
    }),
  });
  console.log("   + created requests.assigned_underwriter (m2o → directus_users)");
}

async function findPolicyId(roleName: "Supervisor" | "Agent"): Promise<string> {
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
  patch: Partial<Permission> & { permissions?: unknown; validation?: unknown },
) {
  const rows = await api<{ data: Permission[] }>(
    `/permissions?fields=id,policy,collection,action,fields&limit=-1&filter[policy][_eq]=${encodeURIComponent(policy)}&filter[collection][_eq]=${encodeURIComponent(collection)}&filter[action][_eq]=${encodeURIComponent(action)}`,
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

async function patchPermissions() {
  const agentPolicy = await findPolicyId("Agent");
  const supervisorPolicy = await findPolicyId("Supervisor");

  console.log(
    `   ${await upsertPermission(agentPolicy, "requests", "read", {
      fields: ["*"],
      permissions: {
        _or: [
          { agent: { _eq: "$CURRENT_USER" } },
          { origin_agent: { _eq: "$CURRENT_USER" } },
          { assigned_underwriter: { _eq: "$CURRENT_USER" } },
        ],
      },
    })} Agent → requests.read (includes assigned_underwriter)`,
  );

  console.log(
    `   ${await upsertPermission(agentPolicy, "requests", "update", {
      fields: [
        "status",
        "customer_name",
        "customer_email",
        "customer_phone",
        "agent",
        "origin_agent",
        "assigned_underwriter",
        "assigned_at",
      ],
      permissions: {
        _or: [
          { agent: { _eq: "$CURRENT_USER" } },
          { origin_agent: { _eq: "$CURRENT_USER" } },
          { assigned_underwriter: { _eq: "$CURRENT_USER" } },
        ],
      },
    })} Agent → requests.update (includes assigned_underwriter)`,
  );

  console.log(
    `   ${await upsertPermission(supervisorPolicy, "requests", "update", {
      fields: ["agent", "assigned_underwriter", "status", "customer_name", "customer_email", "customer_phone", "assigned_at"],
      permissions: { branch: { _eq: "$CURRENT_USER.branch" } },
    })} Supervisor → requests.update (includes assigned_underwriter)`,
  );
}

(async () => {
  console.log(`🔧 Patching requests.assigned_underwriter on ${URL_BASE}`);
  console.log("📐 Ensuring field…");
  await ensureAssignedUnderwriterField();
  console.log("🔐 Patching permissions…");
  await patchPermissions();
  console.log("\n✅ Done. Underwriters will see all requests they're assigned to once the field is populated on existing rows.");
})().catch((e) => {
  console.error("❌ Patch failed:", e);
  process.exit(1);
});