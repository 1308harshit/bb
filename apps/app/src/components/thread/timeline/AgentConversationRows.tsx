import { useMemo, type ReactNode } from "react";
import type { PromptTextMention } from "@bb/domain";
import type { TimelineConversationTurnRequest } from "@bb/server-contract";
import {
  findAgentSentMessageReply,
  type AgentThreadTellCommand,
} from "@bb/thread-view";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { useThreadTimeline } from "@/hooks/queries/thread-queries";
import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";
import type { ConversationAttachmentItems } from "./ConversationAttachments.js";
import {
  GeneratedConversationMessage,
  type GeneratedConversationSourceKind,
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
  counterpart: SenderThreadMetadata | null;
  counterpartThreadId: string;
  expandedBody?: ReactNode;
  links: AgentMessageChipLinks;
  sourceKind: Exclude<GeneratedConversationSourceKind, "automation" | "system">;
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

export function AgentMessageChip({
  counterpart,
  counterpartThreadId,
  expandedBody,
  links,
  sourceKind,
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
      attachmentItems={NO_ATTACHMENTS}
      automationLink={null}
      expandedBody={expandedBody}
      mentions={NO_MENTIONS}
      originKind={null}
      sourceIsPluginSideChat={false}
      sourceKind={sourceKind}
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
        sourceKind="agent-message-to"
        text={tell.message ?? ""}
        timestamp={sentAt}
      />
      {reply === null ? null : (
        <AgentMessageChip
          {...chipProps}
          sourceKind="agent-reply-from"
          text={reply.text}
          timestamp={reply.startedAt}
        />
      )}
    </div>
  );
}
