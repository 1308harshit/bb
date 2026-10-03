import { useMemo, type ComponentProps } from "react";
import {
  findAgentSentMessageReply,
  type AgentThreadTellCommand,
} from "@bb/thread-view";
import { useThreadTimeline } from "@/hooks/queries/thread-queries";
import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";
import { GeneratedConversationMessage } from "./GeneratedConversationMessage.js";

type MessageProps = ComponentProps<typeof GeneratedConversationMessage>;
type AgentMessageChipLinks = Pick<
  MessageProps,
  | "onOpenLink"
  | "onOpenLocalFileLink"
  | "onTitleAction"
  | "projectId"
  | "resolveMentionLink"
  | "workspaceRootPath"
>;

interface AgentMessageChipProps extends Pick<
  MessageProps,
  "expandedBody" | "text" | "timestamp"
> {
  counterpart: SenderThreadMetadata | null;
  counterpartThreadId: string;
  links: AgentMessageChipLinks;
  sourceKind: Exclude<MessageProps["sourceKind"], "automation" | "system">;
  threadId: string;
}

interface SentAgentMessageProps extends Pick<
  AgentMessageChipProps,
  "counterpart" | "links"
> {
  sentAt: number;
  senderThreadId: string;
  tell: AgentThreadTellCommand;
}

const NO_MENTIONS: MessageProps["mentions"] = [];
const NO_ATTACHMENTS: MessageProps["attachmentItems"] = {
  filePaths: [],
  imageItems: [],
};
const ACCEPTED_MESSAGE: MessageProps["turnRequest"] = {
  isGrouped: false,
  kind: "message",
  status: "accepted",
};

export function AgentMessageChip({
  counterpart,
  counterpartThreadId,
  links,
  ...messageProps
}: AgentMessageChipProps) {
  return (
    <GeneratedConversationMessage
      {...messageProps}
      onOpenLink={links.onOpenLink}
      onOpenLocalFileLink={links.onOpenLocalFileLink}
      onTitleAction={links.onTitleAction}
      projectId={links.projectId}
      resolveMentionLink={links.resolveMentionLink}
      workspaceRootPath={links.workspaceRootPath}
      attachmentItems={NO_ATTACHMENTS}
      automationLink={null}
      mentions={NO_MENTIONS}
      originKind={null}
      sourceIsPluginSideChat={false}
      sourceName={counterpart?.title ?? "Agent"}
      sourceProjectId={counterpart?.projectId ?? null}
      sourceThreadId={counterpartThreadId}
      systemMessageKind="unlabeled"
      systemMessageSubject={null}
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
