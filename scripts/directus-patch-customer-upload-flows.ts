/**
 * One-off patch: installs (or repairs) the two flows that run when a
 * customer uploads files via the public agent link:
 *
 *   1. lovable: customer_upload_status
 *      Trigger: items.create on request_files (action)
 *      Effect:  parent request status "new" → "processing"
 *
 *   2. lovable: customer_upload_notify
 *      Trigger: items.create on request_files (action)
 *      Effect:  inserts notifications for owner agent (+ origin sales agent)
 *               with title "New documents uploaded for request REQ-xxxx".
 *
 * Both flows ignore kind="quote" (those are underwriter uploads).
 * Both run with accountability: "null" so they bypass the public role's
 * lack of write permission on `requests` and `notifications`.
 *
 * Idempotent: re-running deletes the existing flow + its ops and recreates
 * them so the wiring is always fresh.
 *
 * Usage:
 *   DIRECTUS_URL=https://directus.example.com \
 *   DIRECTUS_ADMIN_TOKEN=xxxxx \
 *   bun run scripts/directus-patch-customer-upload-flows.ts
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

type OpDef = {
  key: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
  rejectKey?: string;
};

type FlowDef = {
  name: string;
  icon: string;
  color: string;
  description: string;
  status: string;
  trigger: string;
  accountability: string;
  options: Record<string, unknown>;
  operations: OpDef[];
};

const FLOWS: FlowDef[] = [
  {
    name: "lovable: customer_upload_status",
    icon: "autorenew",
    color: "#16A085",
    description: "When a customer uploads a file, move parent request from 'new' to 'processing'.",
    status: "active",
    trigger: "event",
    accountability: "null",
    options: { type: "action", scope: ["items.create"], collections: ["request_files"] },
    operations: [
      {
        key: "is_customer_upload",
        name: "Skip quote uploads",
        type: "condition",
        options: { filter: { "$trigger.payload.kind": { _nin: ["quote"] } } },
      },
      {
        key: "read_request",
        name: "Read parent request",
        type: "item-read",
        options: {
          collection: "requests",
          key: "{{$trigger.payload.request}}",
          query: { fields: ["id", "status"] },
        },
      },
      {
        key: "is_new",
        name: "Status is 'new'?",
        type: "condition",
        options: { filter: { "$last.status": { _eq: "new" } } },
      },
      {
        key: "set_processing",
        name: "Set status = processing",
        type: "item-update",
        options: {
          collection: "requests",
          key: "{{read_request.id}}",
          payload: { status: "processing" },
        },
      },
    ],
  },

  {
    name: "lovable: customer_upload_notify",
    icon: "notifications_active",
    color: "#2980B9",
    description: "Create notifications for the owner agent (and origin sales agent) when a customer uploads files.",
    status: "active",
    trigger: "event",
    accountability: "null",
    options: { type: "action", scope: ["items.create"], collections: ["request_files"] },
    operations: [
      {
        key: "is_customer_upload",
        name: "Skip quote uploads",
        type: "condition",
        options: { filter: { "$trigger.payload.kind": { _nin: ["quote"] } } },
      },
      {
        key: "read_request",
        name: "Read parent request",
        type: "item-read",
        options: {
          collection: "requests",
          key: "{{$trigger.payload.request}}",
          query: { fields: ["id", "agent", "origin_agent"] },
        },
      },
      {
        key: "build_items",
        name: "Build notification rows",
        type: "exec",
        options: {
          code:
            "module.exports = async function({ $last }) {" +
            " const req = $last || {};" +
            " const seen = new Set();" +
            " const recipients = [];" +
            " if (req.agent) { seen.add(req.agent); recipients.push(req.agent); }" +
            " if (req.origin_agent && !seen.has(req.origin_agent)) { recipients.push(req.origin_agent); }" +
            " const items = recipients.map(function(uid){ return {" +
            "   recipient: uid," +
            "   kind: 'request_new'," +
            "   title: 'New documents uploaded for request ' + req.id," +
            "   read: false," +
            " }; });" +
            " return { items: items, has_any: items.length > 0, request_id: req.id };" +
            "};",
        },
      },
      {
        key: "has_recipients",
        name: "Any recipients?",
        type: "condition",
        options: { filter: { "$last.has_any": { _eq: true } } },
      },
      {
        key: "create_notifications",
        name: "Insert notification rows",
        type: "item-create",
        options: { collection: "notifications", payload: "{{$last.items}}" },
      },
    ],
  },
];

async function deleteFlowIfExists(name: string): Promise<void> {
  const existing = await api<{ data: Array<{ id: string; name: string }> }>(
    `/flows?limit=-1&fields=id,name&filter[name][_eq]=${encodeURIComponent(name)}`,
  );
  for (const f of existing.data) {
    const ops = await api<{ data: Array<{ id: string }> }>(
      `/operations?limit=-1&fields=id&filter[flow][_eq]=${f.id}`,
    );
    if (ops.data.length) {
      // Unset entry point so we can delete ops without FK errors.
      try {
        await api(`/flows/${f.id}`, {
          method: "PATCH",
          body: JSON.stringify({ operation: null }),
        });
      } catch {
        /* tolerated */
      }
      await api(`/operations`, {
        method: "DELETE",
        body: JSON.stringify(ops.data.map((o) => o.id)),
      });
    }
    await api(`/flows/${f.id}`, { method: "DELETE" });
    console.log(`   - removed existing "${name}"`);
  }
}

async function createFlow(f: FlowDef): Promise<void> {
  const { operations, ...meta } = f;
  const created = await api<{ data: { id: string } }>("/flows", {
    method: "POST",
    body: JSON.stringify(meta),
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

  // Wire main path resolve→next, skipping nodes that are reject targets.
  const rejectTargets = new Set(
    operations.map((o) => o.rejectKey).filter((k): k is string => !!k),
  );
  for (let i = 0; i < operations.length - 1; i++) {
    const next = operations[i + 1];
    if (rejectTargets.has(next.key)) continue;
    await api(`/operations/${opIds[i]}`, {
      method: "PATCH",
      body: JSON.stringify({ resolve: opIds[i + 1] }),
    });
  }

  // Wire explicit reject branches.
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.rejectKey && opKeyToId[op.rejectKey]) {
      await api(`/operations/${opIds[i]}`, {
        method: "PATCH",
        body: JSON.stringify({ reject: opKeyToId[op.rejectKey] }),
      });
    }
  }

  await api(`/flows/${flowId}`, {
    method: "PATCH",
    body: JSON.stringify({ operation: opIds[0] }),
  });

  console.log(`   + created "${f.name}" (${opIds.length} ops)`);
}

async function main() {
  console.log(`🔧 Installing customer-upload flows on ${URL_BASE}`);
  for (const f of FLOWS) {
    await deleteFlowIfExists(f.name);
    await createFlow(f);
  }
  console.log("✅ Done.");
}

main().catch((err) => {
  console.error("💥 Patch failed:", err);
  process.exit(1);
});