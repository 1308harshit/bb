import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { useSendThreadMessage } from "@/hooks/mutations/thread-runtime-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { formatUserQuestionAnswers } from "@bb/domain";
import type {
  PendingInteractionUserAnswer,
  PendingInteractionUserQuestionQuestion,
} from "@bb/domain";
import type { TimelineQuestionViewWorkRow } from "@bb/thread-view";
import { formatPendingInteractionUserQuestionOptionLabel } from "@bb/core-ui";

interface QuestionWorkRowBodyProps {
  row: TimelineQuestionViewWorkRow;
}

interface AnsweredQuestionRowProps {
  question: PendingInteractionUserQuestionQuestion;
  answer: PendingInteractionUserAnswer | null;
}

export function QuestionWorkRowBody({ row }: QuestionWorkRowBodyProps) {
  if (
    row.lifecycle === "pending" ||
    (row.lifecycle === "interrupted" && row.answers === null)
  ) {
    return null;
  }
  return (
    <div className="space-y-3 text-xs leading-snug">
      {row.lifecycle === "interrupted" && row.answers !== null ? (
        <QuestionAnswerRecovery row={row} />
      ) : null}
      {row.questions.map((question) => (
        <AnsweredQuestionRow
          key={question.id}
          question={question}
          answer={row.answers?.[question.id] ?? null}
        />
      ))}
    </div>
  );
}

function AnsweredQuestionRow({ question, answer }: AnsweredQuestionRowProps) {
  const selectedLabels =
    answer?.selected.map((value) =>
      formatPendingInteractionUserQuestionOptionLabel({ question, value }),
    ) ?? [];
  const freeText = answer?.freeText ?? null;
  const hasContent = selectedLabels.length > 0 || freeText !== null;

  return (
    <div>
      <div className="text-subtle-foreground">{question.prompt}</div>
      {hasContent ? (
        <div className="mt-0.5 text-foreground">
          {selectedLabels.length > 0 ? (
            <div>{selectedLabels.join(", ")}</div>
          ) : null}
          {freeText ? (
            <div className="whitespace-pre-wrap">{freeText}</div>
          ) : null}
        </div>
      ) : (
        <div className="mt-0.5 text-subtle-foreground">No answer</div>
      )}
    </div>
  );
}

function QuestionAnswerRecovery({ row }: QuestionWorkRowBodyProps) {
  const send = useSendThreadMessage();
  const [sent, setSent] = useState(false);
  return (
    <div className="space-y-2">
      <p>Answer delivery wasn’t confirmed. Your answer has been saved.</p>
      {row.statusReason ? (
        <p className="text-subtle-foreground">{row.statusReason}</p>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={sent || send.isPending}
        onClick={() => {
          if (row.answers === null) return;
          send.mutate(
            {
              id: row.threadId,
              mode: "queue-if-active",
              input: [
                {
                  type: "text",
                  mentions: [],
                  text: formatUserQuestionAnswers(row.questions, row.answers),
                },
              ],
            },
            { onSuccess: () => setSent(true) },
          );
        }}
      >
        {sent
          ? "Answer sent"
          : send.isPending
            ? "Sending answer…"
            : "Send as message"}
      </Button>
      {send.error ? (
        <p role="alert" className="text-destructive-text">
          {getMutationErrorMessage({
            error: send.error,
            fallbackMessage: "Failed to send saved answer",
          })}
        </p>
      ) : null}
    </div>
  );
}
