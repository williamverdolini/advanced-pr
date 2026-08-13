import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: "localhost",
    port: 3000,
    strictPort: true,
  },
  css: {
    lightningcss: {
      errorRecovery: true,
    },
  },
  build: {
    outDir: "dist/tab",
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
