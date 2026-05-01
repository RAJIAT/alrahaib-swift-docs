/** Comprehensive QA endpoint — checks Directus permissions, RLS, schema. */
import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";

async function dx<T = any>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!token) throw new Error("DIRECTUS_ADMIN_TOKEN not configured");
  const r = await fetch(`${DIRECTUS}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : ({} as T);
}

async function dxNoAuth(path: string, init?: RequestInit) {
  const r = await fetch(`${DIRECTUS}${path}`, init);
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 500) };
}

export const Route = createFileRoute("/api/public/qa-audit")({
  server: {
    handlers: {
      GET: async () => {
        const findings: any = { ok: true, checks: [] };
        try {
          // 1. Schema
          const collections = await dx<{ data: any[] }>("/collections?limit=-1");
          const colNames = collections.data
            .map((c) => c.collection)
            .filter((c) => !c.startsWith("directus_"))
            .sort();
          findings.collections = colNames;

          // 2. Roles & policies & permissions
          const [roles, policies, permissions] = await Promise.all([
            dx<{ data: any[] }>("/roles?fields=id,name"),
            dx<{ data: any[] }>("/policies?fields=id,name,roles"),
            dx<{ data: any[] }>(
              "/permissions?fields=collection,action,policy.name,policy.roles.role.name&limit=-1",
            ),
          ]);
          findings.roles = roles.data.map((r: any) => r.name);

          const permsByPolicy: Record<string, string[]> = {};
          for (const p of permissions.data) {
            const roleNames = p.policy?.roles?.map((r: any) => r.role?.name).filter(Boolean) ?? [];
            const key = roleNames.length ? roleNames.join(",") : `policy:${p.policy?.name}`;
            (permsByPolicy[key] ||= []).push(`${p.collection}.${p.action}`);
          }
          findings.permissions_by_role = Object.fromEntries(
            Object.entries(permsByPolicy).map(([k, v]) => [k, v.sort()]),
          );

          // 3. Users by role
          const users = await dx<{ data: any[] }>(
            "/users?fields=id,email,first_name,last_name,agent_id,branch,supervisor_id,status,role.name&limit=-1",
          );
          findings.users = users.data.map((u: any) => ({
            email: u.email,
            role: u.role?.name,
            agent_id: u.agent_id,
            branch: u.branch,
            supervisor_id: u.supervisor_id,
            status: u.status,
          }));

          // 4. Branches
          try {
            const branches = await dx<{ data: any[] }>("/items/branches?fields=*&limit=-1");
            findings.branches = branches.data;
          } catch (e: any) {
            findings.branches_error = e.message;
          }

          // 5. Recent requests
          const requests = await dx<{ data: any[] }>(
            "/items/requests?fields=id,agent_id,agent_name,branch,status,date_created,customer_name,customer_email&sort=-date_created&limit=10",
          );
          findings.recent_requests = requests.data;

          // 6. SECURITY: anonymous probes
          const security: any = {};
          security.anon_list_users = await dxNoAuth("/users?limit=1");
          security.anon_list_requests = await dxNoAuth("/items/requests?limit=1");
          security.anon_list_branches = await dxNoAuth("/items/branches?limit=1");
          security.anon_list_audit = await dxNoAuth("/items/audit_log?limit=1");
          security.anon_get_admin_token = await dxNoAuth("/users/me");
          // Try to create a request anonymously (should be blocked!)
          security.anon_create_request = await dxNoAuth("/items/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent_id: "HACK", status: "new" }),
          });
          findings.anonymous_probes = security;

          return Response.json(findings, { headers: { "cache-control": "no-store" } });
        } catch (e: any) {
          return Response.json({ ok: false, error: e.message, partial: findings }, { status: 500 });
        }
      },
    },
  },
});
