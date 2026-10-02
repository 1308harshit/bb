import type { ReactNode } from "react";
import type { PromptTextMention } from "@bb/domain";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";
import type { ConversationAttachmentItems } from "./ConversationAttachments.js";
import { GeneratedConversationMessage } from "./GeneratedConversationMessage.js";
import type { TimelineTitleActionResolver } from "./TimelineTitleView.js";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
} from "./types.js";

interface AgentReplyMessageProps {
  body: ReactNode;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onTitleAction?: TimelineTitleActionResolver;
  projectId?: string;
  recipientMetadata: SenderThreadMetadata | null;
  recipientThreadId: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  text: string;
  threadId?: string;
  workspaceRootPath?: string;
}

const NO_MENTIONS: readonly PromptTextMention[] = [];
const NO_ATTACHMENTS: ConversationAttachmentItems = {
  filePaths: [],
  imageItems: [],
};

export function AgentReplyMessage({
  body,
  onOpenLink,
  onOpenLocalFileLink,
  onTitleAction,
  projectId,
  recipientMetadata,
  recipientThreadId,
  resolveMentionLink,
  text,
  threadId,
  workspaceRootPath,
}: AgentReplyMessageProps) {
  return (
    <GeneratedConversationMessage
      agentDirection="outgoing"
      attachmentItems={NO_ATTACHMENTS}
      expandedBody={body}
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
