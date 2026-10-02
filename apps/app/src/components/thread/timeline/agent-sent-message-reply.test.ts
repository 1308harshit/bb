import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { findAgentSentMessageReply } from "./agent-sent-message-reply.js";

function base(id: string, turnId: string | null, createdAt: number) {
  return {
    id,
    threadId: "thr_worker",
    turnId,
    sourceSeqStart: createdAt,
    sourceSeqEnd: createdAt,
    startedAt: createdAt,
    createdAt,
  };
}

function received(
  id: string,
  turnId: string,
  createdAt: number,
  body: string,
  sender = "thr_manager",
): TimelineRow {
  return {
    ...base(id, turnId, createdAt),
    kind: "conversation",
    role: "user",
    text: `[bb message from thread:${sender}]\n\n${body}`,
    attachments: null,
    initiator: "agent",
    senderThreadId: sender,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
    mentions: [],
  };
}

function answer(
  id: string,
  turnId: string,
  createdAt: number,
  text: string,
): TimelineRow {
  return {
    ...base(id, turnId, createdAt),
    kind: "conversation",
    role: "assistant",
    text,
    attachments: null,
    turnRequest: null,
  };
}

const recipientRows: TimelineRow[] = [
  received("m1", "turn_1", 1_000, "First question?"),
  answer("r1a", "turn_1", 1_500, "Let me check."),
  answer("r1b", "turn_1", 2_000, "First answer."),
  received("other", "turn_2", 3_000, "Unrelated", "thr_other"),
  answer("r2", "turn_2", 3_500, "Other answer."),
  received("m3", "turn_3", 10_000, "Second   question?"),
  answer("r3", "turn_3", 10_500, "Second answer."),
];

describe("findAgentSentMessageReply", () => {
  it("matches the sent text and returns the turn's latest answer", () => {
    const result = findAgentSentMessageReply({
      message: "Second question?",
      recipientRows,
      senderThreadId: "thr_manager",
      sentAt: 9_000,
    });

    expect(result?.receivedMessageRowId).toBe("m3");
    expect(result?.reply?.id).toBe("r3");
  });

  it("falls back to the next message from this sender when text is unknown", () => {
    const result = findAgentSentMessageReply({
      message: null,
      recipientRows,
      senderThreadId: "thr_manager",
      sentAt: 900,
    });

    expect(result?.reply?.id).toBe("r1b");
  });

  it("returns no reply while the recipient has not answered", () => {
    const result = findAgentSentMessageReply({
      message: "Unanswered?",
      recipientRows: [received("m9", "turn_9", 20_000, "Unanswered?")],
      senderThreadId: "thr_manager",
      sentAt: 19_000,
    });

    expect(result).toEqual({ reply: null, receivedMessageRowId: "m9" });
  });

  it("ignores messages from other senders", () => {
    const result = findAgentSentMessageReply({
      message: "Unrelated",
      recipientRows,
      senderThreadId: "thr_nobody",
      sentAt: 2_500,
    });

    expect(result).toBeNull();
  });
});
