import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  // Relative asset URLs. The packaged extension is served from the Marketplace
  // CDN under a versioned path prefix, so the default absolute "/assets/..."
  // would resolve against the CDN root and the tab would load empty. The dev
  // manifest never shows this, because `baseUri` points at the dev server root.
  base: "./",
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
    // Off for the packaged extension: the maps are the bulk of the .vsix and
    // ship the full sources to every install. Debugging goes through the dev
    // extension and its `baseUri`, where the dev server serves maps anyway.
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
