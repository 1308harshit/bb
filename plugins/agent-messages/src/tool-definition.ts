import type { PluginRowPresentation } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const TOOL_NAME = "bb_thread_message";

export const toolParameters = z.object({
  threadId: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
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
Only message threads that messaged you or that the user asked you to contact, and do not answer messages that need no reply. Use \`${TOOL_NAME}\` instead of \`bb thread tell\` unless you need one of its options, such as \`--plan\` or \`--mode queue\`.
The user's timeline shows messages you send as "Message to <thread>" and messages you receive as "Message from <thread>". Do not tell the user that you sent or received one, and do not repeat its content; add only your own conclusions or next steps.`;

export const SENT_NOTE =
  'The user\'s timeline now shows this as "Message to <thread>". Do not say you sent it or repeat it. If you have nothing else for the user, end your turn without writing anything.';

export const TOOL_PRESENTATION: PluginRowPresentation = {
  label: { pending: "Messaging a thread", completed: "Messaged a thread" },
  icon: { glyph: "Sent" },
};
