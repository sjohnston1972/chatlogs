import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The SPA is built into web/dist, which the Worker serves via the ASSETS binding.
// During `vite dev`, /api requests are proxied to a local `wrangler dev` on :8787.
// root is pinned to this directory so the build works regardless of cwd.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
