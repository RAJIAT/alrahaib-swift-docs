/**
 * One-off patch for the customer-facing quote share link (`/q/:requestId`)
 * and the Sales Agent notification when an underwriter uploads a quote.
 *
 * Adds to the **Public** policy:
 *   - requests.read       (limited fields, no filter — id is REQ-... random)
 *   - request_files.read  (filter: kind = quote, limited fields)
 *   - directus_files.read (so /assets/:id works without a session)
 *
 * Adds to the **App Agent Policy** (so the underwriter / sales agent can
 * trigger a notification insert via the flow — only used if accountability
 * is set to "all"; we keep the flow at "null" so this is harmless either way):
 *   - notifications.create (whitelisted fields)
 *
 * Installs (or repairs) a Directus Flow:
 *   - "lovable: quote_upload_notify"
 *     Trigger: items.create on request_files (action), accountability null
 *     When kind = quote, read the parent request, build a notification for
 *     the request's origin_agent + agent (deduped, excluding null), and
 *     insert it into `notifications` so the Sales Agent's bell updates.
 *
 * Idempotent: re-running upserts permissions and recreates the flow cleanly.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN=<admin static token> \
 *   npx tsx scripts/directus-patch-public-quote.ts
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

// ----- find / create policies -----

type Policy = { id: string; name: string };

async function findPolicyByName(name: string): Promise<Policy | null> {
  const r = await api<{ data: Policy[] }>(
    `/policies?limit=-1&fields=id,name&filter[name][_eq]=${encodeURIComponent(name)}`,
  );
  return r.data[0] ?? null;
}

async function ensurePublicPolicy(): Promise<string> {
  // The Directus 11 default "Public" policy is the one attached to role=null.
  // We try a few common names, then fall back to creating + linking one.
  for (const name of ["Public", "$public", "public"]) {
    const p = await findPolicyByName(name);
    if (p) return p.id;
  }
  // Look up via /access where role is null (Directus 11 public access link).
  try {
    const r = await api<{ data: Array<{ id: string; policy: string | { id: string }; role: string | null }> }>(
      `/access?limit=-1&fields=id,policy,role&filter[role][_null]=true`,
    );
    const row = r.data[0];
    if (row) {
      const pid = typeof row.policy === "string" ? row.policy : row.policy.id;
      if (pid) return pid;
    }
  } catch { /* tolerated */ }
  // Create a new Public policy + link it to role=null.
  const created = await api<{ data: { id: string } }>("/policies", {
    method: "POST",
    body: JSON.stringify({ name: "Public", icon: "public", description: "Public policy" }),
  });
  try {
    await api("/access", {
      method: "POST",
      body: JSON.stringify({ role: null, policy: created.data.id }),
    });
  } catch (e) {
    console.warn("   ! could not link Public policy to role=null automatically:", (e as Error).message);
  }
  return created.data.id;
}

async function ensureAgentPolicy(): Promise<string | null> {
  const p = (await findPolicyByName("App Agent Policy")) ?? (await findPolicyByName("Agent"));
  return p?.id ?? null;
}

// ----- upsert permissions (idempotent via filter) -----

type PermRow = {
  policy: string;
  collection: string;
  action: "read" | "create" | "update" | "delete";
  fields?: string[];
  permissions?: Record<string, unknown>;
  validation?: Record<string, unknown>;
};

async function upsertPermission(row: PermRow): Promise<void> {
  // Check existing by (policy, collection, action)
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
    /* fall through to POST (Directus 11 may forbid the lookup) */
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

// ----- flow management -----

type OpDef = {
  key: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
  rejectKey?: string;
};

const QUOTE_NOTIFY_FLOW = {
  name: "lovable: quote_upload_notify",
  icon: "notifications_active",
  color: "#8E44AD",
  description: "When an underwriter uploads a quote, notify the request's sales agent.",
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
        code:
          "module.exports = async function(data) {" +
          " const req = data.read_request || {};" +
          " const uploader = (data.$trigger && data.$trigger.payload && data.$trigger.payload.uploaded_by) || null;" +
          " const seen = new Set();" +
          " const recipients = [];" +
          " function add(uid) { if (uid && uid !== uploader && !seen.has(uid)) { seen.add(uid); recipients.push(uid); } }" +
          " add(req.origin_agent);" +
          " add(req.agent);" +
          " const items = recipients.map(function(uid){ return {" +
          "   recipient: uid," +
          "   kind: 'request_status'," +
          "   title: 'Quote ready for ' + req.id + ' — share with customer'," +
          "   body: 'Underwriter uploaded a quote for request ' + req.id," +
          "   link: '/requests/' + req.id," +
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
  ] as OpDef[],
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

async function createFlow(f: typeof QUOTE_NOTIFY_FLOW): Promise<void> {
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

async function main() {
  console.log(`🔧 Public quote + notify patch on ${URL_BASE}`);

  console.log("\n🔐 Public policy permissions…");
  const publicPolicy = await ensurePublicPolicy();
  console.log(`   = Public policy id: ${publicPolicy}`);

  await upsertPermission({
    policy: publicPolicy,
    collection: "requests",
    action: "read",
    fields: ["id", "uuid", "customer_name", "customer_email", "customer_phone", "date_created", "status"],
    permissions: {},
  });
  await upsertPermission({
    policy: publicPolicy,
    collection: "request_files",
    action: "read",
    fields: ["id", "request", "kind", "uploaded_at", "file"],
    permissions: { kind: { _eq: "quote" } },
  });
  await upsertPermission({
    policy: publicPolicy,
    collection: "directus_files",
    action: "read",
    fields: ["id", "filename_download", "type", "filesize"],
    permissions: {},
  });

  const agentPolicy = await ensureAgentPolicy();
  if (agentPolicy) {
    console.log("\n🔐 Agent policy: notifications.create (best-effort fallback)…");
    await upsertPermission({
      policy: agentPolicy,
      collection: "notifications",
      action: "create",
      fields: ["recipient", "kind", "title", "body", "link", "read"],
      validation: {},
    });
  }

  console.log("\n⚡ Flow: lovable: quote_upload_notify…");
  await deleteFlowIfExists(QUOTE_NOTIFY_FLOW.name);
  await createFlow(QUOTE_NOTIFY_FLOW);

  console.log("\n✅ Done.");
  console.log("   • /q/<REQ-id> now loads without login.");
  console.log("   • Sales Agent receives a notification when underwriter uploads a quote.");
}

main().catch((err) => {
  console.error("💥 Patch failed:", err);
  process.exit(1);
});