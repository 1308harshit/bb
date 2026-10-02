import type { ThreadTimelineViewRow } from "@bb/thread-view";

export const MIN_COLLAPSED_AGENT_EXCHANGES = 2;

export type IsExcludedAgentSender = (senderThreadId: string) => boolean;

type AgentMessageRow = Extract<
  ThreadTimelineViewRow,
  { kind: "conversation"; role: "user" }
> & { senderThreadId: string; turnId: string };

export interface AgentExchangeGroup {
  id: string;
  exchangeCount: number;
  rows: readonly ThreadTimelineViewRow[];
}

export type AgentExchangeListEntry =
  | { kind: "row"; row: ThreadTimelineViewRow }
  | { kind: "agent-exchanges"; group: AgentExchangeGroup };

interface AgentExchange {
  rows: ThreadTimelineViewRow[];
  settled: boolean;
}

interface GroupAgentExchangesArgs {
  isExcludedSender: IsExcludedAgentSender;
  pinnedRowIds: ReadonlySet<string>;
  rows: readonly ThreadTimelineViewRow[];
}

export function isAgentMessageRow(
  row: ThreadTimelineViewRow,
  isExcludedSender: IsExcludedAgentSender,
): row is AgentMessageRow {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.initiator === "agent" &&
    row.senderThreadId !== null &&
    row.turnId !== null &&
    !isExcludedSender(row.senderThreadId)
  );
}

export function collectAgentReplyRecipients(
  rows: readonly ThreadTimelineViewRow[],
  isExcludedSender: IsExcludedAgentSender,
): ReadonlyMap<string, string> {
  const recipients = new Map<string, string>();
  let current: { senderThreadId: string; turnId: string } | null = null;

  const visit = (candidateRows: readonly ThreadTimelineViewRow[]): void => {
    for (const row of candidateRows) {
      if (row.kind === "conversation") {
        if (row.role === "user") {
          current = isAgentMessageRow(row, isExcludedSender)
            ? { senderThreadId: row.senderThreadId, turnId: row.turnId }
            : null;
        } else if (current !== null && row.turnId === current.turnId) {
          recipients.set(row.id, current.senderThreadId);
        }
        continue;
      }
      if (row.kind === "turn" && row.children !== null) {
        visit(row.children);
      }
    }
  };

  visit(rows);
  return recipients;
}

function isRowPending(row: ThreadTimelineViewRow): boolean {
  return "status" in row && row.status === "pending";
}

function readAgentExchange(
  rows: readonly ThreadTimelineViewRow[],
  startIndex: number,
  isExcludedSender: IsExcludedAgentSender,
): AgentExchange | null {
  const first = rows[startIndex];
  if (first === undefined || !isAgentMessageRow(first, isExcludedSender)) {
    return null;
  }
  const exchangeRows: ThreadTimelineViewRow[] = [first];
  for (let index = startIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (
      row === undefined ||
      row.turnId !== first.turnId ||
      (row.kind === "conversation" && row.role === "user")
    ) {
      break;
    }
    exchangeRows.push(row);
  }
  return {
    rows: exchangeRows,
    settled: !exchangeRows.some(isRowPending),
  };
}

function toAgentExchangeGroup(
  exchanges: readonly AgentExchange[],
): AgentExchangeGroup {
  const rows = exchanges.flatMap((exchange) => exchange.rows);
  const firstRow = rows[0];
  if (firstRow === undefined) {
    throw new Error("Cannot group agent exchanges without rows");
  }
  return {
    id: `agent-exchanges:${firstRow.id}`,
    exchangeCount: exchanges.length,
    rows,
  };
}

export function groupAgentExchanges({
  isExcludedSender,
  pinnedRowIds,
  rows,
}: GroupAgentExchangesArgs): AgentExchangeListEntry[] {
  const entries: AgentExchangeListEntry[] = [];
  let run: AgentExchange[] = [];

  const flushRun = (): void => {
    const runRows = run.flatMap((exchange) => exchange.rows);
    const collapsible =
      run.length >= MIN_COLLAPSED_AGENT_EXCHANGES &&
      !runRows.some((row) => pinnedRowIds.has(row.id));
    if (collapsible) {
      entries.push({
        kind: "agent-exchanges",
        group: toAgentExchangeGroup(run),
      });
    } else {
      for (const row of runRows) {
        entries.push({ kind: "row", row });
      }
    }
    run = [];
  };

  let index = 0;
  while (index < rows.length) {
    const exchange = readAgentExchange(rows, index, isExcludedSender);
    if (exchange !== null && exchange.settled) {
      run.push(exchange);
      index += exchange.rows.length;
      continue;
    }
    flushRun();
    const exchangeRows = exchange?.rows ?? rows.slice(index, index + 1);
    for (const row of exchangeRows) {
      entries.push({ kind: "row", row });
    }
    index += exchangeRows.length;
  }
  flushRun();
  return entries;
}
