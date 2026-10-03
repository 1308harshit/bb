import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { TOOL_NAME } from "./tool-definition.js";

function createHost(
  send: () => Promise<unknown> = async () => ({ ok: true, delivery: "sent" }),
): FakePluginHost {
  const host = createFakePluginHost({
    pluginId: "bb--agent-messages",
    sdk: { threads: { send } },
  });
  plugin(host.bb);
  return host;
}

const SENDER = { threadId: "thr_sender" };

describe("bb_thread_message", () => {
  it("delivers the message as sent by the calling thread", async () => {
    const host = createHost();

    const result = await host.harness.callAgentTool(
      TOOL_NAME,
      { threadId: "thr_worker", message: "Is the cache TTL the cause?" },
      SENDER,
    );

    expect(result).toBe("Delivered to thr_worker.");
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([
      [
        {
          threadId: "thr_worker",
          input: [
            {
              type: "text",
              text: "Is the cache TTL the cause?",
              mentions: [],
            },
          ],
          mode: "steer-if-active",
          senderThreadId: "thr_sender",
        },
      ],
    ]);
  });

  it("tells the agent when the recipient queued the message", async () => {
    const host = createHost(async () => ({ ok: true, delivery: "queued" }));

    const result = await host.harness.callAgentTool(
      TOOL_NAME,
      { threadId: "thr_worker", message: "Ready?" },
      SENDER,
    );

    expect(result).toBe(
      "Queued for thr_worker; it is delivered once that thread can take it.",
    );
  });

  it("refuses to message the calling thread", async () => {
    const host = createHost();

    const result = await host.harness.callAgentTool(
      TOOL_NAME,
      { threadId: "thr_sender", message: "Done." },
      SENDER,
    );

    expect(result).toMatchObject({ isError: true });
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("reports a failed delivery as an error", async () => {
    const host = createHost(async () => {
      throw new Error("Thread is archived");
    });

    const result = await host.harness.callAgentTool(
      TOOL_NAME,
      { threadId: "thr_worker", message: "Ready?" },
      SENDER,
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "The message was not delivered: Thread is archived",
        },
      ],
      isError: true,
    });
  });

  it("rejects a blank message before sending", async () => {
    const host = createHost();

    await expect(
      host.harness.callAgentTool(
        TOOL_NAME,
        { threadId: "thr_worker", message: "  " },
        SENDER,
      ),
    ).rejects.toThrow(/arguments are invalid/);
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
  });
});
