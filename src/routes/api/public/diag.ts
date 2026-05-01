import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";

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

export const Route = createFileRoute("/api/public/diag")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [agents, requests] = await Promise.all([
            dx<{ data: any[] }>(
              "/users?fields=id,email,first_name,last_name,agent_id,branch,role.name&filter[role][name][_eq]=Agent&limit=-1",
            ),
            dx<{ data: any[] }>(
              "/items/requests?fields=id,agent_id,agent_name,branch,status,date_created,customer_name&sort=-date_created&limit=20",
            ),
          ]);
          return Response.json(
            { ok: true, agents: agents.data, recent_requests: requests.data },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (e: any) {
          return Response.json({ ok: false, error: e.message }, { status: 500 });
        }
      },
    },
  },
});
