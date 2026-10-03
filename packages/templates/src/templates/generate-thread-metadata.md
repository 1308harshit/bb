---
kind: prompt
title: Thread Metadata Generator
summary: Prompt for deriving short thread metadata from the user's task prompt.
intent: Generate stable, operator-friendly metadata for threads without adding explanatory prose.
editingNotes: Callers expect plain text. bb strips think blocks, quotes, labels, and extra lines, then clamps the title to 48 columns.
variables:
  namingPrompt: Instructions for writing the title.
  cleanedPrompt: User prompt text with noisy tokens removed and length-clamped.
  invokedCommands?: Comma-separated slash commands or skills the prompt invokes, when it invokes any.
---
{{namingPrompt}}

{{#if invokedCommands}}
The prompt invokes these commands or skills: {{invokedCommands}}. They name how the work is carried out, so title the work they are applied to. When the prompt names nothing else, title what the invoked command itself does.

{{/if}}
Task:
{{cleanedPrompt}}
