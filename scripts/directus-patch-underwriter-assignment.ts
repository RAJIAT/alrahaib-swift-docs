/**
 * One-off patch for underwriter assignment + request status failures.
 *
 * Fixes:
 * - Agent status buttons failing with: no permission to access
 *   directus_users.assigned_underwriter.
 * - Supervisor unable to view/change a sales agent's assigned underwriter.
 * - Existing sales routing guard running on every request update instead of
 *   only when requests.agent is changed.
 *
 * Idempotent: re-running updates existing permission rows and recreates only
 * the `lovable: enforce_sales_routing` flow.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN= \
 *   npx tsx scripts/directus-patch-underwriter-assignment.ts
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
type OpDef = {
  key: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
  rejectKey?: string;
};

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
    body: JSON.stringify({
      policy,
      collection,
      action,
      fields: ["*"],
      permissions: {},
      validation: {},
      ...patch,
    }),
  });
  return "created";
}

async function patchPermissions() {
  console.log("🔐 Patching Directus permissions…");
  const supervisorPolicy = await findPolicyId("Supervisor");
  const agentPolicy = await findPolicyId("Agent");

  const supervisorReadFields = [
    "id",
    "first_name",
    "last_name",
    "email",
    "app_role",
    "staff_type",
    "branch",
    "agent_code",
    "supervisor",
    "assigned_underwriter",
    "assigned_underwriter_code",
    "pending_approval",
    "app_active",
    "app_created_by_role",
    "app_removal_reason",
    "app_removal_requested_by",
    "app_removal_requested_at",
  ];
  const supervisorWriteFields = [
    "first_name",
    "last_name",
    "email",
    "password",
    "role",
    "status",
    "app_role",
    "staff_type",
    "branch",
    "agent_code",
    "supervisor",
    "assigned_underwriter",
    "assigned_underwriter_code",
    "pending_approval",
    "app_active",
    "app_created_by_role",
    "app_removal_reason",
    "app_removal_requested_by",
    "app_removal_requested_at",
  ];
  const agentReadFields = [
    "id",
    "first_name",
    "last_name",
    "agent_code",
    "app_role",
    "staff_type",
    "branch",
    "assigned_underwriter",
    "assigned_underwriter_code",
    "app_active",
  ];

  console.log(
    `   ${await upsertPermission(supervisorPolicy, "directus_users", "read", { fields: supervisorReadFields })} Supervisor → directus_users.read`,
  );
  console.log(
    `   ${await upsertPermission(supervisorPolicy, "directus_users", "create", { fields: supervisorWriteFields })} Supervisor → directus_users.create`,
  );
  console.log(
    `   ${await upsertPermission(supervisorPolicy, "directus_users", "update", { fields: supervisorWriteFields })} Supervisor → directus_users.update`,
  );
  console.log(
    `   ${await upsertPermission(agentPolicy, "directus_users", "read", { fields: agentReadFields })} Agent → directus_users.read`,
  );
  console.log(
    `   ${await upsertPermission(agentPolicy, "requests", "read", {
      fields: ["*"],
      permissions: {
        _or: [
          { agent: { _eq: "$CURRENT_USER" } },
          { origin_agent: { _eq: "$CURRENT_USER" } },
        ],
      },
    })} Agent → requests.read`,
  );
}

async function deleteFlowIfExists(name: string): Promise<void> {
  const existing = await api<{ data: Array<{ id: string; name: string }> }>(
    `/flows?limit=-1&fields=id,name&filter[name][_eq]=${encodeURIComponent(name)}`,
  );
  for (const f of existing.data) {
    const ops = await api<{ data: Array<{ id: string }> }>(
      `/operations?limit=-1&fields=id&filter[flow][_eq]=${f.id}`,
    );
    try {
      await api(`/flows/${f.id}`, { method: "PATCH", body: JSON.stringify({ operation: null }) });
    } catch {
      // Already unset or flow is partially deleted.
    }
    if (ops.data.length) {
      await api(`/operations`, {
        method: "DELETE",
        body: JSON.stringify(ops.data.map((o) => o.id)),
      });
    }
    await api(`/flows/${f.id}`, { method: "DELETE" });
    console.log(`   - removed existing "${name}"`);
  }
}

async function recreateSalesRoutingFlow() {
  console.log("⚡ Recreating sales routing guard…");
  const operations: OpDef[] = [
    {
      key: "agent_changed",
      name: "Agent field changed?",
      type: "condition",
      options: { filter: { "$trigger.payload.agent": { _nnull: true } } },
      rejectKey: "passthrough",
    },
    {
      key: "read_me",
      name: "Read current user",
      type: "item-read",
      options: {
        collection: "directus_users",
        key: "{{$accountability.user}}",
        query: {
          fields: ["id", "app_role", "staff_type", "assigned_underwriter", "assigned_underwriter_code"],
        },
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
      options: { code: "module.exports = async function() { return {}; };" },
    },
  ];

  await deleteFlowIfExists("lovable: enforce_sales_routing");
  const created = await api<{ data: { id: string } }>("/flows", {
    method: "POST",
    body: JSON.stringify({
      name: "lovable: enforce_sales_routing",
      icon: "policy",
      color: "#E74C3C",
      description: "Sales staff can only reassign to their assigned underwriter.",
      status: "active",
      trigger: "event",
      accountability: "all",
      options: { type: "filter", scope: ["items.update"], collections: ["requests"] },
    }),
  });
  const flowId = created.data.id;
  const opIds: string[] = [];
  const opKeyToId: Record<string, string> = {};
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const r = await api<{ data: { id: string } }>("/operations", {
      method: "POST",
      body: JSON.stringify({
        flow: flowId,
        key: op.key,
        name: op.name,
        type: op.type,
        options: op.options,
        position_x: 20 + i * 220,
        position_y: 20,
      }),
    });
    opIds.push(r.data.id);
    opKeyToId[op.key] = r.data.id;
  }
  const rejectTargets = new Set(operations.map((o) => o.rejectKey).filter((k): k is string => !!k));
  for (let i = 0; i < operations.length - 1; i++) {
    if (rejectTargets.has(operations[i + 1].key)) continue;
    await api(`/operations/${opIds[i]}`, {
      method: "PATCH",
      body: JSON.stringify({ resolve: opIds[i + 1] }),
    });
  }
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.rejectKey && opKeyToId[op.rejectKey]) {
      await api(`/operations/${opIds[i]}`, {
        method: "PATCH",
        body: JSON.stringify({ reject: opKeyToId[op.rejectKey] }),
      });
    }
  }
  await api(`/flows/${flowId}`, { method: "PATCH", body: JSON.stringify({ operation: opIds[0] }) });
  console.log(`   + lovable: enforce_sales_routing (${opIds.length} ops)`);
}

async function main() {
  console.log(`🔧 Patching underwriter assignment on ${URL_BASE}`);
  await patchPermissions();
  await recreateSalesRoutingFlow();
  console.log(
    "\n✅ Done. Status buttons and assigned-underwriter management should work after users refresh/re-login.",
  );
}

main().catch((e) => {
  console.error("💥 Patch failed:", e);
  process.exit(1);
});