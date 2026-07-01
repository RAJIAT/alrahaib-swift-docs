import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
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
