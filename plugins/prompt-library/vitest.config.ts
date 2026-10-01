import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
  // oxlint-disable-next-line bb/forkable-plugin-imports
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: { tsconfigPaths: true },
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-bb--prompt-library",
      include: ["**/*.test.{ts,tsx}"],
    }),
  },
});
