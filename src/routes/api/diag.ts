/**
 * Read-only diagnostics endpoint.
 *
 * Returns a snapshot of:
 *   - all business collections + record counts
 *   - users grouped by role
 *   - branches
 *   - permissions per role
 *
 * Uses the static DIRECTUS_ADMIN_TOKEN env var. The token is never exposed
 * in the response. Without the token the endpoint returns a clear error.
 */
import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS = process.env.DIRECTUS_TARGET || "https://directus.alrahaib.com";

async function dx<T = any>(path: string): Promise<T> {
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!token) throw new Error("DIRECTUS_ADMIN_TOKEN not configured");
  const r = await fetch(`${DIRECTUS}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : ({} as T);
}

async function safeCount(collection: string): Promise<number | string> {
  try {
    const d = await dx<{ data: any[] }>(`/items/${collection}?aggregate[count]=*`);
    return Number(d.data?.[0]?.count ?? 0);
  } catch (e: any) {
    return `err: ${e.message.slice(0, 80)}`;
  }
}

const EXPECTED = [
  "branches",
  "requests",
  "request_notes",
  "request_attachments",
  "request_missing_attachments",
  "request_vehicle_media",
  "audit_log",
];

export const Route = createFileRoute("/api/diag")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [collections, users, roles, branches, permissions] = await Promise.all([
            dx<{ data: any[] }>("/collections?limit=-1"),
            dx<{ data: any[] }>(
              "/users?fields=id,email,first_name,last_name,status,role.name&limit=-1",
            ),
            dx<{ data: any[] }>("/roles?fields=id,name"),
            dx<{ data: any[] }>("/items/branches?fields=*&limit=-1").catch(() => ({ data: [] })),
            dx<{ data: any[] }>(
              "/permissions?fields=collection,action,policy.name,policy.roles.role.name&limit=-1",
            ).catch(() => ({ data: [] })),
          ]);

          const colNames = collections.data
            .map((c: any) => c.collection)
            .filter((c: string) => !c.startsWith("directus_"))
            .sort();

          const counts: Record<string, number | string> = {};
          for (const c of colNames) counts[c] = await safeCount(c);

          const usersByRole: Record<string, any[]> = {};
          for (const u of users.data) {
            const role = u.role?.name ?? "no-role";
            (usersByRole[role] ||= []).push({
              email: u.email,
              name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
              status: u.status,
            });
          }

          const permsByRole: Record<string, Set<string>> = {};
          for (const p of permissions.data) {
            const roleNames =
              p.policy?.roles?.map((r: any) => r.role?.name).filter(Boolean) ?? [];
            const targets = roleNames.length ? roleNames : [`policy:${p.policy?.name ?? "?"}`];
            for (const rn of targets) {
              (permsByRole[rn] ||= new Set()).add(`${p.collection}.${p.action}`);
            }
          }
          const permsByRoleArr: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(permsByRole)) {
            permsByRoleArr[k] = [...v].sort();
          }

          const missing = EXPECTED.filter((c) => !colNames.includes(c));
          const extra = colNames.filter((c) => !EXPECTED.includes(c));

          return Response.json(
            {
              ok: true,
              directus_url: DIRECTUS,
              summary: {
                collections_total: colNames.length,
                expected_collections_present: EXPECTED.length - missing.length,
                missing_collections: missing,
                unexpected_collections: extra,
                users_total: users.data.length,
                users_per_role: Object.fromEntries(
                  Object.entries(usersByRole).map(([k, v]) => [k, v.length]),
                ),
                branches_total: branches.data.length,
              },
              collections: colNames,
              record_counts: counts,
              roles: roles.data.map((r: any) => r.name),
              users_by_role: usersByRole,
              branches: branches.data,
              permissions_by_role: permsByRoleArr,
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (e: any) {
          return Response.json({ ok: false, error: e.message }, { status: 500 });
        }
      },
    },
  },
});
