/**
 * Public endpoint for the customer reupload page (/r/:id).
 *
 * Receives multipart/form-data: one or more `file` fields + `id` field
 * containing the request id (numeric or display). Uses the Directus admin
 * token on the server to:
 *   1. Resolve the real request id.
 *   2. Upload each file to /files.
 *   3. Create rows in `request_missing_attachments`.
 *   4. Resolve all open `missing` notes on this request.
 *   5. Flip the request status back to `processing`.
 *
 * Customer never sees the admin token. Only the request id is exposed and
 * we cap the number/size of files so a leaked link can't be abused.
 */

import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS_TARGET = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";
const MAX_FILES = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file

async function adminJson(path: string, init: RequestInit = {}) {
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!token) throw new Error("DIRECTUS_ADMIN_TOKEN not configured");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${DIRECTUS_TARGET}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const json = await adminJson("/files", { method: "POST", body: fd });
  return json.data.id as string;
}

async function findRequestId(id: string): Promise<string | null> {
  const url =
    `/items/requests?fields=id` +
    `&filter[_or][0][id][_eq]=${encodeURIComponent(id)}` +
    `&filter[_or][1][request_display_id][_eq]=${encodeURIComponent(id)}` +
    `&limit=1`;
  const json = await adminJson(url);
  const row = json.data?.[0];
  return row ? String(row.id) : null;
}

export const Route = createFileRoute("/api/public/reupload-submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const rawId = (form.get("id") as string | null)?.trim() ?? "";
          if (!rawId || rawId.length > 64 || !/^[A-Za-z0-9_\-]+$/.test(rawId)) {
            return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
          }
          const reqId = await findRequestId(rawId);
          if (!reqId) return Response.json({ ok: false, error: "not found" }, { status: 404 });

          const files = form.getAll("file").filter((v): v is File => v instanceof File);
          if (files.length === 0) return Response.json({ ok: false, error: "no files" }, { status: 400 });
          if (files.length > MAX_FILES) {
            return Response.json({ ok: false, error: "too many files" }, { status: 400 });
          }
          for (const f of files) {
            if (f.size > MAX_FILE_BYTES) {
              return Response.json({ ok: false, error: "file too large" }, { status: 413 });
            }
          }

          let uploaded = 0;
          for (const f of files) {
            try {
              const fileId = await uploadFile(f);
              await adminJson("/items/request_missing_attachments", {
                method: "POST",
                body: JSON.stringify({ request: reqId, file: fileId, original_name: f.name }),
              });
              uploaded += 1;
            } catch (e) {
              console.error("[reupload-submit] file failed", e);
            }
          }

          // Resolve all open missing notes
          try {
            const notesJson = await adminJson(
              `/items/request_notes?fields=id,kind,resolved_at` +
                `&filter[request][_eq]=${encodeURIComponent(reqId)}` +
                `&filter[kind][_eq]=missing&limit=200`,
            );
            for (const n of notesJson.data ?? []) {
              if (!n.resolved_at) {
                await adminJson(`/items/request_notes/${n.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ resolved_at: new Date().toISOString() }),
                });
              }
            }
          } catch (e) { console.error("[reupload-submit] notes resolve failed", e); }

          // Flip status back to processing
          try {
            await adminJson(`/items/requests/${encodeURIComponent(reqId)}`, {
              method: "PATCH",
              body: JSON.stringify({ status: "processing" }),
            });
          } catch (e) { console.error("[reupload-submit] status flip failed", e); }

          return Response.json({ ok: true, uploaded });
        } catch (e) {
          console.error("[public/reupload-submit]", e);
          return Response.json({ ok: false, error: "internal" }, { status: 500 });
        }
      },
    },
  },
});
