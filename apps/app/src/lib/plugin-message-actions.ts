import type {
  PluginComposerApi,
  PluginMessageActionContext,
  PluginMessageActionRegistration,
  ThreadChatMessageReference,
} from "@get-bb/plugin-sdk";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { createComposerHandleBinding } from "@get-bb/plugin-sdk/internal/composer-handle";
import { detachedComposerController } from "./plugin-composer-handle";
import type { MarkdownMessageDirectiveOpenThreadPanel } from "@/components/ui/markdown-message-directives";

export interface TimelineMessageAction extends PluginMessageActionRegistration {
  pluginId: string | null;
  generation: number;
}

interface MessageActionContextArgs {
  action: TimelineMessageAction;
  threadId: string;
  message: ThreadChatMessageReference;
  selectedText?: string;
  openThreadPanel: MarkdownMessageDirectiveOpenThreadPanel | undefined;
  composerHost: PluginComposerHost | null;
}

function actionLabel(action: TimelineMessageAction): string {
  return action.pluginId === null
    ? `[bb] messageAction "${action.id}"`
    : `[plugin:${action.pluginId}] messageAction "${action.id}"`;
}

export function isThreadComposerHost(
  host: PluginComposerHost | null,
  threadId: string,
): host is PluginComposerHost {
  return (
    host !== null &&
    host.scope.kind === "thread" &&
    host.scope.threadId === threadId
  );
}

function messageActionComposer(
  pluginId: string | null,
  threadId: string,
  host: PluginComposerHost | null,
): PluginComposerApi | null {
  if (!isThreadComposerHost(host, threadId)) return null;
  return createComposerHandleBinding(
    host.textEffectKey,
    detachedComposerController(pluginId ?? "bb", host, "a message action's"),
  ).handle;
}

export function createMessageActionContext({
  action,
  threadId,
  message,
  selectedText,
  openThreadPanel,
  composerHost,
}: MessageActionContextArgs): PluginMessageActionContext {
  return {
    threadId,
    message,
    ...(selectedText !== undefined ? { selectedText } : {}),
    openPanel: (options) => {
      const pluginId = action.pluginId;
      if (pluginId === null || openThreadPanel === undefined) {
        console.warn(
          `${actionLabel(action)} openPanel declined: this surface has no thread side panel`,
        );
        return false;
      }
      return openThreadPanel({ ...options, pluginId });
    },
    composer: messageActionComposer(action.pluginId, threadId, composerHost),
  };
}

export function isMessageActionAvailable(
  action: TimelineMessageAction,
  context: PluginMessageActionContext,
): boolean {
  if (action.experimental_isAvailable === undefined) return true;
  try {
    return action.experimental_isAvailable(context) === true;
  } catch (error) {
    console.warn(
      `${actionLabel(action)} experimental_isAvailable failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

export function runMessageAction(
  action: TimelineMessageAction,
  context: PluginMessageActionContext,
): void {
  const warn = (error: unknown) => {
    console.warn(
      `${actionLabel(action)} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  };
  try {
    const result = action.run(context);
    if (result instanceof Promise) {
      result.catch(warn);
    }
  } catch (error) {
    warn(error);
  }
}
