/**
 * Server-side proxy to the on-premise Directus instance.
 *
 * Why: the browser runs on HTTPS but Directus is on plain HTTP, which causes
 * a Mixed Content block. By proxying through this server route every request
 * goes HTTPS (browser -> our server) and then plain HTTP server-to-server to
 * Directus. No browser security warning, no SSL needed on Directus yet.
 *
 * All HTTP methods are forwarded transparently. Headers, query string and
 * body are passed through. The response is streamed back as-is.
 */

import { createFileRoute } from "@tanstack/react-router";

const DIRECTUS_TARGET = "http://74.162.122.193:8055";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function proxy(request: Request, splat: string) {
  const url = new URL(request.url);
  const targetUrl = `${DIRECTUS_TARGET}/${splat}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(targetUrl, init);

  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      respHeaders.set(key, value);
    }
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const Route = createFileRoute("/api/directus/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => proxy(request, params._splat ?? ""),
      POST: async ({ request, params }) => proxy(request, params._splat ?? ""),
      PUT: async ({ request, params }) => proxy(request, params._splat ?? ""),
      PATCH: async ({ request, params }) => proxy(request, params._splat ?? ""),
      DELETE: async ({ request, params }) => proxy(request, params._splat ?? ""),
      OPTIONS: async ({ request, params }) => proxy(request, params._splat ?? ""),
    },
  },
});
