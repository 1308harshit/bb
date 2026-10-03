import { useEffect, useId, useState } from "react";
import { AI_TASK_INSTRUCTIONS_MAX_LENGTH, type AiTextTask } from "@bb/domain";
import { Textarea } from "@bb/shared-ui/textarea";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function AiTaskInstructionsSetting({ task }: { task: AiTextTask }) {
  const isTitle = task === "thread-title";
  const settingKey = isTitle
    ? "threadTitleInstructions"
    : "commitMessageInstructions";
  const label = isTitle
    ? "Thread title instructions"
    : "Commit message instructions";
  const messageId = useId();
  const settings = useSystemConfig().data?.generalSettings;
  const update = useUpdateGeneralSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const saved = settings?.[settingKey] ?? "";
  const value = draft ?? saved;

  useEffect(() => {
    if (draft === saved) setDraft(null);
  }, [draft, saved]);

  function save() {
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
  return (
    <div className="space-y-1">
      <Textarea
        aria-label={label}
        aria-describedby={saveError !== null ? messageId : undefined}
        aria-invalid={saveError !== null}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        placeholder={
          isTitle
            ? "Instructions added to bb’s title rules, e.g. Write titles in French."
            : "Instructions added to bb’s commit rules, e.g. Skip the conventional commit type prefix."
        }
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
