import { createFileRoute } from "@tanstack/react-router";

// Liveness/readiness probe used by Nginx, PM2, uptime monitors.
// Returns 200 with minimal JSON; no DB call so it stays cheap.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          JSON.stringify({
            status: "ok",
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        ),
    },
  },
});