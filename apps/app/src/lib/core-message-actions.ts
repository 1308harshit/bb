import { appendQuoteAndAttachmentsToDraft } from "@bb/client-core";
import type { TimelineMessageAction } from "./plugin-message-actions";

const addToChatMessageAction: TimelineMessageAction = {
  pluginId: null,
  generation: 0,
  id: "add-to-chat",
  title: "Add to chat",
  icon: "MessageSquarePlus",
  experimental_isAvailable: ({ composer, message, selectedText }) =>
    composer !== null &&
    (selectedText !== undefined ||
      message.text.trim().length > 0 ||
      message.experimental_attachments.length > 0),
  run({ composer, message, selectedText }) {
    if (composer === null) return;
    const attachments =
      selectedText === undefined ? message.experimental_attachments : [];
    composer.replace((current) => {
      const next = appendQuoteAndAttachmentsToDraft(
        current,
        selectedText ?? message.text,
        attachments,
      );
      return {
        text: next.text,
        mentions: current.mentions,
        attachments: next.attachments,
      };
    });
    composer.focus();
  },
};

export const CORE_MESSAGE_ACTIONS: readonly TimelineMessageAction[] = [
  addToChatMessageAction,
];
