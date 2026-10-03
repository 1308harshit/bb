import { useEffect, useId, useState } from "react";
import {
  AI_TASK_INSTRUCTIONS_MAX_LENGTH,
  type AiTextTask,
  type AppSettings,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Textarea } from "@bb/shared-ui/textarea";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

const INSTRUCTIONS_FIELDS = {
  "thread-title": {
    settingKey: "threadTitleInstructions",
    label: "Thread title instructions",
    placeholder: "Added to bb’s title rules, e.g. Write titles in French.",
  },
  "commit-message": {
    settingKey: "commitMessageInstructions",
    label: "Commit message instructions",
    placeholder:
      "Added to bb’s commit rules, e.g. Skip the conventional commit type prefix.",
  },
} satisfies Record<
  AiTextTask,
  {
    settingKey: keyof AppSettings & `${string}Instructions`;
    label: string;
    placeholder: string;
  }
>;

export function AiTaskInstructionsSetting({ task }: { task: AiTextTask }) {
  const { settingKey, label, placeholder } = INSTRUCTIONS_FIELDS[task];
  const messageId = useId();
  const settings = useSystemConfig().data?.generalSettings;
  const update = useUpdateGeneralSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const saved = settings?.[settingKey] ?? "";
  const value = draft ?? saved;

  useEffect(() => {
    if (draft === saved) setDraft(null);
  }, [draft, saved]);

  function save() {
    if (value.trim() === "") setIsAdding(false);
    if (settings === undefined || draft === null) return;
    const instructions = draft.trim();
    if (instructions === saved) {
      setDraft(null);
      return;
    }
    update.mutate(
      { ...settings, [settingKey]: instructions === "" ? null : instructions },
      { onSuccess: () => setDraft(instructions) },
    );
  }

  const saveError = update.isError
    ? getMutationErrorMessage({
        error: update.error,
        fallbackMessage: "Could not save these instructions",
      })
    : null;
  if (!isAdding && saved === "" && !value.trim() && saveError === null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        aria-label={`Add ${label.toLowerCase()}`}
        disabled={settings === undefined}
        onClick={() => setIsAdding(true)}
      >
        <Icon name="Plus" className="size-3.5" />
        Add instructions
      </Button>
    );
  }
  return (
    <div className="space-y-1">
      <Textarea
        aria-label={label}
        aria-describedby={saveError !== null ? messageId : undefined}
        aria-invalid={saveError !== null}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        autoFocus={isAdding}
        placeholder={placeholder}
        className="max-h-96 min-h-16 w-full resize-y overflow-y-auto font-mono text-xs field-sizing-content"
        maxLength={AI_TASK_INSTRUCTIONS_MAX_LENGTH}
        disabled={settings === undefined}
      />
      {saveError !== null ? (
        <p id={messageId} className="text-xs text-destructive" role="alert">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}
