/**
 * One-off patch: grants Supervisor + Agent roles `create` permission on
 * `audit_log` so their actions show up in the admin audit page with the
 * correct actor_role (instead of being silently dropped, which made every
 * visible row look admin-authored).
 *
 * Idempotent: re-running is safe; existing permission rows return 400/409
 * and are skipped.
 *
 * Usage:
 *   DIRECTUS_URL=http://127.0.0.1:8055 \
 *   DIRECTUS_ADMIN_TOKEN= \
 *   npx tsx scripts/directus-patch-audit-create-perms.ts
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

async function findPolicyId(name: string): Promise<string> {
  const r = await api<{ data: Policy[] }>(
    `/policies?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`,
  );
  if (!r.data?.[0]) throw new Error(`Policy not found: ${name}`);
  return r.data[0].id;
}

async function grant(policy: string, role: string) {
  try {
    await api(`/permissions`, {
      method: "POST",
      body: JSON.stringify({
        policy,
        collection: "audit_log",
        action: "create",
        fields: ["*"],
        permissions: {},
        validation: {},
      }),
    });
    console.log(`   + ${role} → audit_log.create`);
  } catch (e) {
    const msg = String((e as Error).message ?? e).split("\n")[0];
    if (/RecordNotUnique|duplicate|already exists|409|400/i.test(msg)) {
      console.log(`   = ${role} → audit_log.create (already present, skipped)`);
    } else {
      console.warn(`   ! ${role} → audit_log.create failed: ${msg}`);
    }
  }
}

async function main() {
  console.log("🔐 Patching audit_log.create permission…");
  for (const role of ["Supervisor", "Agent"]) {
    const policy = await findPolicyId(role);
    await grant(policy, role);
  }
  console.log("\n✅ Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});