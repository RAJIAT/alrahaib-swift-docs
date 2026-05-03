/**
 * Public file upload endpoint for the customer-facing upload form.
 *
 * Why this exists separately from /api/directus/files:
 *   - The Directus REST endpoint POST /files defaults to returning the full
 *     file row (storage, title, filename_download, type, ...). When the caller
 *     is using a role that can create files but not read those metadata
 *     fields, Directus reports the upload itself as failed even though the
 *     file was saved.
 *   - On mobile, customers may have a stale Agent / Supervisor session token
 *     in localStorage from a previous login on the same device. The browser
 *     attaches that token, the proxy honors it, and Directus then strips the
 *     response per that role's policy → the customer sees the confusing
 *     "You don't have permission to access fields ..." error.
 *
 * This route bypasses both problems:
 *   1. It always uses the server-side admin token (never the client's token).
 *   2. It only returns `{ ok, id }` to the browser; Directus metadata never
 *      leaves the server.
 *   3. Same input validation (size, MIME type) as the existing anonymous
 *      file path so nothing is weakened from a security perspective.
 */

import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS_TARGET = process.env.DIRECTUS_TARGET || "http://api.rajiatiyah.com:8055";
const FILE_MAX_BYTES = 25 * 1024 * 1024; // 25MB — matches existing public-flow limit
const FILE_MIME_WHITELIST = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
]);
const EXT_FALLBACK_REGEX = /\.(jpe?g|png|webp|heic|heif|pdf|mp4|mov|m4v|3gp)$/i;

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/upload-file")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
        if (!adminToken) {
          console.error("[public/upload-file] DIRECTUS_ADMIN_TOKEN not configured");
          return jsonError(500, "Upload service is temporarily unavailable");
        }

        const contentType = request.headers.get("content-type") || "";
        if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
          return jsonError(400, "Upload must be multipart/form-data");
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch (e) {
          console.error("[public/upload-file] formData parse failed", e);
          return jsonError(400, "Malformed upload");
        }

        const file = form.get("file");
        if (!(file instanceof File)) {
          return jsonError(400, "No file provided");
        }
        if (file.size === 0) {
          return jsonError(400, "Empty file");
        }
        if (file.size > FILE_MAX_BYTES) {
          return jsonError(413, "File is too large");
        }

        const mime = (file.type || "").toLowerCase();
        const name = (file.name || "").toLowerCase();
        const extOk = EXT_FALLBACK_REGEX.test(name);
        // iOS Safari sometimes sends an empty MIME type. Accept the file when
        // the filename has a known extension OR the MIME is whitelisted.
        if (!FILE_MIME_WHITELIST.has(mime) && !(mime === "" && extOk)) {
          return jsonError(415, "Unsupported file type");
        }

        // Forward to Directus with the admin token. Restrict the response to
        // `id` so Directus never tries to return metadata fields the caller
        // would not be allowed to read.
        const fd = new FormData();
        fd.append("file", file, file.name);

        try {
          const upstream = await fetch(`${DIRECTUS_TARGET}/files?fields=id`, {
            method: "POST",
            headers: { Authorization: `Bearer ${adminToken}` },
            body: fd,
          });

          const text = await upstream.text();
          if (!upstream.ok) {
            console.error("[public/upload-file] upstream error", upstream.status, text.slice(0, 300));
            // Never echo Directus' raw permission text back to the customer.
            return jsonError(502, "Upload failed, please try again");
          }

          let parsed: { data?: { id?: string } } = {};
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch (e) {
            console.error("[public/upload-file] upstream parse failed", e, text.slice(0, 200));
            return jsonError(502, "Upload failed, please try again");
          }
          const id = parsed.data?.id;
          if (!id) {
            console.error("[public/upload-file] missing id in upstream response", text.slice(0, 200));
            return jsonError(502, "Upload failed, please try again");
          }
          return Response.json({ ok: true, id });
        } catch (e) {
          console.error("[public/upload-file] upstream fetch failed", e);
          return jsonError(502, "Upload failed, please try again");
        }
      },
    },
  },
});
