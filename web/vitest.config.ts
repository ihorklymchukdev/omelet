import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
  },
});
