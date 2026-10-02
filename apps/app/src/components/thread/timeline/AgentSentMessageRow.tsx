import { useMemo } from "react";
import type { PromptTextMention } from "@bb/domain";
import type { AgentThreadTellCommand } from "@bb/thread-view";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { useThreadTimeline } from "@/hooks/queries/thread-queries";
import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";
import { findAgentSentMessageReply } from "./agent-sent-message-reply.js";
import type { ConversationAttachmentItems } from "./ConversationAttachments.js";
import { GeneratedConversationMessage } from "./GeneratedConversationMessage.js";
import type { TimelineTitleActionResolver } from "./TimelineTitleView.js";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
} from "./types.js";

interface AgentSentMessageRowProps {
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onTitleAction?: TimelineTitleActionResolver;
  projectId?: string;
  recipientMetadata: SenderThreadMetadata | null;
  resolveMentionLink?: PromptMentionLinkResolver;
  sentAt: number;
  senderThreadId: string | undefined;
  tell: AgentThreadTellCommand;
  workspaceRootPath?: string;
}

const NO_MENTIONS: readonly PromptTextMention[] = [];
const NO_ATTACHMENTS: ConversationAttachmentItems = {
  filePaths: [],
  imageItems: [],
};

export function AgentSentMessageRow({
  onOpenLink,
  onOpenLocalFileLink,
  onTitleAction,
  projectId,
  recipientMetadata,
  resolveMentionLink,
  sentAt,
  senderThreadId,
  tell,
  workspaceRootPath,
}: AgentSentMessageRowProps) {
  const recipientThreadId = tell.targetThreadId;
  const recipientTimeline = useThreadTimeline(recipientThreadId, {
    enabled:
      senderThreadId !== undefined && senderThreadId !== recipientThreadId,
  });
  const recipientRows = recipientTimeline.data?.rows;
  const reply = useMemo(
    () =>
      senderThreadId === undefined || recipientRows === undefined
        ? null
        : findAgentSentMessageReply({
            message: tell.message,
            recipientRows,
            senderThreadId,
            sentAt,
          }),
    [recipientRows, senderThreadId, sentAt, tell.message],
  );
  const sharedProps = {
    attachmentItems: NO_ATTACHMENTS,
    mentions: NO_MENTIONS,
    onOpenLink,
    onOpenLocalFileLink,
    onTitleAction,
    originKind: null,
    projectId,
    resolveMentionLink,
    sourceIsPluginSideChat: false,
    sourceKind: "agent",
    sourceName: recipientMetadata?.title ?? "Agent",
    sourceProjectId: recipientMetadata?.projectId ?? null,
    sourceThreadId: recipientThreadId,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    threadId: senderThreadId,
    turnRequest: null,
    workspaceRootPath,
  } as const;

  return (
    <div className="flex flex-col gap-2">
      <GeneratedConversationMessage
        {...sharedProps}
        agentDirection="sent-message"
        text={tell.message ?? ""}
      />
      {reply?.reply ? (
        <GeneratedConversationMessage
          {...sharedProps}
          agentDirection="received-reply"
          text={reply.reply.text}
        />
      ) : null}
    </div>
  );
}
