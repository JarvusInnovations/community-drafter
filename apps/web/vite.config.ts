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
      // JSON API calls only — `/i/:token` itself (no `/api` suffix) stays on
      // Vite's dev server so it serves this SPA, not the API's built-`dist`
      // fallback (`specs/architecture.md` § API server).
      "^/i/.*/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // `/d/*` has no separate `/api` suffix (`specs/api/conventions.md`):
      // public pages, embeds and JSON all share the prefix.
      "/d": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/admin/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Operator sign-in (`specs/api/auth.md`): the real server routes the
      // admin SPA fetches directly (not full-page navigations), proxied
      // individually rather than as a blanket `/auth` prefix — `GET
      // /auth/device?code=` is deliberately *not* here: it's the SPA's own
      // `DeviceApprovalScreen` route (`specs/api/auth.md`: "(SPA page)"),
      // and proxying it would hand the page load to the API instead of Vite.
      "/auth/session": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/auth/login": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/auth/logout": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/auth/refresh": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/auth/callback": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/auth/device/approve": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
