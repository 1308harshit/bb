import { describe, expect, it } from "vitest";
import { parseAgentMessageToolCall } from "../src/agent-message-tool-call.js";

describe("parseAgentMessageToolCall", () => {
  it("reads the recipient and message of a bb thread message call", () => {
    expect(
      parseAgentMessageToolCall({
        toolName: "bb:bb_thread_message",
        toolArgs: { threadId: "thr_wrkr234567", message: "Is it ready?" },
      }),
    ).toEqual({ threadId: "thr_wrkr234567", message: "Is it ready?" });
  });

  it.each([
    [
      "a same-named tool on another server",
      "mcp:bb_thread_message",
      { threadId: "thr_wrkr234567", message: "hi" },
    ],
    [
      "a call with a path-like recipient",
      "bb:bb_thread_message",
      { threadId: "../hosts/host_x/suspend#", message: "hi" },
    ],
    ["a call without arguments", "bb:bb_thread_message", null],
  ])("ignores %s", (_case, toolName, toolArgs) => {
    expect(parseAgentMessageToolCall({ toolName, toolArgs })).toBeNull();
  });
});
