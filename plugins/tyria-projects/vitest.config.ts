import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    conditions: ["source"],
    alias: [
      { find: "@get-bb/plugin-sdk/app", replacement: fileURLToPath(new URL("../../packages/plugin-sdk/src/app.ts", import.meta.url)) },
      { find: "@get-bb/plugin-sdk/testing/app", replacement: fileURLToPath(new URL("../../packages/plugin-sdk/src/testing/app.tsx", import.meta.url)) },
      { find: "@get-bb/plugin-sdk/testing", replacement: fileURLToPath(new URL("../../packages/plugin-sdk/src/testing/index.ts", import.meta.url)) },
      { find: "@get-bb/plugin-sdk", replacement: fileURLToPath(new URL("../../packages/plugin-sdk/src/index.ts", import.meta.url)) },
    ],
  },
  test: {
    silent: "passed-only",
    testTimeout: 15_000,
    name: "bb-plugin-tyria-projects",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
