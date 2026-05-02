/**
 * Server-side helper to look up a Directus role id by name.
 *
 * Uses the admin token so non-admin users (Supervisor) can resolve role ids
 * when creating new agents — without granting read access on /roles to them.
 *
 * If the role does not exist yet (e.g. fresh Directus install before the
 * directus-maintenance has run), it is auto-created on the fly. This avoids
 * the "Role 'Agent' not found in Directus" error when an admin creates the
 * very first agent before any /api/directus/* proxy call has run.
 */
import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";

const AUTO_CREATE_ROLES = new Set(["Agent", "Supervisor"]);

async function dxAdmin(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${DIRECTUS}${path}`, { ...init, headers });
}

export const Route = createFileRoute("/api/role-id")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = process.env.DIRECTUS_ADMIN_TOKEN;
        if (!token) {
          return Response.json({ ok: false, error: "admin token not configured" }, { status: 500 });
        }
        const url = new URL(request.url);
        const name = url.searchParams.get("name");
        if (!name) return Response.json({ ok: false, error: "missing name" }, { status: 400 });

        // 1) Look up existing role
        const r = await dxAdmin(
          `/roles?filter[name][_eq]=${encodeURIComponent(name)}&fields=id&limit=1`,
          token,
        );
        if (!r.ok) {
          return Response.json({ ok: false, error: `directus ${r.status}` }, { status: 502 });
        }
        const j = (await r.json()) as { data?: Array<{ id: string }> };
        let id = j.data?.[0]?.id ?? null;

        // 2) Auto-create on the fly if it's one of our known roles
        if (!id && AUTO_CREATE_ROLES.has(name)) {
          try {
            const created = await dxAdmin(`/roles`, token, {
              method: "POST",
              body: JSON.stringify({
                name,
                icon: "supervised_user_circle",
                description: `${name} role (auto-created)`,
              }),
            });
            if (created.ok) {
              const cj = (await created.json()) as { data?: { id?: string } };
              id = cj.data?.id ?? null;
            } else {
              const errText = await created.text();
              console.error(`[role-id] failed to auto-create role ${name}: ${created.status} ${errText.slice(0, 200)}`);
            }
          } catch (err) {
            console.error(`[role-id] error auto-creating role ${name}`, err);
          }
        }

        return Response.json(
          { ok: true, id },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
