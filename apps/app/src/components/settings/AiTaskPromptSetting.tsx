import { useState } from "react";
import {
  DEFAULT_THREAD_NAMING_PROMPT,
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  COMMIT_MESSAGE_PROMPT_MAX_LENGTH,
  type AiTextTask,
  THREAD_NAMING_PROMPT_MAX_LENGTH,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Textarea } from "@bb/shared-ui/textarea";
import { SettingsWithControl } from "@/components/ui/settings-section";
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
  const [draft, setDraft] = useState<string | null>(null);
  const saved = settings?.[settingKey] ?? defaultPrompt;
  const value = draft ?? saved;
  const disabled = settings === undefined || update.isPending;

  function save(prompt: string | null) {
    if (settings === undefined) return;
    update.mutate(
      { ...settings, [settingKey]: prompt },
      { onSuccess: () => setDraft(null) },
    );
  }

  return (
    <SettingsWithControl
      label={label}
      description={
        isTitle
          ? "Instructions for naming new threads across this server. bb adds the task text automatically and limits titles to 48 columns. Save, then use Test above to try it."
          : "Instructions for commit messages across this server. bb adds the changed files and diff automatically and keeps a single subject line up to 72 columns. Save, then use Test above to try it."
      }
      controlPlacement="below"
    >
      <div role="group" aria-label={label} className="space-y-2">
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
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || !value.trim() || value.trim() === saved}
            onClick={() => save(value.trim())}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
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
        </div>
      </div>
    </SettingsWithControl>
  );
}
