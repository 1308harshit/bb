import { getEnvironment, getThread, threads } from "@bb/db";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { eq } from "drizzle-orm";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { toEnvironmentResponse } from "../../../src/services/environments/environment-response.js";
import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

it("refuses manual cleanup of an attached project checkout", async () =>
  withTestHarness(async (harness) => {
    const directory = await mkdtemp(join(tmpdir(), "attached-checkout-"));
    try {
      const sentinel = join(directory, "uncommitted.txt");
      await writeFile(sentinel, "keep this file");
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: directory,
      });
      const fake = createFakePluginHost({
        pluginId: "environment-project-checkout",
      });
      const module = z
        .object({
          default: z.custom<(bb: BbPluginApi) => Promise<void>>(
            (value) => typeof value === "function",
          ),
        })
        .parse(
          await import(
            new URL(
              "../../../../../plugins/environment-project-checkout/server.ts",
              import.meta.url,
            ).href
          ),
        );
      await module.default(fake.bb);
      const provider =
        fake.harness.registrations.environmentProviders.get("project-checkout");
      if (provider === undefined) throw new Error("Missing checkout provider");
      const record = { pluginId: "environment-project-checkout", provider };
      setPluginEnvironmentProviderBridge({
        listEnvironmentProviders: () => [record],
        getEnvironmentProvider: (id) =>
          id === provider.id ? record : undefined,
        invokeProvider: async (_id, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: directory,
        providerOwnsPath: false,
        environmentProviderId: provider.id,
        environmentProviderPluginId: record.pluginId,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "idle",
        environmentId: environment.id,
      });
      harness.db
        .update(threads)
        .set({ archivedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();
      expect(toEnvironmentResponse(harness.db, environment)).toMatchObject({
        managed: false,
        workspaceProvisionType: "unmanaged",
        lifecycle: { phase: "active", teardown: null },
      });
      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/cleanup`,
        { method: "POST" },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        message: "Environment is not provider-managed",
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        path: directory,
        status: "ready",
        retireAt: null,
        teardownStatus: null,
      });
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        environment.id,
      );
      expect(await readFile(sentinel, "utf8")).toBe("keep this file");
      expect(fake.harness.experimental_hostRpcCalls).toHaveLength(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }));
