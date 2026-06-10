import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Build for Node.js (DirectAdmin / PM2), not Cloudflare Workers.
  cloudflare: false,
  vite: {
    server: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: ["docportal.alrahaib.com", "localhost", "127.0.0.1"],
    },
    preview: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: ["docportal.alrahaib.com", "localhost", "127.0.0.1"],
    },
  },
});
