/**
 * Al Diplomacy — workflow patch (one-off, idempotent).
 *
 * Re-asserts the Directus permissions and Flows that drive the
 * request workflow end-to-end:
 *
 *  - Agent policy: request_notes.create (author = $CURRENT_USER) + notifications.create
 *  - Supervisor policy: notifications.create + directus_users.read (branch-scoped)
 *
 *  - Flow "lovable: quote_upload_notify"        — when a quote file is uploaded,
 *                                                  notify origin_agent + agent.
 *  - Flow "lovable: customer_upload_notify"     — when a customer/document file is
 *                                                  attached, notify origin_agent + agent.
 *  - Flow "lovable: missing_note_notify"        — when a 'missing' note is created,
 *                                                  notify origin_agent + agent.
 *  - Flow "lovable: reassign_notify"            — when requests.agent changes,
 *                                                  notify the new agent.
 *
 * Idempotent: re-running upserts permissions and recreates each flow cleanly.
 *
 * Usage (Al Diplomacy server — Node/tsx, never Bun):
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=<admin static token> \
 *   npx tsx scripts/directus-patch-workflow.ts
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

async function findPolicyByName(name: string): Promise<Policy | null> {
  const r = await api<{ data: Policy[] }>(
    `/policies?limit=-1&fields=id,name&filter[name][_eq]=${encodeURIComponent(name)}`,
  );
  return r.data[0] ?? null;
}

async function findPolicyByAnyName(names: string[]): Promise<string | null> {
  for (const n of names) {
    const p = await findPolicyByName(n);
    if (p) return p.id;
  }
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

// ---------------- flow scaffolding ----------------

type OpDef = {
  key: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
};

type FlowDef = {
  name: string;
  icon: string;
  color: string;
  description: string;
  status: "active";
  trigger: "event";
  accountability: "null";
  options: Record<string, unknown>;
  operations: OpDef[];
};

async function deleteFlowIfExists(name: string): Promise<void> {
  const existing = await api<{ data: Array<{ id: string; name: string }> }>(
    `/flows?limit=-1&fields=id,name&filter[name][_eq]=${encodeURIComponent(name)}`,
  );
  for (const f of existing.data) {
    const ops = await api<{ data: Array<{ id: string }> }>(
      `/operations?limit=-1&fields=id&filter[flow][_eq]=${f.id}`,
    );
    if (ops.data.length) {
      try { await api(`/flows/${f.id}`, { method: "PATCH", body: JSON.stringify({ operation: null }) }); }
      catch { /* tolerated */ }
      await api(`/operations`, { method: "DELETE", body: JSON.stringify(ops.data.map((o) => o.id)) });
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
  }
  for (let i = 0; i < operations.length - 1; i++) {
    await api(`/operations/${opIds[i]}`, {
      method: "PATCH",
      body: JSON.stringify({ resolve: opIds[i + 1] }),
    });
  }
  await api(`/flows/${flowId}`, {
    method: "PATCH",
    body: JSON.stringify({ operation: opIds[0] }),
  });
  console.log(`   + created "${f.name}" (${opIds.length} ops)`);
}

// ---------------- flow definitions ----------------

/** Build a notification fan-out exec for origin_agent + agent. */
function fanoutExec(opts: {
  title: string;     // e.g. "New documents for {{req_id}}"
  body: string;      // e.g. "Customer uploaded a file for request {{req_id}}"
  kind?: string;     // notification kind tag
  uploaderKey?: string; // e.g. "$trigger.payload.uploaded_by" → recipient that is excluded
  reqIdExpr?: string;   // js expression returning req id, default "req.id"
}): string {
  const kind = opts.kind ?? "request_status";
  const uploaderExpr = opts.uploaderKey
    ? `(data.$trigger && data.$trigger.payload && data.$trigger.payload.${opts.uploaderKey}) || null`
    : "null";
  return (
    "module.exports = async function(data) {" +
    " const req = data.read_request || {};" +
    " const uploader = " + uploaderExpr + ";" +
    " const seen = new Set();" +
    " const recipients = [];" +
    " function add(uid) { if (uid && uid !== uploader && !seen.has(uid)) { seen.add(uid); recipients.push(uid); } }" +
    " add(req.origin_agent);" +
    " add(req.agent);" +
    " const reqId = req.id || '';" +
    " const items = recipients.map(function(uid){ return {" +
    "   recipient: uid," +
    "   kind: '" + kind + "'," +
    "   title: " + JSON.stringify(opts.title) + ".replace('{{req_id}}', reqId)," +
    "   body: " + JSON.stringify(opts.body) + ".replace('{{req_id}}', reqId)," +
    "   link: '/requests/' + reqId," +
    "   read: false," +
    " }; });" +
    " return { items: items, has_any: items.length > 0 };" +
    "};"
  );
}

const QUOTE_NOTIFY_FLOW: FlowDef = {
  name: "lovable: quote_upload_notify",
  icon: "notifications_active",
  color: "#8E44AD",
  description: "When an underwriter uploads a quote, notify the sales agent.",
  status: "active",
  trigger: "event",
  accountability: "null",
  options: { type: "action", scope: ["items.create"], collections: ["request_files"] },
  operations: [
    {
      key: "is_quote",
      name: "Only quote uploads",
      type: "condition",
      options: { filter: { "$trigger.payload.kind": { _eq: "quote" } } },
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
        code: fanoutExec({
          title: "Quote ready for {{req_id}} — share with customer",
          body: "Underwriter uploaded a quote for request {{req_id}}",
          uploaderKey: "uploaded_by",
        }),
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
};

const CUSTOMER_UPLOAD_FLOW: FlowDef = {
  name: "lovable: customer_upload_notify",
  icon: "cloud_upload",
  color: "#16A085",
  description: "When a customer uploads documents (any non-quote file), notify the sales agent.",
  status: "active",
  trigger: "event",
  accountability: "null",
  options: { type: "action", scope: ["items.create"], collections: ["request_files"] },
  operations: [
    {
      key: "is_doc",
      name: "Skip quote uploads",
      type: "condition",
      options: { filter: { "$trigger.payload.kind": { _neq: "quote" } } },
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
        code: fanoutExec({
          title: "New documents for {{req_id}}",
          body: "Documents were uploaded for request {{req_id}}",
          uploaderKey: "uploaded_by",
        }),
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
};

const MISSING_NOTE_FLOW: FlowDef = {
  name: "lovable: missing_note_notify",
  icon: "report_problem",
  color: "#E67E22",
  description: "When a 'missing' note is added, notify the request agent + origin agent.",
  status: "active",
  trigger: "event",
  accountability: "null",
  options: { type: "action", scope: ["items.create"], collections: ["request_notes"] },
  operations: [
    {
      key: "is_missing",
      name: "Only missing notes",
      type: "condition",
      options: { filter: { "$trigger.payload.kind": { _eq: "missing" } } },
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
        code: fanoutExec({
          title: "Missing documents requested for {{req_id}}",
          body: "A missing-documents note was added to request {{req_id}}",
          uploaderKey: "author",
          kind: "request_status",
        }),
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
};

const REASSIGN_FLOW: FlowDef = {
  name: "lovable: reassign_notify",
  icon: "swap_horiz",
  color: "#2E86C1",
  description: "When a request is reassigned (agent changes), notify the new agent.",
  status: "active",
  trigger: "event",
  accountability: "null",
  options: { type: "action", scope: ["items.update"], collections: ["requests"] },
  operations: [
    {
      key: "agent_changed",
      name: "Only when agent field changed",
      type: "condition",
      options: { filter: { "$trigger.payload.agent": { _nnull: true } } },
    },
    {
      key: "build_items",
      name: "Build notification row",
      type: "exec",
      options: {
        code:
          "module.exports = async function(data) {" +
          " const keys = (data.$trigger && data.$trigger.keys) || [];" +
          " const newAgent = data.$trigger && data.$trigger.payload && data.$trigger.payload.agent;" +
          " if (!newAgent || !keys.length) return { items: [], has_any: false };" +
          " const items = keys.map(function(reqId){ return {" +
          "   recipient: newAgent," +
          "   kind: 'request_status'," +
          "   title: 'New request assigned: ' + reqId," +
          "   body: 'Request ' + reqId + ' has been assigned to you.'," +
          "   link: '/requests/' + reqId," +
          "   read: false," +
          " }; });" +
          " return { items: items, has_any: items.length > 0 };" +
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
};

// ---------------- main ----------------

async function main() {
  console.log(`🔧 Al Diplomacy workflow patch on ${URL_BASE}`);

  const agentPolicy = await findPolicyByAnyName(["App Agent Policy", "Agent"]);
  const supervisorPolicy = await findPolicyByAnyName(["App Supervisor Policy", "Supervisor"]);

  if (agentPolicy) {
    console.log("\n🔐 Agent policy permissions…");
    await upsertPermission({
      policy: agentPolicy,
      collection: "request_notes",
      action: "create",
      fields: ["request", "text", "kind", "author", "author_role"],
      validation: { author: { _eq: "$CURRENT_USER" } },
    });
    await upsertPermission({
      policy: agentPolicy,
      collection: "notifications",
      action: "create",
      fields: ["recipient", "kind", "title", "body", "link", "read"],
    });
  } else {
    console.warn("   ! Agent policy not found — skipping agent permissions");
  }

  if (supervisorPolicy) {
    console.log("\n🔐 Supervisor policy permissions…");
    await upsertPermission({
      policy: supervisorPolicy,
      collection: "notifications",
      action: "create",
      fields: ["recipient", "kind", "title", "body", "link", "read"],
    });
    await upsertPermission({
      policy: supervisorPolicy,
      collection: "directus_users",
      action: "read",
      fields: [
        "id", "first_name", "last_name", "email", "agent_code", "app_role",
        "staff_type", "branch", "assigned_underwriter", "assigned_underwriter_code",
        "app_active",
      ],
      permissions: { branch: { _eq: "$CURRENT_USER.branch" } },
    });
    await upsertPermission({
      policy: supervisorPolicy,
      collection: "branches",
      action: "read",
      fields: ["id", "name", "code", "is_active"],
    });
  } else {
    console.warn("   ! Supervisor policy not found — skipping supervisor permissions");
  }

  console.log("\n⚡ Flows…");
  for (const f of [QUOTE_NOTIFY_FLOW, CUSTOMER_UPLOAD_FLOW, MISSING_NOTE_FLOW, REASSIGN_FLOW]) {
    await deleteFlowIfExists(f.name);
    await createFlow(f);
  }

  console.log("\n✅ Workflow patch complete.");
  console.log("   • Sales agent gets bell notifications for customer uploads + quote uploads.");
  console.log("   • Underwriter gets bell notifications when a request is reassigned to them.");
  console.log("   • Sales agent + origin agent get notified when a 'missing' note is added.");
  console.log("   • Supervisors can list users in their branch on /agents.");
}

main().catch((err) => {
  console.error("💥 Patch failed:", err);
  process.exit(1);
});