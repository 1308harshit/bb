import type {
  BbPluginApi,
  PluginAgentToolContext,
  PluginAgentToolResult,
} from "@get-bb/plugin-sdk";
import {
  TOOL_DESCRIPTION,
  TOOL_INSTRUCTIONS,
  TOOL_NAME,
  TOOL_PRESENTATION,
  toolParameters,
  type ToolInput,
} from "./tool-definition.js";

const SIDE_CHAT_PLUGIN_ID = "side-chat";

interface Recipient {
  originKind: string | null;
  originPluginId: string | null;
  visibility: string;
}

function isSideChat(recipient: Recipient): boolean {
  return (
    recipient.originKind === "fork" &&
    recipient.originPluginId === SIDE_CHAT_PLUGIN_ID &&
    recipient.visibility === "hidden"
  );
}

function errorResult(text: string): PluginAgentToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

async function sendThreadMessage(
  bb: BbPluginApi,
  { threadId, message }: ToolInput,
  ctx: PluginAgentToolContext,
): Promise<PluginAgentToolResult> {
  if (threadId === ctx.threadId) {
    return errorResult(
      "That is your own thread. Address the user in your normal response instead.",
    );
  }
  try {
    if (isSideChat(await bb.sdk.threads.get({ threadId }))) {
      return errorResult(
        "That thread is a side chat; the user forwarded its message to you. Answer the user in your normal response instead.",
      );
    }
    const { delivery } = await bb.sdk.threads.send({
      threadId,
      input: [{ type: "text", text: message, mentions: [] }],
      mode: "steer-if-active",
      senderThreadId: ctx.threadId,
    });
    return delivery === "queued"
      ? `Queued for ${threadId}; it is delivered once that thread can take it.`
      : `Delivered to ${threadId}.`;
  } catch (error) {
    return errorResult(
      `The message was not delivered: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export default function plugin(bb: BbPluginApi) {
  bb.agents.registerTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    instructions: TOOL_INSTRUCTIONS,
    presentation: TOOL_PRESENTATION,
    parameters: toolParameters,
    execute: (input, ctx) => sendThreadMessage(bb, input, ctx),
  });
}
