import { memo, useCallback, useMemo, type ReactNode } from "react";
import type { PromptTextMention } from "@bb/domain";
import type { TimelineConversationTurnRequest } from "@bb/server-contract";
import type {
  AgentThreadTellCommand,
  ThreadTimelineViewRow,
  TimelineTitle,
} from "@bb/thread-view";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { useThreadTimeline } from "@/hooks/queries/thread-queries";
import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";
import {
  findAgentSentMessageReply,
  type AgentExchangeGroup,
} from "./agent-exchanges.js";
import type { ConversationAttachmentItems } from "./ConversationAttachments.js";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow.js";
import {
  GeneratedConversationMessage,
  type GeneratedAgentMessageDirection,
} from "./GeneratedConversationMessage.js";
import type { TimelineTitleActionResolver } from "./TimelineTitleView.js";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
} from "./types.js";

export interface AgentMessageChipLinks {
  onOpenLink: ThreadTimelineLinkHandler | undefined;
  onOpenLocalFileLink: ThreadTimelineLocalFileLinkHandler | undefined;
  onTitleAction: TimelineTitleActionResolver | undefined;
  projectId: string | undefined;
  resolveMentionLink: PromptMentionLinkResolver | undefined;
  workspaceRootPath: string | undefined;
}

interface AgentMessageChipProps {
  agentDirection: GeneratedAgentMessageDirection;
  counterpart: SenderThreadMetadata | null;
  counterpartThreadId: string;
  expandedBody?: ReactNode;
  links: AgentMessageChipLinks;
  text: string;
  threadId: string;
  timestamp: number;
}

interface SentAgentMessageProps {
  counterpart: SenderThreadMetadata | null;
  links: AgentMessageChipLinks;
  sentAt: number;
  senderThreadId: string;
  tell: AgentThreadTellCommand;
}

interface AgentExchangeGroupRowProps {
  group: AgentExchangeGroup;
  renderRows: (rows: readonly ThreadTimelineViewRow[]) => ReactNode;
}

const NO_MENTIONS: readonly PromptTextMention[] = [];
const NO_ATTACHMENTS: ConversationAttachmentItems = {
  filePaths: [],
  imageItems: [],
};
const ACCEPTED_MESSAGE: TimelineConversationTurnRequest = {
  isGrouped: false,
  kind: "message",
  status: "accepted",
};
const AGENT_EXCHANGE_GROUP_LABEL = "Agent conversation";

export function AgentMessageChip({
  agentDirection,
  counterpart,
  counterpartThreadId,
  expandedBody,
  links,
  text,
  threadId,
  timestamp,
}: AgentMessageChipProps) {
  return (
    <GeneratedConversationMessage
      onOpenLink={links.onOpenLink}
      onOpenLocalFileLink={links.onOpenLocalFileLink}
      onTitleAction={links.onTitleAction}
      projectId={links.projectId}
      resolveMentionLink={links.resolveMentionLink}
      workspaceRootPath={links.workspaceRootPath}
      agentDirection={agentDirection}
      attachmentItems={NO_ATTACHMENTS}
      automationLink={null}
      expandedBody={expandedBody}
      mentions={NO_MENTIONS}
      originKind={null}
      sourceIsPluginSideChat={false}
      sourceKind="agent"
      sourceName={counterpart?.title ?? "Agent"}
      sourceProjectId={counterpart?.projectId ?? null}
      sourceThreadId={counterpartThreadId}
      systemMessageKind="unlabeled"
      systemMessageSubject={null}
      text={text}
      threadId={threadId}
      timestamp={timestamp}
      turnRequest={ACCEPTED_MESSAGE}
    />
  );
}

export function SentAgentMessage({
  counterpart,
  links,
  sentAt,
  senderThreadId,
  tell,
}: SentAgentMessageProps) {
  const recipientRows = useThreadTimeline(tell.targetThreadId, {
    enabled: senderThreadId !== tell.targetThreadId,
  }).data?.rows;
  const reply = useMemo(
    () =>
      recipientRows === undefined
        ? null
        : findAgentSentMessageReply({
            message: tell.message,
            recipientRows,
            senderThreadId,
            sentAt,
          }),
    [recipientRows, senderThreadId, sentAt, tell.message],
  );
  const chipProps = {
    counterpart,
    counterpartThreadId: tell.targetThreadId,
    links,
    threadId: senderThreadId,
  };
  return (
    <div className="flex flex-col gap-2">
      <AgentMessageChip
        {...chipProps}
        agentDirection="sent-message"
        text={tell.message ?? ""}
        timestamp={sentAt}
      />
      {reply === null ? null : (
        <AgentMessageChip
          {...chipProps}
          agentDirection="received-reply"
          text={reply.text}
          timestamp={reply.startedAt}
        />
      )}
    </div>
  );
}

export const AgentExchangeGroupRow = memo(function AgentExchangeGroupRow({
  group,
  renderRows,
}: AgentExchangeGroupRowProps) {
  const messageCount = group.rows.filter(
    (row) => row.kind === "conversation",
  ).length;
  const messageCountLabel = `${messageCount} messages`;
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
