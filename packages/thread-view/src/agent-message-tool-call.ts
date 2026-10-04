import { rawThreadIdSchema, type JsonObject } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import { z } from "zod";

const AGENT_MESSAGE_TOOL_NAME = "bb:bb_thread_message";
const AGENT_NO_REPLY_TEXT = "[no reply]";

const agentMessageToolCallSchema = z.object({
  threadId: rawThreadIdSchema,
  message: z.string(),
});

export type AgentMessageToolCall = z.infer<typeof agentMessageToolCallSchema>;

interface ToolCall {
  status: string;
  toolArgs: JsonObject | null;
  toolName: string;
}

export function parseAgentMessageToolCall({
  status,
  toolArgs,
  toolName,
}: ToolCall): AgentMessageToolCall | null {
  if (
    toolName !== AGENT_MESSAGE_TOOL_NAME ||
    (status !== "pending" && status !== "completed")
  ) {
    return null;
  }
  const parsed = agentMessageToolCallSchema.safeParse(toolArgs);
  return parsed.success ? parsed.data : null;
}

export function isAgentNoReplyMessage(row: TimelineRow): boolean {
  return (
    row.kind === "conversation" &&
    row.role === "assistant" &&
    row.text.trim() === AGENT_NO_REPLY_TEXT
  );
}
