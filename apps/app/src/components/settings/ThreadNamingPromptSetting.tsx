import { useState } from "react";
import {
  DEFAULT_THREAD_NAMING_PROMPT,
  THREAD_NAMING_PROMPT_MAX_LENGTH,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Textarea } from "@bb/shared-ui/textarea";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";

export function ThreadNamingPromptSetting() {
  const settings = useSystemConfig().data?.generalSettings;
  const update = useUpdateGeneralSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const saved = settings?.threadNamingPrompt ?? DEFAULT_THREAD_NAMING_PROMPT;
  const value = draft ?? saved;
  const disabled = settings === undefined || update.isPending;

  function save(prompt: string | null) {
    if (settings === undefined) return;
    update.mutate(
      { ...settings, threadNamingPrompt: prompt },
      { onSuccess: () => setDraft(null) },
    );
  }

  return (
    <SettingsWithControl
      label="Thread naming prompt"
      description="Instructions for naming new threads across this server. bb adds the task text automatically and limits titles to 48 columns. Save, then use Test above to try it."
      controlPlacement="below"
    >
      <div className="space-y-2">
        <Textarea
          aria-label="Thread naming prompt"
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          rows={7}
          maxLength={THREAD_NAMING_PROMPT_MAX_LENGTH}
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
              disabled ||
              (settings.threadNamingPrompt === null && draft === null)
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
