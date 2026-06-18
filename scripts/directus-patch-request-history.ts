/**
 * One-off patch: make the per-request "Request History" timeline actually
 * readable for Agents/Supervisors, and let anonymous (Public) customer
 * uploads write their `request.created` audit entry.
 *
 * Without this patch:
 *   - Agents see "No events recorded yet" because the `Agent` policy has
 *     NO read on `audit_log`.
 *   - Supervisors only see entries whose `actor_branch` matches their own
 *     branch — anonymous customer uploads (actor_branch=null) are hidden.
 *   - Anonymous customer uploads silently fail to write `request.created`
 *     because the `Public` policy has no `audit_log.create` permission.
 *
 * Grants (idempotent):
 *   - Public.audit_log.create     fields: action, entity_type, entity_id,
 *                                 entity_label, branch, before, after, meta,
 *                                 actor, actor_role, actor_branch
 *                                 validation: entity_type _eq "request"
 *   - Agent.audit_log.read        fields: *
 *                                 permissions: entity_type _eq "request"
 *   - Supervisor.audit_log.read   fields: *
 *                                 permissions: entity_type _eq "request"
 *     (replaces the actor_branch-only filter so transfers + customer events
 *      both show up for branch supervisors)
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=<admin_token> \
 *   npx tsx scripts/directus-patch-request-history.ts
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

async function findPolicyId(name: string): Promise<string | null> {
  const r = await api<{ data: Array<{ id: string }> }>(
    `/policies?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`,
  );
  return r.data?.[0]?.id ?? null;
}

async function findPublicPolicyId(): Promise<string> {
  const access = await api<{ data: Array<{ policy: string | { id: string } }> }>(
    `/access?limit=-1&fields=id,policy,role&filter[role][_null]=true`,
  );
  for (const row of access.data) {
    const pid = typeof row.policy === "string" ? row.policy : row.policy.id;
    if (pid) return pid;
  }
  throw new Error("Public policy not found; run scripts/directus-patch-public-upload.ts first");
}

type PermRow = {
  policy: string;
  collection: string;
  action: "read" | "create" | "update" | "delete";
  fields?: string[];
  permissions?: Record<string, unknown>;
  validation?: Record<string, unknown>;
};

async function upsertPermission(label: string, row: PermRow): Promise<void> {
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
      console.log(`   ~ updated ${label} → ${row.collection}.${row.action}`);
      return;
    }
  } catch { /* fall through to POST */ }
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
    console.log(`   + created ${label} → ${row.collection}.${row.action}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/duplicate|already exists|RecordNotUnique|409/i.test(msg)) {
      console.log(`   = ${label} → ${row.collection}.${row.action} (exists)`);
    } else {
      console.warn(`   ! ${label} → ${row.collection}.${row.action} failed: ${msg.split("\n")[0]}`);
    }
  }
}

async function main() {
  console.log(`🔧 Request-history audit permissions patch on ${URL_BASE}`);

  const publicPolicy = await findPublicPolicyId();
  const agentPolicy = await findPolicyId("Agent");
  const supervisorPolicy = await findPolicyId("Supervisor");

  // Public: allow anonymous customer upload to write request.created event.
  await upsertPermission("Public", {
    policy: publicPolicy,
    collection: "audit_log",
    action: "create",
    fields: [
      "action",
      "entity_type",
      "entity_id",
      "entity_label",
      "branch",
      "before",
      "after",
      "meta",
      "actor",
      "actor_role",
      "actor_branch",
    ],
    validation: { entity_type: { _eq: "request" } },
  });

  // Agent: read request-scoped audit entries (so Request History works).
  if (agentPolicy) {
    await upsertPermission("Agent", {
      policy: agentPolicy,
      collection: "audit_log",
      action: "read",
      fields: ["*"],
      permissions: { entity_type: { _eq: "request" } },
    });
  } else {
    console.warn("   ! Agent policy not found — skipped");
  }

  // Supervisor: broaden read so anonymous/customer events also appear.
  if (supervisorPolicy) {
    await upsertPermission("Supervisor", {
      policy: supervisorPolicy,
      collection: "audit_log",
      action: "read",
      fields: ["*"],
      permissions: { entity_type: { _eq: "request" } },
    });
  } else {
    console.warn("   ! Supervisor policy not found — skipped");
  }

  console.log("\n✅ Done.");
  console.log("   • Request History now records customer uploads.");
  console.log("   • Agents and Supervisors can read request-scoped events.");
}

main().catch((err) => {
  console.error("💥 Patch failed:", err);
  process.exit(1);
});
