import { describe, expect, it } from "vitest";
import type { ThreadTimelineViewRow } from "@bb/thread-view";
import type { TimelineRowStatus } from "@bb/server-contract";
import {
  collectAgentReplyRecipients,
  groupAgentExchanges,
  type AgentExchangeListEntry,
} from "./agent-exchanges.js";

const notExcluded = (): boolean => false;
let seq = 0;

function base(id: string, turnId: string | null) {
  seq += 1;
  return {
    id,
    threadId: "thr_self",
    turnId,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
  };
}

function userMessage(
  id: string,
  turnId: string | null,
  sender: string | null,
): ThreadTimelineViewRow {
  return {
    ...base(id, turnId),
    kind: "conversation",
    role: "user",
    text: "hello",
    attachments: null,
    initiator: sender === null ? "user" : "agent",
    senderThreadId: sender,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: {
      isGrouped: false,
      kind: "message",
      status: "accepted",
    },
    mentions: [],
  };
}

function reply(id: string, turnId: string): ThreadTimelineViewRow {
  return {
    ...base(id, turnId),
    kind: "conversation",
    role: "assistant",
    text: "reply",
    attachments: null,
    turnRequest: null,
  };
}

function turn(
  id: string,
  turnId: string,
  status: TimelineRowStatus = "completed",
  children: ThreadTimelineViewRow[] | null = null,
): ThreadTimelineViewRow {
  return {
    ...base(id, turnId),
    kind: "turn",
    turnId,
    status,
    summaryCount: 1,
    completedAt: status === "pending" ? null : seq,
    children,
  };
}

function exchange(
  n: number,
  sender: string,
  status: TimelineRowStatus = "completed",
) {
  const turnId = `turn_${n}`;
  return [
    userMessage(`u${n}`, turnId, sender),
    turn(`t${n}`, turnId, status),
    reply(`a${n}`, turnId),
  ];
}

function entryShape(entries: AgentExchangeListEntry[]): string[] {
  return entries.map((entry) =>
    entry.kind === "row"
      ? entry.row.id
      : `group(${entry.group.rows.map((row) => row.id).join(",")})`,
  );
}

describe("collectAgentReplyRecipients", () => {
  it("addresses assistant replies in agent-initiated turns to the sender", () => {
    const rows = [
      ...exchange(1, "thr_manager"),
      userMessage("u2", "turn_2", null),
      reply("a2", "turn_2"),
    ];

    const recipients = collectAgentReplyRecipients(rows, notExcluded);

    expect(recipients.get("a1")).toBe("thr_manager");
    expect(recipients.has("a2")).toBe(false);
  });

  it("stops addressing the sender once the user steers the turn", () => {
    const rows = [
      userMessage("u1", "turn_1", "thr_manager"),
      turn("t1", "turn_1", "pending", [
        reply("a1", "turn_1"),
        userMessage("steer", "turn_1", null),
        reply("a2", "turn_1"),
      ]),
    ];

    const recipients = collectAgentReplyRecipients(rows, notExcluded);

    expect(recipients.get("a1")).toBe("thr_manager");
    expect(recipients.has("a2")).toBe(false);
  });

  it("ignores excluded senders such as side chats", () => {
    const rows = exchange(1, "thr_side_chat");

    const recipients = collectAgentReplyRecipients(
      rows,
      (sender) => sender === "thr_side_chat",
    );

    expect(recipients.size).toBe(0);
  });
});

describe("groupAgentExchanges", () => {
  it("collapses consecutive settled agent exchanges", () => {
    const rows = [
      userMessage("start", "turn_0", null),
      ...exchange(1, "thr_manager"),
      ...exchange(2, "thr_manager"),
      userMessage("end", "turn_9", null),
    ];

    const entries = groupAgentExchanges({
      isExcludedSender: notExcluded,
      pinnedRowIds: new Set(),
      rows,
    });

    expect(entryShape(entries)).toEqual([
      "start",
      "group(u1,t1,a1,u2,t2,a2)",
      "end",
    ]);
    const group = entries[1];
    expect(group?.kind === "agent-exchanges" && group.group.exchangeCount).toBe(
      2,
    );
  });

  it("leaves a single exchange and the running exchange ungrouped", () => {
    const rows = [
      ...exchange(1, "thr_manager"),
      userMessage("user", "turn_5", null),
      ...exchange(2, "thr_manager"),
      ...exchange(3, "thr_manager", "pending"),
    ];

    const entries = groupAgentExchanges({
      isExcludedSender: notExcluded,
      pinnedRowIds: new Set(),
      rows,
    });

    expect(entryShape(entries)).toEqual(rows.map((row) => row.id));
  });

  it("keeps a run ungrouped when it contains a pinned row", () => {
    const rows = [...exchange(1, "thr_a"), ...exchange(2, "thr_b")];

    const entries = groupAgentExchanges({
      isExcludedSender: notExcluded,
      pinnedRowIds: new Set(["a2"]),
      rows,
    });

    expect(entryShape(entries)).toEqual(rows.map((row) => row.id));
  });
});
