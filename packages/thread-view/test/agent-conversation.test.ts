import { describe, expect, it } from "vitest";
import type {
  TimelineConversationRow,
  TimelineConversationTurnRequest,
  TimelineToolWorkRow,
} from "@bb/server-contract";
import type { ThreadTimelineViewRow } from "../src/timeline-view.js";
import { groupAgentConversations } from "../src/agent-conversation.js";
import { buildTimelineRowTitle } from "../src/timeline-row-title.js";

const TITLE_OPTIONS = { summaryStyle: "bundle", workStyle: "default" } as const;
const MANAGER = "thr_mngr234567";
const notExcluded = (): boolean => false;
let seq = 0;

function base(id: string, turnId: string | null) {
  seq += 1;
  return {
    id,
    threadId: "thr_wrkr234567",
    turnId,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
  };
}

interface UserOptions {
  from?: string | null;
  request?: Partial<TimelineConversationTurnRequest>;
}

function user(
  id: string,
  turnId: string,
  options: UserOptions = {},
): TimelineConversationRow {
  const from = options.from === undefined ? MANAGER : options.from;
  return {
    ...base(id, turnId),
    kind: "conversation",
    role: "user",
    text: `[bb message from thread:${from}]\n\n${id}`,
    attachments: null,
    initiator: from === null ? "user" : "agent",
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

function sent(id: string, turnId: string): TimelineToolWorkRow {
  return {
    ...base(id, turnId),
    kind: "work",
    workKind: "tool",
    status: "completed",
    callId: id,
    toolName: "bb:bb_thread_message",
    toolArgs: { threadId: MANAGER, message: id },
    output: "Delivered.",
    completedAt: seq,
    approvalStatus: null,
  };
}

function reply(id: string, turnId: string): TimelineConversationRow {
  return {
    ...base(id, turnId),
    kind: "conversation",
    role: "assistant",
    text: id,
    attachments: null,
    turnRequest: null,
  };
}

function exchange(n: number): ThreadTimelineViewRow[] {
  const turnId = `turn_${n}`;
  return [user(`u${n}`, turnId), sent(`s${n}`, turnId), reply(`a${n}`, turnId)];
}

function grouped(
  rows: ThreadTimelineViewRow[],
  options: { activeTurnId?: string; pinned?: string[] } = {},
): string[] {
  return groupAgentConversations({
    activeTurnId: options.activeTurnId ?? null,
    isExcludedSender: notExcluded,
    pinnedRowIds: new Set(options.pinned),
    rows,
  }).map((row) =>
    row.kind === "agent-conversation"
      ? `group(${row.children.map((child) => child.id).join(",")})`
      : row.id,
  );
}

const ids = (rows: ThreadTimelineViewRow[]) => rows.map((row) => row.id);

describe("groupAgentConversations", () => {
  it("collapses two or more settled exchanges and counts their agent messages", () => {
    const rows = [
      user("start", "turn_0", { from: null }),
      ...exchange(1),
      ...exchange(2),
      user("end", "turn_9", { from: null }),
    ];

    const result = groupAgentConversations({
      activeTurnId: null,
      isExcludedSender: notExcluded,
      pinnedRowIds: new Set(),
      rows,
    });

    expect(grouped(rows)).toEqual(["start", "group(u1,s1,a1,u2,s2,a2)", "end"]);
    expect(
      result[1] && buildTimelineRowTitle(result[1], TITLE_OPTIONS).plain,
    ).toBe("Agent conversation 4 messages");
  });

  it("leaves a single exchange ungrouped", () => {
    const rows = [
      ...exchange(1),
      user("user", "turn_5", { from: null }),
      ...exchange(2),
    ];

    expect(grouped(rows)).toEqual(ids(rows));
  });

  it("keeps the running exchange out", () => {
    const rows = [...exchange(1), ...exchange(2)];

    expect(grouped(rows, { activeTurnId: "turn_2" })).toEqual(ids(rows));
  });

  it("does not group pending messages, user-steered exchanges, or pinned runs", () => {
    const pending = [
      ...exchange(1),
      user("queued", "turn_2", { request: { status: "pending" } }),
      ...exchange(3),
      user("u4", "turn_4"),
      reply("a4", "turn_4"),
      user("steer", "turn_4", { from: null, request: { kind: "steer" } }),
    ];
    const pinned = [...exchange(5), ...exchange(6)];

    expect(grouped(pending)).toEqual(ids(pending));
    expect(grouped(pinned, { pinned: ["a6"] })).toEqual(ids(pinned));
  });
});
