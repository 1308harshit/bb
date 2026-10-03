import { useEffect, useState } from "react";
import {
  DEFAULT_THREAD_NAMING_PROMPT,
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  COMMIT_MESSAGE_PROMPT_MAX_LENGTH,
  type AiTextTask,
  THREAD_NAMING_PROMPT_MAX_LENGTH,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Textarea } from "@bb/shared-ui/textarea";
import {
  ExpandablePanel,
  getCollapsibleHeaderToneClass,
} from "@/components/ui/disclosure";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";

export function AiTaskPromptSetting({ task }: { task: AiTextTask }) {
  const isTitle = task === "thread-title";
  const settingKey = isTitle ? "threadNamingPrompt" : "commitMessagePrompt";
  const defaultPrompt = isTitle
    ? DEFAULT_THREAD_NAMING_PROMPT
    : DEFAULT_COMMIT_MESSAGE_PROMPT;
  const label = isTitle ? "Thread naming prompt" : "Commit message prompt";
  const settings = useSystemConfig().data?.generalSettings;
  const update = useUpdateGeneralSettings();
  const [isExpanded, setIsExpanded] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const saved = settings?.[settingKey] ?? defaultPrompt;
  const value = draft ?? saved;
  const dirty = value.trim() !== saved;
  const disabled = settings === undefined || update.isPending;

  useEffect(() => {
    if (draft === saved) setDraft(null);
  }, [draft, saved]);

  function save(prompt: string | null) {
    if (settings === undefined) return;
    update.mutate(
      { ...settings, [settingKey]: prompt },
      { onSuccess: () => setDraft(prompt ?? defaultPrompt) },
    );
  }

  return (
    <ExpandablePanel
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded((expanded) => !expanded)}
      headerToneClass={getCollapsibleHeaderToneClass(isExpanded)}
      forceHeaderChevronVisible
      headerClassName="px-0 text-xs"
      contentClassName="px-0 pb-0 pt-2"
      summaryContentClassName="flex min-w-0 items-center gap-2"
      summaryContent={
        <>
          <span>
            <span className="sr-only">
              {isTitle ? "Thread naming " : "Commit message "}
            </span>
            Prompt
          </span>
          <span className="text-subtle-foreground/75">
            {dirty ? "Unsaved" : settings?.[settingKey] ? "Custom" : "Default"}
          </span>
        </>
      }
    >
      <div role="group" aria-label={label} className="space-y-3">
        <p className="text-xs leading-snug text-subtle-foreground/75">
          {isTitle
            ? "Set the language and style for new titles. Task context is added automatically."
            : "Set the language and style for commit subjects. The diff is added automatically."}
        </p>
        <Textarea
          aria-label={label}
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          rows={7}
          maxLength={
            isTitle
              ? THREAD_NAMING_PROMPT_MAX_LENGTH
              : COMMIT_MESSAGE_PROMPT_MAX_LENGTH
          }
          disabled={disabled}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={
              disabled || (settings[settingKey] === null && draft === null)
            }
            onClick={() => save(null)}
          >
            Reset to default
          </Button>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => {
                setDraft(null);
                setIsExpanded(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={disabled || !value.trim() || !dirty}
              onClick={() => save(value.trim())}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </ExpandablePanel>
  );
}
