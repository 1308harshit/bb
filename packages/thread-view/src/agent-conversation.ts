import type { TimelineRow } from "@bb/server-contract";
import { parseAgentMessageEnvelope } from "./agent-message-envelope.js";
import type {
  ThreadTimelineViewRow,
  TimelineAgentConversationRow,
} from "./timeline-view.js";

const MIN_COLLAPSED_AGENT_EXCHANGES = 2;
const SENT_AT_CLOCK_SKEW_MS = 5_000;
const TEXT_MATCH_LOOKBACK_MS = 60_000;

export type IsExcludedAgentSender = (senderThreadId: string) => boolean;

type ConversationRow = Extract<TimelineRow, { kind: "conversation" }>;
type UserRow = Extract<ConversationRow, { role: "user" }>;
type AssistantRow = Extract<ConversationRow, { role: "assistant" }>;
type AgentMessageRow = UserRow & { senderThreadId: string; turnId: string };

interface GroupAgentConversationsArgs {
  activeTurnId: string | null;
  isExcludedSender: IsExcludedAgentSender;
  pinnedRowIds: ReadonlySet<string>;
  rows: readonly ThreadTimelineViewRow[];
}

interface FindAgentSentMessageReplyArgs {
  message: string | null;
  recipientRows: readonly TimelineRow[];
  senderThreadId: string;
  sentAt: number;
}

function isAgentMessageRow(
  row: ThreadTimelineViewRow,
  isExcludedSender: IsExcludedAgentSender,
): row is AgentMessageRow {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.initiator === "agent" &&
    row.turnRequest.kind === "message" &&
    row.turnRequest.status === "accepted" &&
    row.senderThreadId !== null &&
    row.turnId !== null &&
    !isExcludedSender(row.senderThreadId)
  );
}

function isUserAuthoredRow(row: ThreadTimelineViewRow): boolean {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.initiator === "user"
  );
}

export function collectAgentReplyRecipients(
  rows: readonly ThreadTimelineViewRow[],
  isExcludedSender: IsExcludedAgentSender,
): ReadonlyMap<string, string> {
  const recipients = new Map<string, string>();
  let current: AgentMessageRow | null = null;
  const visit = (candidateRows: readonly ThreadTimelineViewRow[]): void => {
    for (const row of candidateRows) {
      if (isAgentMessageRow(row, isExcludedSender)) {
        current = row;
      } else if (isUserAuthoredRow(row)) {
        current = null;
      } else if (
        row.kind === "conversation" &&
        row.role === "assistant" &&
        row.turnId === current?.turnId
      ) {
        recipients.set(row.id, current.senderThreadId);
      } else if (row.kind === "turn" && row.children !== null) {
        visit(row.children);
      }
    }
  };
  visit(rows);
  return recipients;
}

function readExchangeRows(
  rows: readonly ThreadTimelineViewRow[],
  first: AgentMessageRow,
  startIndex: number,
  isExcludedSender: IsExcludedAgentSender,
): { rows: ThreadTimelineViewRow[]; steeredByUser: boolean } {
  const exchangeRows: ThreadTimelineViewRow[] = [first];
  for (const row of rows.slice(startIndex + 1)) {
    if (
      row.turnId !== first.turnId ||
      isAgentMessageRow(row, isExcludedSender)
    ) {
      break;
    }
    if (isUserAuthoredRow(row)) {
      return { rows: exchangeRows, steeredByUser: true };
    }
    exchangeRows.push(row);
  }
  return { rows: exchangeRows, steeredByUser: false };
}

function agentConversationRow(
  children: ThreadTimelineViewRow[],
): TimelineAgentConversationRow | null {
  const first = children[0];
  const last = children.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  return {
    id: `agent-conversation:${first.id}`,
    threadId: first.threadId,
    turnId: null,
    sourceSeqStart: first.sourceSeqStart,
    sourceSeqEnd: last.sourceSeqEnd,
    startedAt: first.startedAt,
    createdAt: first.createdAt,
    kind: "agent-conversation",
    children,
  };
}

export function groupAgentConversations({
  activeTurnId,
  isExcludedSender,
  pinnedRowIds,
  rows,
}: GroupAgentConversationsArgs): ThreadTimelineViewRow[] {
  const entries: ThreadTimelineViewRow[] = [];
  let run: ThreadTimelineViewRow[] = [];
  let runExchangeCount = 0;
  const pushRows = (rowsToPush: readonly ThreadTimelineViewRow[]): void => {
    entries.push(...rowsToPush);
  };
  const flushRun = (): void => {
    const group =
      runExchangeCount >= MIN_COLLAPSED_AGENT_EXCHANGES &&
      !run.some((row) => pinnedRowIds.has(row.id))
        ? agentConversationRow(run)
        : null;
    if (group === null) {
      pushRows(run);
    } else {
      entries.push(group);
    }
    run = [];
    runExchangeCount = 0;
  };

  let index = 0;
  while (index < rows.length) {
    const first = rows[index];
    if (first === undefined) break;
    if (!isAgentMessageRow(first, isExcludedSender)) {
      flushRun();
      pushRows([first]);
      index += 1;
      continue;
    }
    const exchange = readExchangeRows(rows, first, index, isExcludedSender);
    index += exchange.rows.length;
    const settled =
      first.turnId !== activeTurnId &&
      !exchange.steeredByUser &&
      !exchange.rows.some((row) => "status" in row && row.status === "pending");
    if (settled) {
      run.push(...exchange.rows);
      runExchangeCount += 1;
    } else {
      flushRun();
      pushRows(exchange.rows);
    }
  }
  flushRun();
  return entries;
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function receivedMessageBody(row: UserRow): string {
  const envelope = parseAgentMessageEnvelope(row.text);
  return envelope === null ? row.text : row.text.slice(envelope.bodyStart);
}

export function findAgentSentMessageReply({
  message,
  recipientRows,
  senderThreadId,
  sentAt,
}: FindAgentSentMessageReplyArgs): AssistantRow | null {
  const candidates = recipientRows.filter(
    (row): row is UserRow =>
      row.kind === "conversation" &&
      row.role === "user" &&
      row.initiator === "agent" &&
      row.senderThreadId === senderThreadId &&
      row.createdAt >= sentAt - TEXT_MATCH_LOOKBACK_MS,
  );
  const expected = message === null ? null : normalizeMessageText(message);
  const received =
    candidates.find(
      (row) => normalizeMessageText(receivedMessageBody(row)) === expected,
    ) ??
    candidates.find((row) => row.createdAt >= sentAt - SENT_AT_CLOCK_SKEW_MS);
  if (received?.turnId == null) {
    return null;
  }
  for (let index = recipientRows.length - 1; index >= 0; index -= 1) {
    const row = recipientRows[index];
    if (
      row?.kind === "conversation" &&
      row.role === "assistant" &&
      row.turnId === received.turnId
    ) {
      return row;
    }
  }
  return null;
}
