import type { PromptInput } from "@bb/domain";

export function withQueuedMessageDeliveryContext<
  T extends { input: PromptInput[]; inputGroups?: PromptInput[][] },
>(
  prompt: T,
  rows: readonly { id: string; sendAt: number | null }[] | null,
  sendNow: boolean,
): T {
  const context: PromptInput[] = (rows ?? [])
    .filter((row) => row.sendAt !== null)
    .map((row) => ({
      type: "text",
      mentions: [],
      visibility: "agent-only",
      text: `<queued_message_delivery>\n${JSON.stringify({
        queuedMessageId: row.id,
        sendAt: row.sendAt,
        reason: sendNow ? "explicit-send" : "automatic",
      })}\n</queued_message_delivery>`,
    }));
  if (context.length === 0) return prompt;
  return {
    ...prompt,
    input: [...prompt.input, ...context],
    ...(prompt.inputGroups !== undefined
      ? {
          inputGroups: [
            ...prompt.inputGroups.slice(0, -1),
            [...(prompt.inputGroups.at(-1) ?? []), ...context],
          ],
        }
      : {}),
  };
}
