import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/demo-shop/**"],
    },
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    sourcemap: true,
  },
});
