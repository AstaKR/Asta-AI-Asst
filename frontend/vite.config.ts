/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The SPA talks to Django through this proxy, so cookies (session + CSRF) are same-origin.
export default defineConfig(({ mode }) => {
  // Backend URL comes from the shared repo-root .env (BACKEND_INTERNAL_URL). Nothing from .env is
  // exposed to client code: only VITE_-prefixed variables would be, and none are defined.
  const env = loadEnv(mode, "..", "");
  const backend = env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8000";
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: backend, changeOrigin: false },
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
