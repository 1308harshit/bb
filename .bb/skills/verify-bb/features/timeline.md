# Conversation history, message actions, and rendered output

Status: **2026-09-05: 1 passed, 1 failed, 10 partial/blocked** across the original 12 recipes. The two message extension recipes are outside that audit; a 2026-10-01 source run passed both on desktop and compact with a fixture plugin, except embedded ThreadChat, which needs a provider turn and was covered only by unit tests. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

A fixture conversation containing multiple turns, tool output, file edits, images, and a failed turn. Load through the real provider or trusted QA fixtures; distinguish fixture rendering from provider execution.

Follow the main skill’s isolated launch, doctor, evidence, and cleanup rules.
CLI examples below omit the `node apps/cli/dist/index.js` prefix; use that source CLI
against the same dev instance. Resolve IDs with list/show and inspect the named
command’s `--help` before mutation. Use fresh browser snapshots for controls.

## Source

- `apps/app/src/components/thread/timeline/ThreadTimelineRows.tsx`
- `apps/app/src/components/thread/timeline/TimelineSelectionMenu.tsx`
- `apps/cli/src/commands/thread/fork.ts`
- `apps/cli/src/commands/thread/show.ts`
- `packages/plugin-sdk/src/app-contract.ts`
- `apps/app/src/lib/plugin-slots.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Streaming and turn boundaries | Observe a response as it streams, then refresh and reopen older turns. | Text is neither duplicated nor lost; tool/result grouping and final boundaries remain correct. |
| Older pages and scroll anchoring | Load a long synthetic conversation, page backward, expand a row, and receive new output while scrolled up. | Viewport remains anchored; new output does not force an unwanted jump; returning to bottom resumes following. |
| Unread divider and outline | Open an unread thread, use its conversation outline and turn summary details. | Divider and outline point to the correct messages and remain consistent after paging. |
| Markdown and code | Render headings, tables, links, lists, code fences, math if supported by the renderer, and long unbroken text. | Supported formatting is legible; code copy preserves exact bytes; unsupported syntax is honest text rather than broken layout. |
| Tool work and errors | Expand command output, file changes, grouped tool calls, nested agents, and a provider error. | Arguments/results and failure details correspond to the correct call and are readable after reload. |
| Images and media | Open an attachment image/lightbox, zoom or dismiss, and load a missing asset. | Correct media opens and missing content shows an error; closing restores the thread. |
| Copy, selection, Add to chat | Copy a whole message and selected text, add a quote to the composer, then remove it. | Clipboard/quote content matches the selection, without hidden tool payloads or duplicate context. |
| Host-rendered message metadata | Install a fixture plugin with `experimental_messageMetadata({ id, roles: ["user"], resolve })` returning a timestamp label from `createdAt`. View a user prompt and assistant reply, then reload and inspect a compact viewport. | The label appears only under the user message, stays visible without hover, has the supplied title, and survives reload. The resolver receives the original creation time and runs only for realized rows, with one local-day refresh. |
| Role-targeted plugin message actions | Install fixture `messageAction` registrations with `experimental_roles: ["user"]`, `["assistant"]`, and omitted. Inspect user and assistant action bars, compact overflow, selected assistant text, and an embedded ThreadChat. | Each action appears only for its declared role; omitted appears on both. Selection and overflow menus apply the same rule, including embedded timelines. |
| Edit accepted message | With a supporting provider, replace a user message and rerun. | History is rewound from the intended checkpoint; later content is not treated as unchanged. |
| Checkpoint fork and handoff | Fork at a chosen message and separately from current context; select workspace reuse/new workspace as offered. | Fork contains the correct prefix and parent relationship and executes in the chosen environment. |
| Side chat | Follow plugin-side-chat for selected-message forks and Send to main. | Main history remains untouched until an explicit send-back queues content. |
| File links and external links | Open an absolute file link with a line number, thread-storage attachment, and HTTP link. | Correct file/line/source opens; external/embedded browser policy is respected. |
| Custom plugin renderers and unknown events | Render enabled plugin cards and toggle Show unhandled provider events for an unsupported event fixture. | Recognized cards function; unsupported events have the intended fallback without crashing the timeline. |

## Evidence and cleanup

Record a result for each row separately, including the chosen entry point,
initial state, action, resulting state, and relevant persisted value. Repeat
mutations through the available agent interface to establish parity. Preserve
failed attempts and prerequisites; source documentation is not a passing test.
Restore preferences and remove only the fixtures and sessions created by this
recipe. External writes require a disposable test target and task authorization.

## Maintenance notes

- Check sourceThreadId for fork lineage and the recorded source checkpoint; parentThreadId can be null. Verify reuse/new environment only where the selected fork action offers it. Source: `apps/cli/src/commands/thread/fork.ts; apps/cli/src/commands/thread/show.ts`.
