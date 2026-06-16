import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Lovable hosting deploys to Cloudflare Workers; keep this enabled
  // so the published site loads. For self-hosted Node/PM2 deploys, build
  // separately with cloudflare: false.
  cloudflare: true,
  vite: {
    server: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: ["10.8.0.21", "localhost", "127.0.0.1"],
    },
    preview: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: ["10.8.0.21", "localhost", "127.0.0.1"],
    },
  },
});
