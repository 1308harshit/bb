import { createPromptHistoryEntry } from "@bb/db";
import { promptHistorySearchResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public prompt history search route", () => {
  it("returns matching entries with their project and thread locations", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, { projectId: project.id });
      const entry = createPromptHistoryEntry(harness.deps.db, {
        projectId: project.id,
        threadId: thread.id,
        scope: "thread",
        requestSequence: 1,
        input: textInput("Investigate auth flow"),
        createdAt: 10,
      });

      const response = await harness.app.request(
        "/api/v1/prompt-history/search?scope=global&query=AUTH",
      );

      expect(response.status).toBe(200);
      expect(
        promptHistorySearchResponseSchema.parse(await readJson(response)),
      ).toEqual([
        {
          id: entry.id,
          createdAt: 10,
          input: textInput("Investigate auth flow"),
          projectId: project.id,
          threadId: thread.id,
        },
      ]);

      const projectResponse = await harness.app.request(
        `/api/v1/prompt-history/search?scope=project&projectId=${project.id}`,
      );
      const threadResponse = await harness.app.request(
        `/api/v1/prompt-history/search?scope=thread&threadId=${thread.id}`,
      );
      expect(projectResponse.status).toBe(200);
      expect(threadResponse.status).toBe(200);
    });
  });

  it("validates scope parameters and the limit", async () => {
    await withTestHarness(async (harness) => {
      const urls = [
        "/api/v1/prompt-history/search",
        "/api/v1/prompt-history/search?scope=project",
        "/api/v1/prompt-history/search?scope=thread",
        "/api/v1/prompt-history/search?scope=global&projectId=proj_1",
        "/api/v1/prompt-history/search?scope=unknown",
        "/api/v1/prompt-history/search?scope=project&projectId=proj_1&threadId=thr_1",
        "/api/v1/prompt-history/search?scope=global&limit=bad",
        "/api/v1/prompt-history/search?scope=global&limit=0",
      ];

      for (const url of urls) {
        const response = await harness.app.request(url);
        expect(response.status, url).toBe(400);
      }
    });
  });
});
