import { memo, useCallback, useMemo, type ReactNode } from "react";
import type { ThreadTimelineViewRow, TimelineTitle } from "@bb/thread-view";
import type { AgentExchangeGroup } from "./agent-exchanges.js";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow.js";

interface AgentExchangeGroupRowProps {
  group: AgentExchangeGroup;
  renderRows: (rows: readonly ThreadTimelineViewRow[]) => ReactNode;
}

const AGENT_EXCHANGE_GROUP_LABEL = "Agent conversation";

function agentExchangeMessageCount(
  rows: readonly ThreadTimelineViewRow[],
): number {
  return rows.filter((row) => row.kind === "conversation").length;
}

export const AgentExchangeGroupRow = memo(function AgentExchangeGroupRow({
  group,
  renderRows,
}: AgentExchangeGroupRowProps) {
  const messageCountLabel = `${agentExchangeMessageCount(group.rows)} messages`;
  const title = useMemo<TimelineTitle>(
    () => ({
      action: null,
      decorations: [],
      plain: `${AGENT_EXCHANGE_GROUP_LABEL} ${messageCountLabel}`,
      segments: [
        {
          em: false,
          shimmer: false,
          text: AGENT_EXCHANGE_GROUP_LABEL,
          truncate: false,
        },
      ],
      tone: "default",
    }),
    [messageCountLabel],
  );
  const { rows } = group;
  const renderBody = useCallback(() => renderRows(rows), [renderRows, rows]);

  return (
    <ExpandableTimelineRow
      reasoningExpansionKey={group.id}
      title={title}
      titleContent={
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-sm leading-5">
          <span className="shrink-0 text-muted-foreground">
            {AGENT_EXCHANGE_GROUP_LABEL}
          </span>
          <span className="shrink-0 text-subtle-foreground">
            {messageCountLabel}
          </span>
        </span>
      }
      leadingIcon="MessageMultiple"
      renderBody={renderBody}
    />
  );
});
