/**
 * Server-side helper to look up a Directus role id by name.
 *
 * Uses the admin token so non-admin users (Supervisor) can resolve role ids
 * when creating new agents — without granting read access on /roles to them.
 */
import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";

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

        const r = await fetch(
          `${DIRECTUS}/roles?filter[name][_eq]=${encodeURIComponent(name)}&fields=id&limit=1`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!r.ok) {
          return Response.json({ ok: false, error: `directus ${r.status}` }, { status: 502 });
        }
        const j = (await r.json()) as { data?: Array<{ id: string }> };
        return Response.json(
          { ok: true, id: j.data?.[0]?.id ?? null },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
