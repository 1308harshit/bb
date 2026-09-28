import { describe, expect, it, vi } from "vitest";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerHistoryCommands } from "../../commands/history.js";

describe("bb history command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerHistoryCommands(program, () => "http://server");

  it("searches global prompt history by default", async () => {
    const search = vi.fn(async () => []);
    stubServerApi({ "v1.prompt-history.search.$get": search });

    await runCommand(["history", "search", "auth flow", "--json"], register);

    expect(search).toHaveBeenCalledWith({
      query: { scope: "global", query: "auth flow" },
    });
    expect(console.log).toHaveBeenCalledWith("[]");
  });

  it("searches a selected project or thread", async () => {
    const search = vi.fn(async () => []);
    stubServerApi({ "v1.prompt-history.search.$get": search });

    await runCommand(
      ["history", "search", "project prompt", "--project", "proj_1"],
      register,
    );
    await runCommand(
      ["history", "search", "thread prompt", "--thread", "thr_1"],
      register,
    );

    expect(search).toHaveBeenNthCalledWith(1, {
      query: {
        scope: "project",
        projectId: "proj_1",
        query: "project prompt",
      },
    });
    expect(search).toHaveBeenNthCalledWith(2, {
      query: {
        scope: "thread",
        threadId: "thr_1",
        query: "thread prompt",
      },
    });
  });

  it("rejects multiple scope selectors", async () => {
    const search = vi.fn(async () => []);
    stubServerApi({ "v1.prompt-history.search.$get": search });

    await expect(
      runCommand(
        [
          "history",
          "search",
          "prompt",
          "--project",
          "proj_1",
          "--thread",
          "thr_1",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      "Error: --project and --thread are mutually exclusive.",
    );
    expect(search).not.toHaveBeenCalled();
  });
});
