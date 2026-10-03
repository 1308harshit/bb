---
kind: prompt
title: Commit Message Generator
summary: Prompt for generating one conventional commit line from a git diff snapshot.
intent: Produce a single concise conventional commit subject and nothing else.
editingNotes: Callers expect plain text. bb strips think blocks, quotes, labels, and extra lines, then clamps the subject to 72 columns.
variables:
  messagePrompt: Instructions for writing the commit subject.
  diffDescription: Human-readable description of the diff snapshot being summarized.
  shortstat: Git shortstat summary for the diff.
  files: Git name-status output for changed files.
  patch: Trimmed patch excerpt for extra context.
---
Write a concise git commit message for {{diffDescription}}.
{{messagePrompt}}

Shortstat:
{{shortstat}}

Files (name-status):
{{files}}

Patch excerpt:
{{patch}}
