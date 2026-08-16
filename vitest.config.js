import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Restores `localStorage` in the jsdom files — Node 22+ shadows jsdom's own
    // with an accessor that is undefined without --localstorage-file. See the
    // file's header for the full mechanism.
    setupFiles: ["tests/setup-jsdom.ts"],
  },
});
