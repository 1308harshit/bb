---
name: tyria-projects
description: Read and manage the connected user's authorized Tyria projects, boards, tasks, comments, and screenshots through native tools with explicit confirmation for every write or image transmission.
---

Use the native `tyria_*` tools for Tyria Projects. Start with
`tyria_projects_list`, then use `tyria_project_board` to discover the project's
dynamic phase and member IDs. Never invent or hardcode phase names or IDs.

Read with `tyria_tasks_list`, `tyria_task_get`, `tyria_comments_list`, and
`tyria_attachments_list`. Every write tool opens a BB confirmation form; wait
for the user's decision and do not substitute a browser or direct HTTP request.
Use the latest task `version` as `expectedVersion`. On `VERSION_CONFLICT`, read
the task again and explain what changed before proposing a new mutation. On
`WIP_LIMIT_WARNING`, explain the phase limit and ask whether to retry with the
acknowledgement flag.

`tyria_attachment_analyze` is limited to PNG/JPEG files up to 10 MiB. It asks
for attachment-specific approval before downloading anything and warns that
the pixels will be sent to Meta Muse and may remain in conversation history.
Denial is final for that call. Never request, display, or log OAuth tokens,
device codes, preview tickets, storage URLs, or base64 image data.
The equivalent CLI is `bb tyria`. CLI writes and downloads require `--yes`.
Prefer `--description-stdin` and `--text-stdin` so prose does not enter shell
history. A missing tool set means Tyria is not connected for this agent session;
ask the user to connect from the Tyria Projects sidebar and start or resume a
fresh agent session.
