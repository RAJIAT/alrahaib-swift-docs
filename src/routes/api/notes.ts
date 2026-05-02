/**
 * Authenticated server endpoint for creating/resolving request_notes.
 *
 * Why: the per-role Directus permissions for `request_notes` are not
 * guaranteed to be in place on every environment. Rather than rely on each
 * dashboard user having row-level CRUD on `request_notes`, we forward the
 * user's session token to /users/me to verify they're a real logged-in
 * user, then perform the write with the admin token.
 *
 * Security:
 *   - Requires a valid Directus session bearer token (proves identity).
 *   - For "create": author_id/author_name/author_role come from /users/me,
 *     never from the client body.
 *   - For "resolve": only sets resolved_at to now(); cannot modify text.
 *   - Request id is validated and existence is checked before any write.
 */

import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS_TARGET = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";

async function admin(path: string, init: RequestInit = {}) {
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!token) throw new Error("DIRECTUS_ADMIN_TOKEN not configured");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${DIRECTUS_TARGET}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function getMe(authHeader: string) {
  const res = await fetch(
    `${DIRECTUS_TARGET}/users/me?fields=id,email,first_name,last_name,role.name`,
    { headers: { Authorization: authHeader } },
  );
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.data ?? null;
}

async function findRequestId(idOrDisplay: string): Promise<string | null> {
  const url =
    `/items/requests?fields=id` +
    `&filter[_or][0][id][_eq]=${encodeURIComponent(idOrDisplay)}` +
    `&filter[_or][1][request_display_id][_eq]=${encodeURIComponent(idOrDisplay)}` +
    `&limit=1`;
  const j = await admin(url);
  return j.data?.[0]?.id ? String(j.data[0].id) : null;
}

export const Route = createFileRoute("/api/notes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const authHeader =
            request.headers.get("authorization") ||
            request.headers.get("Authorization");
          if (!authHeader) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }
          const me = await getMe(authHeader);
          if (!me) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }

          const url = new URL(request.url);
          const rid = (url.searchParams.get("requestId") ?? "").trim();
          if (!rid || !/^[A-Za-z0-9_\-]+$/.test(rid)) {
            return Response.json({ ok: false, error: "invalid requestId" }, { status: 400 });
          }
          const reqId = await findRequestId(rid);
          if (!reqId) return Response.json({ ok: true, notes: [] });

          const params = new URLSearchParams({
            fields: "id,request,text,kind,author_id,author_name,author_role,date_created,resolved_at",
            sort: "date_created",
            limit: "200",
          });
          params.set("filter[request][_eq]", reqId);
          const json = await admin(`/items/request_notes?${params.toString()}`);
          return Response.json({ ok: true, notes: json.data ?? [] });
        } catch (e) {
          console.error("[api/notes GET]", e);
          return Response.json({ ok: false, error: "internal" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const authHeader =
            request.headers.get("authorization") ||
            request.headers.get("Authorization");
          if (!authHeader) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }
          const me = await getMe(authHeader);
          if (!me) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }

          const body = await request.json().catch(() => null) as
            | { action?: string; requestId?: string; noteId?: string | number; text?: string; kind?: string }
            | null;
          if (!body || typeof body.action !== "string") {
            return Response.json({ ok: false, error: "invalid body" }, { status: 400 });
          }

          const roleName = String(me.role?.name ?? "").toLowerCase();
          let role: "admin" | "supervisor" | "agent" = "agent";
          if (roleName.includes("admin")) role = "admin";
          else if (roleName.includes("supervisor")) role = "supervisor";

          const name =
            [me.first_name, me.last_name].filter(Boolean).join(" ").trim() ||
            me.email;

          if (body.action === "create") {
            const text = String(body.text ?? "").trim();
            const kind = body.kind === "missing" ? "missing" : "comment";
            if (!text) return Response.json({ ok: false, error: "empty text" }, { status: 400 });
            if (text.length > 2000) {
              return Response.json({ ok: false, error: "text too long" }, { status: 400 });
            }
            const rid = String(body.requestId ?? "").trim();
            if (!rid || !/^[A-Za-z0-9_\-]+$/.test(rid)) {
              return Response.json({ ok: false, error: "invalid requestId" }, { status: 400 });
            }
            const reqId = await findRequestId(rid);
            if (!reqId) return Response.json({ ok: false, error: "request not found" }, { status: 404 });

            const created = await admin("/items/request_notes", {
              method: "POST",
              body: JSON.stringify({
                request: reqId,
                text,
                kind,
                author_id: me.id,
                author_name: name,
                author_role: role,
              }),
            });

            // When an agent flags a missing item, flip status to reupload.
            if (kind === "missing") {
              try {
                await admin(`/items/requests/${encodeURIComponent(reqId)}`, {
                  method: "PATCH",
                  body: JSON.stringify({ status: "reupload" }),
                });
              } catch (e) { console.error("[notes] status flip failed", e); }
            }
            return Response.json({ ok: true, note: created.data });
          }

          if (body.action === "resolve") {
            const noteId = Number(body.noteId);
            if (!Number.isFinite(noteId)) {
              return Response.json({ ok: false, error: "invalid noteId" }, { status: 400 });
            }
            const updated = await admin(`/items/request_notes/${noteId}`, {
              method: "PATCH",
              body: JSON.stringify({ resolved_at: new Date().toISOString() }),
            });
            return Response.json({ ok: true, note: updated.data });
          }

          return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
        } catch (e) {
          console.error("[api/notes]", e);
          return Response.json({ ok: false, error: "internal" }, { status: 500 });
        }
      },
    },
  },
});
