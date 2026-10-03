import { useEffect, useState, type ReactNode } from "react";
import { AI_TASK_INSTRUCTIONS_MAX_LENGTH, type AiTextTask } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Textarea } from "@bb/shared-ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";

export function AiTaskInstructionsSetting({
  task,
  children,
}: {
  task: AiTextTask;
  children: (instructions: {
    editButton: ReactNode;
    status: string;
  }) => ReactNode;
}) {
  const isTitle = task === "thread-title";
  const settingKey = isTitle
    ? "threadTitleInstructions"
    : "commitMessageInstructions";
  const label = isTitle
    ? "Thread title instructions"
    : "Commit message instructions";
  const settings = useSystemConfig().data?.generalSettings;
  const update = useUpdateGeneralSettings();
  const [isExpanded, setIsExpanded] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const saved = settings?.[settingKey] ?? "";
  const value = draft ?? saved;
  const dirty = value.trim() !== saved;
  const disabled = settings === undefined || update.isPending;

  useEffect(() => {
    if (draft === saved) setDraft(null);
  }, [draft, saved]);

  function save() {
    if (settings === undefined) return;
    const instructions = value.trim();
    update.mutate(
      { ...settings, [settingKey]: instructions === "" ? null : instructions },
      { onSuccess: () => setDraft(instructions) },
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
      <TooltipContent side="bottom">Edit instructions</TooltipContent>
    </Tooltip>
  );

  return (
    <>
      {children({
        editButton,
        status: dirty
          ? " Unsaved instructions."
          : saved
            ? " Custom instructions."
            : "",
      })}
      {isExpanded ? (
        <div role="group" aria-label={label} className="space-y-2 pt-1">
          <Textarea
            aria-label={label}
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              isTitle
                ? "e.g. Write titles in French. Start with the ticket number when the task mentions one."
                : "e.g. Write commit subjects in French. Skip the conventional commit type prefix."
            }
            className="max-h-60 min-h-20 resize-y overflow-y-auto text-xs leading-relaxed field-sizing-content"
            maxLength={AI_TASK_INSTRUCTIONS_MAX_LENGTH}
            disabled={disabled}
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-xs text-muted-foreground">
              {isTitle
                ? "Added to bb’s built-in title rules."
                : "Added to bb’s built-in commit rules."}
            </p>
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
            <Button size="sm" disabled={disabled || !dirty} onClick={save}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
