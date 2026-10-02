import type {
  TimelineConversationRow,
  TimelineRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import { parseAgentMessageEnvelope } from "@bb/thread-view";

const SENT_AT_CLOCK_SKEW_MS = 5_000;
const TEXT_MATCH_LOOKBACK_MS = 60_000;

type AssistantConversationRow = Extract<
  TimelineConversationRow,
  { role: "assistant" }
>;

interface FindAgentSentMessageReplyArgs {
  message: string | null;
  recipientRows: readonly TimelineRow[];
  senderThreadId: string;
  sentAt: number;
}

export interface AgentSentMessageReply {
  reply: AssistantConversationRow | null;
  receivedMessageRowId: string;
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function receivedMessageBody(row: TimelineUserConversationRow): string {
  const envelope = parseAgentMessageEnvelope(row.text);
  return envelope === null ? row.text : row.text.slice(envelope.bodyStart);
}

function isReceivedAgentMessage(
  row: TimelineRow,
  senderThreadId: string,
): row is TimelineUserConversationRow {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.initiator === "agent" &&
    row.senderThreadId === senderThreadId
  );
}

function findReceivedMessage({
  message,
  recipientRows,
  senderThreadId,
  sentAt,
}: FindAgentSentMessageReplyArgs): TimelineUserConversationRow | null {
  const candidates = recipientRows.filter(
    (row): row is TimelineUserConversationRow =>
      isReceivedAgentMessage(row, senderThreadId) &&
      row.createdAt >= sentAt - TEXT_MATCH_LOOKBACK_MS,
  );
  if (message !== null) {
    const expected = normalizeMessageText(message);
    const textMatch = candidates.find(
      (row) => normalizeMessageText(receivedMessageBody(row)) === expected,
    );
    if (textMatch !== undefined) {
      return textMatch;
    }
  }
  return (
    candidates.find((row) => row.createdAt >= sentAt - SENT_AT_CLOCK_SKEW_MS) ??
    null
  );
}

export function findAgentSentMessageReply(
  args: FindAgentSentMessageReplyArgs,
): AgentSentMessageReply | null {
  const received = findReceivedMessage(args);
  if (received === null) {
    return null;
  }
  let reply: AssistantConversationRow | null = null;
  if (received.turnId !== null) {
    for (const row of args.recipientRows) {
      if (
        row.kind === "conversation" &&
        row.role === "assistant" &&
        row.turnId === received.turnId
      ) {
        reply = row;
      }
    }
  }
  return { reply, receivedMessageRowId: received.id };
}
