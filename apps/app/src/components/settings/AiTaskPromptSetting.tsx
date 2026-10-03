import { useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_THREAD_NAMING_PROMPT,
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  COMMIT_MESSAGE_PROMPT_MAX_LENGTH,
  type AiTextTask,
  THREAD_NAMING_PROMPT_MAX_LENGTH,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Textarea } from "@bb/shared-ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";

export function AiTaskPromptSetting({
  task,
  children,
}: {
  task: AiTextTask;
  children: (prompt: { editButton: ReactNode; status: string }) => ReactNode;
}) {
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
  const customized = Boolean(settings?.[settingKey]);
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

  const editButton = (
    <Tooltip delayDuration={300} disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-8 text-muted-foreground hover:text-foreground",
            isExpanded && "bg-accent text-foreground",
          )}
          aria-label={`Edit ${label.toLowerCase()}`}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          <Icon name="Edit" className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Edit prompt</TooltipContent>
    </Tooltip>
  );

  return (
    <>
      {children({
        editButton,
        status: dirty
          ? " Unsaved prompt."
          : customized
            ? " Custom prompt."
            : "",
      })}
      {isExpanded ? (
        <div role="group" aria-label={label} className="space-y-2 pt-1">
          <Textarea
            aria-label={label}
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            className="max-h-80 min-h-32 resize-y overflow-y-auto text-xs leading-relaxed field-sizing-content"
            maxLength={
              isTitle
                ? THREAD_NAMING_PROMPT_MAX_LENGTH
                : COMMIT_MESSAGE_PROMPT_MAX_LENGTH
            }
            disabled={disabled}
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-xs text-muted-foreground">
              {isTitle
                ? "Task context is added automatically."
                : "The diff is added automatically."}
            </p>
            {customized ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => save(null)}
              >
                Reset to default
              </Button>
            ) : null}
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
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
