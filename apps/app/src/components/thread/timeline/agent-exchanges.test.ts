import { describe, expect, it } from "vitest";
import type { ThreadTimelineViewRow } from "@bb/thread-view";
import type {
  TimelineConversationRow,
  TimelineConversationTurnRequest,
} from "@bb/server-contract";
import {
  collectAgentReplyRecipients,
  findAgentSentMessageReply,
  groupAgentExchanges,
} from "./agent-exchanges.js";

const MANAGER = "thr_manager";
const notExcluded = (): boolean => false;
let seq = 0;

function base(id: string, turnId: string | null, createdAt = ++seq) {
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

interface UserOptions {
  at?: number;
  from?: string | null;
  initiator?: "user" | "agent" | "system";
  request?: Partial<TimelineConversationTurnRequest>;
  text?: string;
}

function user(
  id: string,
  turnId: string,
  options: UserOptions = {},
): TimelineConversationRow {
  const from = options.from === undefined ? MANAGER : options.from;
  return {
    ...base(id, turnId, options.at),
    kind: "conversation",
    role: "user",
    text: `[bb message from thread:${from}]\n\n${options.text ?? id}`,
    attachments: null,
    initiator: options.initiator ?? (from === null ? "user" : "agent"),
    senderThreadId: from,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: {
      isGrouped: false,
      kind: "message",
      status: "accepted",
      ...options.request,
    },
    mentions: [],
  };
}

function reply(
  id: string,
  turnId: string,
  at?: number,
): TimelineConversationRow {
  return {
    ...base(id, turnId, at),
    kind: "conversation",
    role: "assistant",
    text: id,
    attachments: null,
    turnRequest: null,
  };
}

function exchange(n: number): ThreadTimelineViewRow[] {
  const turnId = `turn_${n}`;
  return [
    user(`u${n}`, turnId),
    {
      ...base(`t${n}`, turnId),
      kind: "turn",
      turnId,
      status: "completed",
      summaryCount: 1,
      completedAt: seq,
      children: null,
    },
    reply(`a${n}`, turnId),
  ];
}

function grouped(
  rows: ThreadTimelineViewRow[],
  options: { activeTurnId?: string; pinned?: string[] } = {},
): string[] {
  return groupAgentExchanges({
    activeTurnId: options.activeTurnId ?? null,
    isExcludedSender: notExcluded,
    pinnedRowIds: new Set(options.pinned),
    rows,
  }).map((entry) =>
    entry.kind === "row"
      ? entry.row.id
      : `group(${entry.group.rows.map((row) => row.id).join(",")})`,
  );
}

const ids = (rows: ThreadTimelineViewRow[]) => rows.map((row) => row.id);
const STEER = { kind: "steer" } as const;

describe("collectAgentReplyRecipients", () => {
  it("addresses answers in agent-started turns until the user steers", () => {
    const rows = [
      ...exchange(1),
      user("u2", "turn_2"),
      reply("a2", "turn_2"),
      user("steer", "turn_2", { from: null, request: STEER }),
      reply("a2b", "turn_2"),
      user("u3", "turn_3", { from: null }),
      reply("a3", "turn_3"),
    ];

    expect([...collectAgentReplyRecipients(rows, notExcluded)]).toEqual([
      ["a1", MANAGER],
      ["a2", MANAGER],
    ]);
  });

  it("ignores agent steers into a user turn but keeps attribution across system steers", () => {
    const rows = [
      user("u1", "turn_1", { from: null }),
      user("agent_steer", "turn_1", { request: STEER }),
      reply("a1", "turn_1"),
      user("u2", "turn_2"),
      user("system", "turn_2", {
        from: null,
        initiator: "system",
        request: STEER,
      }),
      reply("a2", "turn_2"),
    ];

    expect([...collectAgentReplyRecipients(rows, notExcluded)]).toEqual([
      ["a2", MANAGER],
    ]);
  });

  it("ignores excluded senders such as side chats", () => {
    expect(
      collectAgentReplyRecipients(exchange(1), (id) => id === MANAGER).size,
    ).toBe(0);
  });
});

describe("groupAgentExchanges", () => {
  it("collapses two or more settled exchanges between other rows", () => {
    const rows = [
      user("start", "turn_0", { from: null }),
      ...exchange(1),
      ...exchange(2),
      user("end", "turn_9", { from: null }),
    ];

    expect(grouped(rows)).toEqual(["start", "group(u1,t1,a1,u2,t2,a2)", "end"]);
  });

  it("leaves a single exchange ungrouped", () => {
    const rows = [
      ...exchange(1),
      user("user", "turn_5", { from: null }),
      ...exchange(2),
    ];

    expect(grouped(rows)).toEqual(ids(rows));
  });

  it("keeps the running exchange out even though live turns have no turn row", () => {
    const rows = [...exchange(1), user("u2", "turn_2"), reply("a2", "turn_2")];

    expect(grouped(rows, { activeTurnId: "turn_2" })).toEqual(ids(rows));
    expect(grouped(rows)).toEqual(["group(u1,t1,a1,u2,a2)"]);
  });

  it("does not group pending messages, user-steered exchanges or pinned runs", () => {
    const pending = [
      ...exchange(1),
      user("queued", "turn_2", { request: { status: "pending" } }),
      ...exchange(3),
      user("u4", "turn_4"),
      reply("a4", "turn_4"),
      user("steer", "turn_4", { from: null, request: STEER }),
    ];
    const pinned = [...exchange(5), ...exchange(6)];

    expect(grouped(pending)).toEqual(ids(pending));
    expect(grouped(pinned, { pinned: ["a6"] })).toEqual(ids(pinned));
  });
});

describe("findAgentSentMessageReply", () => {
  const recipientRows = [
    user("m1", "turn_1", { text: "First?", at: 1_000 }),
    reply("r1a", "turn_1", 1_500),
    reply("r1b", "turn_1", 2_000),
    user("other", "turn_2", { from: "thr_other", text: "Other", at: 3_000 }),
    reply("r2", "turn_2", 3_500),
    user("m3", "turn_3", { text: "Second   question?", at: 10_000 }),
    reply("r3", "turn_3", 10_500),
    user("m4", "turn_4", { text: "Unanswered?", at: 20_000 }),
  ];
  const find = (message: string | null, sentAt: number, sender = MANAGER) =>
    findAgentSentMessageReply({
      message,
      recipientRows,
      senderThreadId: sender,
      sentAt,
    })?.id ?? null;

  it("matches the sent text and returns that turn's latest answer", () => {
    expect(find("Second question?", 9_000)).toBe("r3");
  });

  it("falls back to the next message from this sender when the text is unknown", () => {
    expect(find(null, 900)).toBe("r1b");
  });

  it("returns nothing while unanswered or for other senders", () => {
    expect(find("Unanswered?", 19_000)).toBeNull();
    expect(find("Other", 2_500, "thr_nobody")).toBeNull();
  });
});
