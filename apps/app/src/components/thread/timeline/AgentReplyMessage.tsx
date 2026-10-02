import { useMemo } from "react";
import type { PromptTextMention } from "@bb/domain";
import type { TimelineConversationAttachments } from "@bb/server-contract";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";
import { buildAttachmentItems } from "./ConversationAttachments.js";
import { GeneratedConversationMessage } from "./GeneratedConversationMessage.js";
import type { TimelineTitleActionResolver } from "./TimelineTitleView.js";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
  UserAttachmentImageSrcResolver,
} from "./types.js";

interface AgentReplyMessageProps {
  attachments: TimelineConversationAttachments | null;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onTitleAction?: TimelineTitleActionResolver;
  projectId?: string;
  recipientMetadata: SenderThreadMetadata | null;
  recipientThreadId: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  resolveUserAttachmentImageSrc?: UserAttachmentImageSrcResolver;
  text: string;
  threadId?: string;
  workspaceRootPath?: string;
}

const NO_MENTIONS: readonly PromptTextMention[] = [];

export function AgentReplyMessage({
  attachments,
  onOpenLink,
  onOpenLocalFileLink,
  onTitleAction,
  projectId,
  recipientMetadata,
  recipientThreadId,
  resolveMentionLink,
  resolveUserAttachmentImageSrc,
  text,
  threadId,
  workspaceRootPath,
}: AgentReplyMessageProps) {
  const attachmentItems = useMemo(
    () =>
      buildAttachmentItems({
        attachments,
        projectId,
        resolveUserAttachmentImageSrc,
      }),
    [attachments, projectId, resolveUserAttachmentImageSrc],
  );
  return (
    <GeneratedConversationMessage
      agentDirection="outgoing"
      attachmentItems={attachmentItems}
      originKind={null}
      mentions={NO_MENTIONS}
      onOpenLink={onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      projectId={projectId}
      resolveMentionLink={resolveMentionLink}
      onTitleAction={onTitleAction}
      sourceKind="agent"
      sourceName={recipientMetadata?.title ?? "Agent"}
      sourceProjectId={recipientMetadata?.projectId ?? null}
      sourceThreadId={recipientThreadId}
      sourceIsPluginSideChat={false}
      systemMessageKind="unlabeled"
      systemMessageSubject={null}
      text={text}
      threadId={threadId}
      turnRequest={null}
      workspaceRootPath={workspaceRootPath}
    />
  );
}
