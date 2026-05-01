/**
 * Public read-only endpoint for the customer-facing reupload page (/r/:id).
 *
 * The customer who clicks the link from WhatsApp/Email isn't authenticated
 * with Directus, so they can't query /items/requests directly. This route
 * uses the admin token on the server to look up the request and returns ONLY
 * the minimum information the customer needs to know which documents are
 * still missing — no agent emails, no other attachments, no status history.
 */

import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS_TARGET = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";

async function adminFetch(path: string): Promise<any> {
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!token) throw new Error("DIRECTUS_ADMIN_TOKEN not configured");
  const res = await fetch(`${DIRECTUS_TARGET}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function findRequest(id: string): Promise<{ id: string; display: string; customerName: string | null } | null> {
  const fields = "id,request_display_id,customer_name,status";
  const url =
    `/items/requests?fields=${fields}` +
    `&filter[_or][0][id][_eq]=${encodeURIComponent(id)}` +
    `&filter[_or][1][request_display_id][_eq]=${encodeURIComponent(id)}` +
    `&limit=1`;
  const json = await adminFetch(url);
  const row = json.data?.[0];
  if (!row) return null;
  return {
    id: String(row.id),
    display: row.request_display_id || String(row.id),
    customerName: row.customer_name ?? null,
  };
}

async function listOpenMissingNotes(requestId: string): Promise<Array<{ id: string; text: string; createdAt: string }>> {
  const url =
    `/items/request_notes?fields=id,text,kind,resolved_at,date_created` +
    `&filter[request][_eq]=${encodeURIComponent(requestId)}` +
    `&filter[kind][_eq]=missing` +
    `&sort=date_created&limit=200`;
  const json = await adminFetch(url);
  return (json.data ?? [])
    .filter((n: any) => !n.resolved_at)
    .map((n: any) => ({ id: String(n.id), text: String(n.text ?? ""), createdAt: String(n.date_created ?? "") }));
}

export const Route = createFileRoute("/api/public/reupload-request")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = (url.searchParams.get("id") ?? "").trim();
        if (!id || id.length > 64 || !/^[A-Za-z0-9_\-]+$/.test(id)) {
          return Response.json({ found: false, error: "invalid id" }, { status: 400 });
        }
        try {
          const req = await findRequest(id);
          if (!req) return Response.json({ found: false }, { status: 404 });
          const missing = await listOpenMissingNotes(req.id).catch(() => []);
          return Response.json({
            found: true,
            id: req.id,
            display: req.display,
            customerName: req.customerName,
            missing,
          });
        } catch (e) {
          console.error("[public/reupload-request]", e);
          return Response.json({ found: false, error: "internal" }, { status: 500 });
        }
      },
    },
  },
});
