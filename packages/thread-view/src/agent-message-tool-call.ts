import type { JsonObject } from "@bb/domain";
import { z } from "zod";

const AGENT_MESSAGE_TOOL_NAME = "bb:bb_thread_message";

const agentMessageToolCallSchema = z.object({
  threadId: z.string().min(1),
  message: z.string(),
});

export type AgentMessageToolCall = z.infer<typeof agentMessageToolCallSchema>;

interface ToolCall {
  toolArgs: JsonObject | null;
  toolName: string;
}

export function parseAgentMessageToolCall({
  toolArgs,
  toolName,
}: ToolCall): AgentMessageToolCall | null {
  if (toolName !== AGENT_MESSAGE_TOOL_NAME) {
    return null;
  }
  const parsed = agentMessageToolCallSchema.safeParse(toolArgs);
  return parsed.success ? parsed.data : null;
}
