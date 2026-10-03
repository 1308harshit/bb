import type { PluginRowPresentation } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const TOOL_NAME = "bb_thread_message";

export const toolParameters = z.object({
  threadId: z
    .string()
    .min(1)
    .describe("ID of the thread to message, such as thr_abc123."),
  message: z.string().trim().min(1).describe("The message, in Markdown."),
});

export type ToolInput = z.infer<typeof toolParameters>;

export const TOOL_DESCRIPTION =
  "Send a message to the agent working in another bb thread. It arrives there as a message from this thread, and that agent can answer with this same tool. The user never receives it; address the user in your normal response.";

export const TOOL_INSTRUCTIONS = `Messages from other agents begin with \`[bb message from thread:<thread id>]\`. Your normal response is for the user, so decide who each answer is for:
- The agent that messaged you: send the answer with \`${TOOL_NAME}\`, using the thread ID from the prefix.
- The user: write a normal response.
- Both: do both.
Only message threads that messaged you or that the user asked you to contact, and do not answer messages that need no reply.`;

export const TOOL_PRESENTATION: PluginRowPresentation = {
  label: { pending: "Messaging a thread", completed: "Messaged a thread" },
  icon: { glyph: "Sent" },
};
