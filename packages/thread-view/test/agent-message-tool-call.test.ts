import { describe, expect, it } from "vitest";
import { parseAgentMessageToolCall } from "../src/agent-message-tool-call.js";

describe("parseAgentMessageToolCall", () => {
  it("reads the recipient and message of a bb thread message call", () => {
    expect(
      parseAgentMessageToolCall({
        toolName: "bb:bb_thread_message",
        toolArgs: { threadId: "thr_worker", message: "Is it ready?" },
      }),
    ).toEqual({ threadId: "thr_worker", message: "Is it ready?" });
  });

  it.each([
    [
      "another bb tool",
      "bb:bb_workflow_run",
      { threadId: "thr_worker", message: "hi" },
    ],
    [
      "a same-named tool on another server",
      "mcp:bb_thread_message",
      { threadId: "thr_worker", message: "hi" },
    ],
    ["a call without a recipient", "bb:bb_thread_message", { message: "hi" }],
    [
      "a call with a blank recipient",
      "bb:bb_thread_message",
      { threadId: "", message: "hi" },
    ],
    ["a call without arguments", "bb:bb_thread_message", null],
  ])("ignores %s", (_case, toolName, toolArgs) => {
    expect(parseAgentMessageToolCall({ toolName, toolArgs })).toBeNull();
  });
});
