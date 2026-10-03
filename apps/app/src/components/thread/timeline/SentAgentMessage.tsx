import type { ComponentProps } from "react";
import type { AgentMessageToolCall } from "@bb/thread-view";
import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";
import { GeneratedConversationMessage } from "./GeneratedConversationMessage.js";

type GeneratedMessageProps = ComponentProps<
  typeof GeneratedConversationMessage
>;

type SentAgentMessageLinks = Pick<
  GeneratedMessageProps,
  | "onOpenLink"
  | "onOpenLocalFileLink"
  | "onTitleAction"
  | "projectId"
  | "resolveMentionLink"
  | "threadId"
  | "workspaceRootPath"
>;

interface SentAgentMessageProps {
  links: SentAgentMessageLinks;
  message: AgentMessageToolCall;
  recipient: SenderThreadMetadata | null;
  sentAt: number;
}

const NO_ATTACHMENTS: GeneratedMessageProps["attachmentItems"] = {
  filePaths: [],
  imageItems: [],
};
const NO_MENTIONS: GeneratedMessageProps["mentions"] = [];
const ACCEPTED_MESSAGE: GeneratedMessageProps["turnRequest"] = {
  isGrouped: false,
  kind: "message",
  status: "accepted",
};

export function SentAgentMessage({
  links,
  message,
  recipient,
  sentAt,
}: SentAgentMessageProps) {
  return (
    <GeneratedConversationMessage
      attachmentItems={NO_ATTACHMENTS}
      automationLink={null}
      mentions={NO_MENTIONS}
      onOpenLink={links.onOpenLink}
      onOpenLocalFileLink={links.onOpenLocalFileLink}
      onTitleAction={links.onTitleAction}
      originKind={null}
      projectId={links.projectId}
      resolveMentionLink={links.resolveMentionLink}
      sourceIsPluginSideChat={false}
      sourceKind="agent-recipient"
      sourceName={recipient?.title ?? "Agent"}
      sourceProjectId={recipient?.projectId ?? null}
      sourceThreadId={message.threadId}
      systemMessageKind="unlabeled"
      systemMessageSubject={null}
      text={message.message}
      threadId={links.threadId}
      timestamp={sentAt}
      turnRequest={ACCEPTED_MESSAGE}
      workspaceRootPath={links.workspaceRootPath}
    />
  );
}
