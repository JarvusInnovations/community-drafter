import path from "path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/_health": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // `notifications` plan: the preferences screen talks to the
      // participant API directly by relative path (same-origin in
      // production, per `specs/architecture.md` § Deployment). Scoped to
      // `/i/<token>/api/*` specifically — a bare `/i` prefix would also
      // swallow the SPA's own `/i/:token/prefs` page route.
      "^/i/[^/]+/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
