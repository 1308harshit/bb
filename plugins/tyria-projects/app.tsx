import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmationPayloadSchema,
  type AttachmentView,
  type ClientError,
  type CommentView,
  type ConnectionState,
  type ProjectBoard,
  type ProjectSummary,
  type TaskDetail,
  type TaskSummary,
  tyriaProjectsRpcContract,
} from "./contract.js";

const PREVIEW_URL = "/api/v1/plugins/tyria-projects/http/attachment-preview";
const BOARD_TASK_LIMIT = 1_000;
const DETAIL_PAGE_LIMIT = 100;
const DETAIL_ITEM_LIMIT = 500;

export function attachmentListSource(capabilities: Pick<TaskDetail["capabilities"], "readFiles" | "viewComments">): "all" | "task" | null {
  if (!capabilities.readFiles) return null;
  return capabilities.viewComments ? "all" : "task";
}

export function canPresentAttachment(attachment: AttachmentView, capabilities: Pick<TaskDetail["capabilities"], "readFiles" | "viewComments">): boolean {
  if (!capabilities.readFiles) return false;
  return attachment.source.type === "Task" || capabilities.viewComments;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ErrorNotice({ error, retry }: { error: ClientError | string; retry?: () => void }) {
  const text = typeof error === "string" ? error : `${error.message}${error.requestId ? ` (${error.requestId})` : ""}`;
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p>{text}</p>
      {retry ? <Button className="mt-2" size="sm" variant="outline" onClick={retry}>Retry</Button> : null}
    </div>
  );
}

function ConfirmTyriaAction({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const parsed = useMemo(() => confirmationPayloadSchema.safeParse(interaction.payload), [interaction.payload]);
  const [busy, setBusy] = useState(false);
  if (!parsed.success) {
    return <div role="alert" className="space-y-3"><p>This Tyria action could not be displayed safely.</p><Button variant="outline" onClick={() => void cancel()}>Cancel</Button></div>;
  }
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{parsed.data.title}</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {parsed.data.details.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
      </div>
      {parsed.data.warning ? <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{parsed.data.warning}</p> : null}
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void cancel()}>Cancel</Button>
        <Button disabled={busy} onClick={() => { setBusy(true); void submit({ confirmed: true }).finally(() => setBusy(false)); }}>Confirm</Button>
      </div>
    </div>
  );
}

function useConnection() {
  const rpc = useRpc<typeof tyriaProjectsRpcContract>();
  const [state, setState] = useState<ConnectionState | null>(null);
  const [error, setError] = useState<ClientError | string | null>(null);
  const load = useCallback(async (method: "connection.get" | "connection.start" | "connection.poll" | "connection.disconnect") => {
    try {
      const result = await rpc.call(method, {});
      if (!result.ok) setError(result.error);
      else { setState(result.data as ConnectionState); setError(null); }
    } catch (reason) { setError(message(reason)); }
  }, [rpc]);
  useEffect(() => { void load("connection.get"); }, [load]);
  useEffect(() => {
    if (state?.state !== "awaiting_user") return;
    const timer = window.setInterval(() => void load("connection.poll"), 2_000);
    return () => window.clearInterval(timer);
  }, [load, state?.state]);
  useRealtime("tyria-projects:connection", () => void load("connection.get"));
  return { state, error, load };
}

function ConnectionPanel({ connection }: { connection: ReturnType<typeof useConnection> }) {
  const navigate = useBbNavigate();
  const { state, error, load } = connection;
  const [verificationFallback, setVerificationFallback] = useState(false);
  const [verificationCopied, setVerificationCopied] = useState(false);
  if (error) return <div className="space-y-3"><ErrorNotice error={error} retry={() => void load("connection.get")} /><Button onClick={() => void load("connection.start")}>Connect Tyria</Button></div>;
  if (!state || state.state === "starting" || state.state === "refreshing") return <p role="status" className="text-sm text-muted-foreground">Connecting to Tyria…</p>;
  if (state.state === "awaiting_user") return (
    <div className="space-y-4">
      <div><h2 className="text-lg font-semibold">Approve Tyria access</h2><p className="text-sm text-muted-foreground">Open Tyria and enter this one-time code. It expires at {new Date(state.expiresAt).toLocaleTimeString()}.</p></div>
      <output className="block rounded-md border bg-muted p-4 text-center font-mono text-xl tracking-widest">{state.userCode}</output>
      <div className="flex flex-wrap gap-2"><Button onClick={() => { if (!navigate.openUrl(state.verificationUri)) setVerificationFallback(true); }}>Open Tyria</Button><Button variant="outline" onClick={() => void load("connection.disconnect")}>Cancel</Button></div>
      {verificationFallback ? <div role="status" className="space-y-2 rounded-md border bg-muted p-3 text-sm"><p>BB could not open your browser. Copy this verification URL and open it yourself:</p><code className="block break-all select-all">{state.verificationUri}</code><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(state.verificationUri).then(() => setVerificationCopied(true)).catch(() => setVerificationCopied(false)); }}>{verificationCopied ? "Copied" : "Copy URL"}</Button></div> : null}
    </div>
  );
  if (state.state === "error") return <div className="space-y-3"><ErrorNotice error={state.error} retry={() => void load("connection.get")} /><Button onClick={() => void load("connection.start")}>Reconnect</Button></div>;
  if (state.state === "expired") return <div className="space-y-3"><ErrorNotice error={state.reason} /><Button onClick={() => void load("connection.start")}>Reconnect Tyria</Button></div>;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Connect Tyria Projects</h2>
      <p className="text-sm text-muted-foreground">Authorize this local BB installation to use your Tyria Projects access. BB stores one rotating refresh token as a server-side secret.</p>
      <Button onClick={() => void load("connection.start")}>Connect Tyria</Button>
    </div>
  );
}

function Projects({ onOpen }: { onOpen: (project: ProjectSummary) => void }) {
  const rpc = useRpc<typeof tyriaProjectsRpcContract>();
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClientError | string | null>(null);
  const requestId = useRef(0);
  const load = useCallback(async (nextCursor?: string) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const normalizedQuery = query.trim();
      const result = await rpc.call("projects.list", { limit: 50, ...(normalizedQuery ? { query: normalizedQuery } : {}), ...(nextCursor ? { cursor: nextCursor } : {}) });
      if (id !== requestId.current) return;
      if (!result.ok) { setError(result.error); return; }
      setProjects((current) => nextCursor ? [...current, ...result.data.items] : result.data.items);
      setCursor(result.data.nextCursor);
      setError(null);
    } catch (reason) { setError(message(reason)); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [query, rpc]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  useRealtime("tyria-projects:changed", () => void load());
  return (
    <section className="space-y-4" aria-labelledby="projects-heading">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="projects-heading" className="text-lg font-semibold">Tyria Projects</h2><p className="text-sm text-muted-foreground">Projects you are allowed to view.</p></div><Button size="sm" variant="outline" onClick={() => void load()}>Refresh</Button></div>
      <label className="block text-sm font-medium">Search projects<Input className="mt-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" /></label>
      {error ? <ErrorNotice error={error} retry={() => void load()} /> : null}
      {loading && projects.length === 0 ? <p role="status" className="text-sm text-muted-foreground">Loading projects…</p> : null}
      {!loading && !error && projects.length === 0 ? <p className="rounded-md border p-4 text-sm text-muted-foreground">No accessible projects matched this view.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <button key={project.id} type="button" className="rounded-lg border bg-card p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(project)}>
            <span className="break-words font-semibold">{project.name}</span><span className="mt-1 block break-words text-sm text-muted-foreground">{project.description || "No description"}</span><span className="mt-3 block text-xs">{project.taskCount} tasks · {project.inProgressCount} in progress · {project.completedCount} completed</span><span className="mt-1 block break-words text-xs text-muted-foreground">Status: {project.status} · Health: {project.health}</span>
          </button>
        ))}
      </div>
      {cursor ? <Button variant="outline" disabled={loading} onClick={() => void load(cursor)}>Load more</Button> : null}
    </section>
  );
}

function NewTask({ board, open, close, done }: { board: ProjectBoard; open: boolean; close: () => void; done: (task: TaskDetail) => void }) {
  const rpc = useRpc<typeof tyriaProjectsRpcContract>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [phaseId, setPhaseId] = useState(board.phases[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ClientError | string | null>(null);
  const submit = async (acknowledgeWipLimit = false) => {
    setPending(true);
    try {
      const result = await rpc.call("tasks.create", { projectId: board.project.id, input: { clientMutationId: crypto.randomUUID(), title, description: description || null, phaseId, acknowledgeWipLimit: acknowledgeWipLimit || undefined } });
      if (!result.ok) { setError(result.error); return; }
      done(result.data);
    } catch (reason) { setError(message(reason)); }
    finally { setPending(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <DialogContent>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <DialogHeader><DialogTitle>Create task</DialogTitle><DialogDescription>Add a task to {board.project.name}. Tyria applies the project&apos;s permissions and WIP rules.</DialogDescription></DialogHeader>
          <label className="block text-sm">Title<Input required maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="block text-sm">Description<Textarea maxLength={20000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label className="block text-sm">Phase<select className="mt-1 h-9 w-full rounded-md border bg-background px-3" value={phaseId} onChange={(event) => setPhaseId(event.target.value)}>{board.phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select></label>
          {error ? <div><ErrorNotice error={error} />{typeof error !== "string" && error.code === "WIP_LIMIT_WARNING" ? <Button className="mt-2" type="button" variant="outline" onClick={() => void submit(true)}>Acknowledge limit and create</Button> : null}</div> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={pending || !title.trim() || !phaseId}>Create</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskPanel({ board, taskId, close, changed }: { board: ProjectBoard; taskId: string; close: () => void; changed: () => void }) {
  const rpc = useRpc<typeof tyriaProjectsRpcContract>();
  const navigate = useBbNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const [commentsTruncated, setCommentsTruncated] = useState(false);
  const [attachmentsTruncated, setAttachmentsTruncated] = useState(false);
  const [error, setError] = useState<ClientError | string | null>(null);
  const [comment, setComment] = useState("");
  const [preview, setPreview] = useState<{ url: string; attachment: AttachmentView } | null>(null);
  const [wipMovePhaseId, setWipMovePhaseId] = useState<string | null>(null);
  const [previewClientNonce] = useState(() => crypto.randomUUID());
  const load = useCallback(async () => {
    try {
      const taskResult = await rpc.call("tasks.get", { projectId: board.project.id, taskId });
      if (!taskResult.ok) { setError(taskResult.error); setTask(null); return; }
      setTask(taskResult.data); setError(null);
      setComments([]); setAttachments([]); setCommentsTruncated(false); setAttachmentsTruncated(false);
      const loadedComments: CommentView[] = [];
      let commentCursor: string | undefined;
      let reachedCommentLimit = false;
      if (taskResult.data.capabilities.viewComments) {
        for (let pageIndex = 0; pageIndex < DETAIL_ITEM_LIMIT / DETAIL_PAGE_LIMIT; pageIndex += 1) {
          const page = await rpc.call("comments.list", { projectId: board.project.id, taskId, query: { limit: DETAIL_PAGE_LIMIT, ...(commentCursor ? { cursor: commentCursor } : {}) } });
          if (!page.ok) { setError(page.error); return; }
          loadedComments.push(...page.data.items);
          commentCursor = page.data.nextCursor ?? undefined;
          if (!commentCursor) break;
          if (pageIndex === DETAIL_ITEM_LIMIT / DETAIL_PAGE_LIMIT - 1) reachedCommentLimit = true;
        }
      }
      const loadedAttachments: AttachmentView[] = [];
      let attachmentCursor: string | undefined;
      let reachedAttachmentLimit = false;
      const attachmentSource = attachmentListSource(taskResult.data.capabilities);
      if (attachmentSource) {
        for (let pageIndex = 0; pageIndex < DETAIL_ITEM_LIMIT / DETAIL_PAGE_LIMIT; pageIndex += 1) {
          const page = await rpc.call("attachments.list", { projectId: board.project.id, taskId, query: { limit: DETAIL_PAGE_LIMIT, source: attachmentSource, ...(attachmentCursor ? { cursor: attachmentCursor } : {}) } });
          if (!page.ok) { setError(page.error); return; }
          loadedAttachments.push(...page.data.items.filter((attachment) => canPresentAttachment(attachment, taskResult.data.capabilities)));
          attachmentCursor = page.data.nextCursor ?? undefined;
          if (!attachmentCursor) break;
          if (pageIndex === DETAIL_ITEM_LIMIT / DETAIL_PAGE_LIMIT - 1) reachedAttachmentLimit = true;
        }
      }
      setComments(loadedComments);
      setAttachments(loadedAttachments);
      setCommentsTruncated(reachedCommentLimit);
      setAttachmentsTruncated(reachedAttachmentLimit);
    } catch (reason) { setError(message(reason)); }
  }, [board.project.id, rpc, taskId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const mutate = async (method: "tasks.patch" | "tasks.move" | "tasks.assign", input: Record<string, unknown>, acknowledgeWipLimit = false) => {
    if (!task) return;
    try {
      const fullInput = { expectedVersion: task.version, ...input, ...(acknowledgeWipLimit ? { acknowledgeWipLimit: true } : {}) };
      const result = await rpc.call(method, { projectId: board.project.id, taskId, input: fullInput } as never);
      if (!result.ok) {
        setError(result.error);
        setWipMovePhaseId(method === "tasks.move" && result.error.code === "WIP_LIMIT_WARNING" && typeof input.phaseId === "string" ? input.phaseId : null);
        return;
      }
      setTask(result.data); setError(null); setWipMovePhaseId(null); changed();
    } catch (reason) { setError(message(reason)); }
  };
  const previewAttachment = async (attachment: AttachmentView) => {
    try {
      const result = await rpc.call("attachments.previewTicket", { projectId: board.project.id, taskId, fileId: attachment.id, clientNonce: previewClientNonce });
      if (!result.ok) { setError(result.error); return; }
      const response = await fetch(PREVIEW_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: result.data.ticket, clientNonce: previewClientNonce }), cache: "no-store" });
      if (!response.ok) throw new Error("The attachment preview could not be loaded.");
      const url = URL.createObjectURL(await response.blob());
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ url, attachment });
    } catch (reason) { setError(message(reason)); }
  };
  if (!task) return <aside className="space-y-3 rounded-lg border p-4" aria-live="polite">{error ? <ErrorNotice error={error} retry={() => void load()} /> : <p>Loading task…</p>}<Button variant="outline" onClick={close}>Back to board</Button></aside>;
  return (
    <aside className="min-w-0 space-y-5 rounded-lg border bg-card p-4" aria-labelledby="task-title">
      <div className="flex items-start justify-between gap-3"><div><h3 id="task-title" className="text-lg font-semibold">{task.title}</h3><p className="text-xs text-muted-foreground">Version {task.version} · {task.status} · {task.priority}</p></div><Button size="sm" variant="outline" onClick={close}>Close</Button></div>
      {error ? <div><ErrorNotice error={error} retry={() => void load()} />{typeof error !== "string" && error.code === "VERSION_CONFLICT" ? <Button className="mt-2" variant="outline" onClick={() => void load()}>Refresh current task</Button> : null}{typeof error !== "string" && error.code === "WIP_LIMIT_WARNING" && wipMovePhaseId ? <Button className="mt-2" variant="outline" onClick={() => void mutate("tasks.move", { phaseId: wipMovePhaseId }, true)}>Acknowledge limit and move</Button> : null}</div> : null}
      <p className="whitespace-pre-wrap break-words text-sm">{task.description || "No description"}</p>
      {task.capabilities.editTask ? <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Title<Input defaultValue={task.title} onBlur={(event) => { if (event.target.value.trim() && event.target.value !== task.title) void mutate("tasks.patch", { title: event.target.value }); }} /></label><label className="text-sm">Priority<select className="mt-1 h-9 w-full rounded-md border bg-background px-3" value={task.priority} onChange={(event) => void mutate("tasks.patch", { priority: event.target.value })}>{["Low", "Medium", "High", "Urgent"].map((value) => <option key={value}>{value}</option>)}</select></label></div> : null}
      {task.capabilities.moveTask ? <label className="block text-sm">Move to phase<select aria-label="Move task to phase" className="mt-1 h-9 w-full rounded-md border bg-background px-3" value={task.phaseId ?? ""} onChange={(event) => void mutate("tasks.move", { phaseId: event.target.value })}>{board.phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select></label> : null}
      {task.capabilities.assignTask ? <fieldset><legend className="text-sm font-medium">Assignees</legend><div className="mt-2 flex flex-wrap gap-2">{board.members.map((member) => { const checked = task.assignees.some((entry) => entry.id === member.id); return <label key={member.id} className="flex items-center gap-1 rounded border px-2 py-1 text-sm"><input type="checkbox" checked={checked} onChange={() => { const ids = checked ? task.assignees.filter((entry) => entry.id !== member.id).map((entry) => entry.id) : [...task.assignees.map((entry) => entry.id), member.id]; void mutate("tasks.assign", { assigneeIds: ids }); }} />{member.displayName}</label>; })}</div></fieldset> : null}
      {task.capabilities.viewComments ? <section className="min-w-0 space-y-3"><h4 className="font-medium">Comments</h4>{commentsTruncated ? <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Showing the first {DETAIL_ITEM_LIMIT} authorized comments. Use the paginated BB CLI to inspect the remaining comments.</p> : null}{comments.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : comments.map((entry) => <article key={entry.id} className="min-w-0 rounded border p-3 text-sm"><p className="whitespace-pre-wrap break-words">{entry.text}</p><p className="mt-2 break-words text-xs text-muted-foreground">{entry.author.displayName} · {new Date(entry.createdAt).toLocaleString()}</p></article>)}{task.capabilities.createComment ? <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void rpc.call("comments.create", { projectId: board.project.id, taskId, input: { clientMutationId: crypto.randomUUID(), text: comment } }).then((result) => { if (result.ok) { setComment(""); setComments((current) => [result.data, ...current].slice(0, DETAIL_ITEM_LIMIT)); changed(); } else setError(result.error); }); }}><label className="block text-sm">Add comment<Textarea required maxLength={2500} value={comment} onChange={(event) => setComment(event.target.value)} /></label><Button size="sm" disabled={!comment.trim()}>Post comment</Button></form> : null}</section> : null}
      {task.capabilities.readFiles ? <section className="space-y-3"><h4 className="font-medium">Attachments</h4>{attachmentsTruncated ? <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Showing the first {DETAIL_ITEM_LIMIT} authorized attachments. Use the paginated BB CLI to inspect the remaining files.</p> : null}{attachments.length === 0 ? <p className="text-sm text-muted-foreground">No accessible attachments.</p> : attachments.map((attachment) => <div key={attachment.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"><span className="min-w-0 break-words">{attachment.name} · {attachment.contentType} · {attachment.sizeBytes ?? "unknown"} bytes</span><span className="flex flex-wrap gap-2">{attachment.previewable ? <Button size="sm" variant="outline" onClick={() => void previewAttachment(attachment)}>Preview</Button> : null}{attachment.previewable ? <Button size="sm" variant="outline" onClick={() => navigate.toCompose({ initialPrompt: `Use tyria_attachment_analyze for projectId ${board.project.id}, taskId ${taskId}, fileId ${attachment.id}. Ask me for the required confirmation before downloading or transmitting it.`, focusPrompt: true })}>Analyze with Muse</Button> : null}</span></div>)}</section> : null}
      {preview ? <div role="dialog" aria-label={`Preview ${preview.attachment.name}`} className="space-y-2 rounded border p-3"><p className="text-sm font-medium">{preview.attachment.name}</p><p className="text-xs text-muted-foreground">Sensitive content remains in memory and is not stored by BB.</p><img className="max-h-[60vh] max-w-full rounded object-contain" src={preview.url} alt={`Tyria attachment ${preview.attachment.name}`} /><Button size="sm" variant="outline" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>Close preview</Button></div> : null}
    </aside>
  );
}

function Board({ project, back }: { project: ProjectSummary; back: () => void }) {
  const rpc = useRpc<typeof tyriaProjectsRpcContract>();
  const [board, setBoard] = useState<ProjectBoard | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<ClientError | string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const load = useCallback(async () => {
    try {
      const boardResult = await rpc.call("projects.board", { projectId: project.id });
      if (!boardResult.ok) { setError(boardResult.error); return; }
      setBoard(boardResult.data);
      const loaded: TaskSummary[] = [];
      let reachedLimit = false;
      phasePages: for (const [phaseIndex, phase] of boardResult.data.phases.entries()) {
        let cursor: string | undefined;
        do {
          const page = await rpc.call("tasks.list", { projectId: project.id, query: { phaseId: phase.id, limit: 75, ...(cursor ? { cursor } : {}) } });
          if (!page.ok) { setError(page.error); return; }
          const remaining = BOARD_TASK_LIMIT - loaded.length;
          loaded.push(...page.data.items.slice(0, remaining));
          if (loaded.length >= BOARD_TASK_LIMIT) {
            reachedLimit = page.data.items.length > remaining || page.data.nextCursor !== null || phaseIndex < boardResult.data.phases.length - 1;
            break phasePages;
          }
          cursor = page.data.nextCursor ?? undefined;
        } while (cursor);
      }
      setTasks(loaded);
      setTruncated(reachedLimit);
      setError(null);
    } catch (reason) { setError(message(reason)); }
  }, [project.id, rpc]);
  useEffect(() => { void load(); }, [load]);
  useRealtime("tyria-projects:changed", () => void load());
  if (!board) return <div className="space-y-3"><Button variant="outline" onClick={back}>Back to projects</Button>{error ? <ErrorNotice error={error} retry={() => void load()} /> : <p role="status">Loading {project.name} board…</p>}</div>;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><Button size="sm" variant="outline" onClick={back}>Back to projects</Button><h2 className="mt-2 text-lg font-semibold">{board.project.name}</h2><p className="text-sm text-muted-foreground">Dynamic Tyria phases · keyboard-accessible move controls are in each task.</p></div>{board.capabilities.createTask ? <Button onClick={() => setCreating(true)}>Create task</Button> : null}</div>
      {error ? <ErrorNotice error={error} retry={() => void load()} /> : null}
      {truncated ? <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Showing the first {BOARD_TASK_LIMIT.toLocaleString()} authorized tasks. Refine the board in Tyria or use the paginated BB CLI to inspect the remaining tasks.</p> : null}
      <NewTask board={board} open={creating} close={() => setCreating(false)} done={(task) => { setCreating(false); setSelected(task.id); void load(); }} />
      <div data-testid="tyria-board-grid" className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">{board.phases.map((phase) => { const phaseTasks = tasks.filter((task) => task.phaseId === phase.id); return <section key={phase.id} aria-labelledby={`phase-${phase.id}`} className="min-w-0 rounded-lg border bg-muted/30"><header className="border-b p-3"><h3 id={`phase-${phase.id}`} className="break-words font-semibold">{phase.name}</h3><p className="text-xs text-muted-foreground">{phaseTasks.length} visible tasks{phase.wipLimit === null ? " · no WIP limit" : ` · WIP limit ${phase.wipLimit}`}</p></header><div className="space-y-2 p-2">{phaseTasks.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No tasks in {phase.name}.</p> : phaseTasks.map((task) => <button key={task.id} type="button" className="block w-full min-w-0 rounded-md border bg-card p-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelected(task.id)}><span className="block break-words font-medium">{task.title}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{task.status} · {task.priority} · v{task.version}</span><span className="mt-1 block break-words text-xs">{task.assignees.map((entry) => entry.displayName).join(", ") || "Unassigned"}</span></button>)}</div></section>; })}</div>
      {selected ? <TaskPanel board={board} taskId={selected} close={() => setSelected(null)} changed={() => void load()} /> : null}
    </section>
  );
}

function TyriaProjectsPanel(_props: PluginNavPanelProps) {
  const connection = useConnection();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  if (connection.state?.state !== "connected") return <main className="mx-auto max-w-3xl p-4 sm:p-6"><ConnectionPanel connection={connection} /></main>;
  return (
    <main className="min-w-0 space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3 text-sm"><span>Connected as <strong>{connection.state.account.displayName}</strong> · {connection.state.workspace.name}</span><Button size="sm" variant="outline" onClick={() => void connection.load("connection.disconnect")}>Disconnect</Button></div>
      {project ? <Board project={project} back={() => setProject(null)} /> : <Projects onOpen={setProject} />}
    </main>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "tyria-projects", title: "Tyria Projects", icon: "FolderKanban", path: "projects", component: TyriaProjectsPanel });
  app.slots.pendingInteraction({ id: "confirm-tyria-action", component: ConfirmTyriaAction });
});
