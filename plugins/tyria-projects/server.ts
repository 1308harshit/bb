import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginAgentToolContext,
  type PluginAgentToolResult,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import path from "node:path";
import { z } from "zod";
import {
  assignTaskInputSchema,
  attachmentPreviewTicketSchema,
  confirmationPayloadSchema,
  confirmationResponseSchema,
  createCommentInputSchema,
  createTaskInputSchema,
  entityIdSchema,
  moveTaskInputSchema,
  patchTaskInputSchema,
  previewClientNonceSchema,
  taskPrioritySchema,
  tyriaProjectsRpcContract,
  type AttachmentView,
  type ClientError,
  type ConnectionState,
} from "./contract.js";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  ALLOWED_IMAGE_TYPES,
  DEFAULT_TYRIA_BASE_URL,
  DEFAULT_TYRIA_CLIENT_ID,
  MAX_ATTACHMENT_BYTES,
  TyriaClientFailure,
  TyriaProjectsClient,
  asClientError,
  randomTicket,
  validateTyriaOrigin,
} from "./src/client.js";

const PREVIEW_TTL_MS = 30_000;
const CONFIRM_RENDERER = "confirm-tyria-action";
const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
const YES_OPTION = {
  type: "boolean",
  description: "Confirm this Tyria mutation or attachment transmission",
} as const;
const PROJECT_OPTION = {
  type: "string",
  required: true,
  description: "Tyria project ID",
} as const;
const TASK_OPTION = {
  type: "string",
  required: true,
  description: "Tyria task ID",
} as const;

type RpcResult<T> = { ok: true; data: T } | { ok: false; error: ClientError };

interface PreviewTicketRecord {
  projectId: string;
  taskId: string;
  fileId: string;
  accountId: string;
  workspaceId: string;
  attachment: AttachmentView;
  expiresAtMs: number;
}

export class PreviewTicketVault<T extends { expiresAtMs: number }> {
  private readonly records = new Map<string, { value: T; clientHash: Buffer }>();

  issue(ticket: string, clientNonce: string, value: T): void {
    this.records.set(ticket, { value, clientHash: createHash("sha256").update(clientNonce).digest() });
  }

  consume(ticket: string, clientNonce: string, now = Date.now()): T | null {
    const record = this.records.get(ticket);
    this.records.delete(ticket);
    if (!record || record.value.expiresAtMs <= now) return null;
    const presentedHash = createHash("sha256").update(clientNonce).digest();
    return timingSafeEqual(record.clientHash, presentedHash) ? record.value : null;
  }

  clear(): void {
    this.records.clear();
  }
}

function ok<T>(data: T): RpcResult<T> {
  return { ok: true, data };
}

function failed(error: unknown): { ok: false; error: ClientError } {
  return { ok: false, error: asClientError(error) };
}

function compact(value: unknown): string {
  return JSON.stringify(value);
}

function toolError(error: unknown): PluginAgentToolResult {
  return { content: [{ type: "text", text: compact({ error: asClientError(error) }) }], isError: true };
}

function requireYes(value: boolean, targets: readonly string[]): void {
  if (!value) {
    const summary = targets
      .map((target) => target.trim().replace(/\s+/gu, " ").slice(0, 120))
      .filter(Boolean)
      .slice(0, 8)
      .join("; ")
      .slice(0, 600);
    throw new PluginCliError(`Confirmation required: ${summary}. Review this target, then rerun the command with --yes. This BB plugin host cannot prompt on CLI stdin.`, {
      code: "confirmation_required",
      exitCode: 2,
    });
  }
}

export function buildAttachmentConfirmation(args: {
  projectName: string;
  taskTitle: string;
  attachment: AttachmentView;
  accountName: string;
  workspaceName: string;
}): z.infer<typeof confirmationPayloadSchema> {
  return confirmationPayloadSchema.parse({
    kind: "attachment",
    title: "Send Tyria attachment to Meta Muse?",
    details: [
      `Project: ${args.projectName}`,
      `Task: ${args.taskTitle}`,
      `File: ${args.attachment.name}`,
      `Type: ${args.attachment.contentType}`,
      `Size: ${args.attachment.sizeBytes ?? "unknown"} bytes`,
      "Destination: Meta Muse",
      `Account: ${args.accountName}`,
      `Workspace: ${args.workspaceName}`,
    ],
    warning: "Approval downloads this file from Tyria and transmits its pixels to Meta Muse. The content may become part of the Muse conversation history.",
  });
}

export function buildApprovedAttachmentResult(image: { data: string; mimeType: string }): PluginAgentToolResult {
  return {
    content: [
      { type: "text", text: "Approved Tyria attachment image" },
      { type: "image", data: image.data, mimeType: image.mimeType },
    ],
  };
}

function cliResult(value: unknown, json: boolean, label: string): PluginCliResult {
  return { exitCode: 0, stdout: json ? compact({ ok: true, data: value }) : label };
}

function cliFailure(error: unknown, json: boolean): PluginCliResult {
  const clientError = asClientError(error);
  return {
    exitCode:
      clientError.code === "INVALID_REQUEST" || clientError.code === "INVALID_CONFIGURATION" || clientError.code === "CONNECTION_CANCELLED"
        ? 2
        : clientError.code === "UNAUTHENTICATED" || clientError.code === "NOT_CONNECTED"
          ? 3
          : clientError.code === "RESOURCE_NOT_FOUND" || clientError.code === "PERMISSION_DENIED" || clientError.code === "INSUFFICIENT_SCOPE" || clientError.code === "FEATURE_DISABLED"
            ? 4
            : clientError.code === "VERSION_CONFLICT"
              ? 5
              : clientError.code === "RATE_LIMITED" || clientError.code === "NETWORK_ERROR" || clientError.code === "UPSTREAM_UNAVAILABLE"
                ? 6
                : 1,
    ...(json
      ? { stdout: compact({ error: clientError }) }
      : { stderr: `${clientError.code}: ${clientError.message}` }),
  };
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    tyriaBaseUrl: {
      type: "string",
      label: "Tyria URL",
      description: "Exact HTTPS origin of the Tyria installation.",
      default: DEFAULT_TYRIA_BASE_URL,
      experimental_schema: z.string().superRefine((value, context) => {
        try {
          validateTyriaOrigin(value);
        } catch {
          context.addIssue({ code: "custom", message: "Use an HTTPS origin without a path, query, or credentials." });
        }
      }),
    },
    tyriaClientId: {
      type: "string",
      label: "Tyria OAuth client ID",
      description: "Public device-flow client registered by Tyria.",
      default: DEFAULT_TYRIA_CLIENT_ID,
      experimental_schema: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/u),
    },
    tyriaRefreshToken: {
      type: "string",
      label: "Tyria refresh token",
      description: "Rotating OAuth credential. Managed automatically after connection.",
      secret: true,
    },
  });

  const client = new TyriaProjectsClient({
    async getConfig() {
      const current = await settings.get();
      return {
        baseUrl: current.tyriaBaseUrl,
        clientId: current.tyriaClientId,
        refreshToken: current.tyriaRefreshToken || undefined,
      };
    },
    async setRefreshToken(value) {
      await settings.experimental_set({ tyriaRefreshToken: value ?? "" });
    },
  });
  const previewTickets = new PreviewTicketVault<PreviewTicketRecord>();
  bb.onDispose(() => {
    client.dispose();
    previewTickets.clear();
  });

  async function run<T>(operation: () => Promise<T>): Promise<RpcResult<T>> {
    try {
      return ok(await operation());
    } catch (error) {
      return failed(error);
    }
  }

  async function connectedGrant(): Promise<Extract<ConnectionState, { state: "connected" }>> {
    const state = await client.getConnection();
    if (state.state !== "connected") {
      throw new TyriaClientFailure({ code: "NOT_CONNECTED", message: "Connect Tyria to continue.", retryable: false });
    }
    return state;
  }

  function changed(): void {
    bb.realtime.publish("tyria-projects:changed", {});
  }

  bb.rpc.register(tyriaProjectsRpcContract, {
    "connection.get": () => run(() => client.getConnection()),
    "connection.start": () => run(async () => {
      const state = await client.startConnection();
      bb.realtime.publish("tyria-projects:connection", {});
      return state;
    }),
    "connection.poll": () => run(async () => {
      const state = await client.pollConnection();
      bb.realtime.publish("tyria-projects:connection", {});
      return state;
    }),
    "connection.disconnect": () => run(async () => {
      await client.disconnect();
      previewTickets.clear();
      bb.realtime.publish("tyria-projects:connection", {});
      return { state: "disconnected" as const };
    }),
    "projects.list": (input) => run(() => client.listProjects(input)),
    "projects.board": ({ projectId }) => run(() => client.getBoard(projectId)),
    "tasks.list": ({ projectId, query }) => run(() => client.listTasks(projectId, query)),
    "tasks.get": ({ projectId, taskId }) => run(() => client.getTask(projectId, taskId)),
    "tasks.create": ({ projectId, input }) => run(async () => {
      const value = await client.createTask(projectId, input);
      changed();
      return value;
    }),
    "tasks.patch": ({ projectId, taskId, input }) => run(async () => {
      const value = await client.patchTask(projectId, taskId, input);
      changed();
      return value;
    }),
    "tasks.move": ({ projectId, taskId, input }) => run(async () => {
      const value = await client.moveTask(projectId, taskId, input);
      changed();
      return value;
    }),
    "tasks.assign": ({ projectId, taskId, input }) => run(async () => {
      const value = await client.assignTask(projectId, taskId, input);
      changed();
      return value;
    }),
    "comments.list": ({ projectId, taskId, query }) => run(() => client.listComments(projectId, taskId, query)),
    "comments.create": ({ projectId, taskId, input }) => run(async () => {
      const value = await client.createComment(projectId, taskId, input);
      changed();
      return value;
    }),
    "attachments.list": ({ projectId, taskId, query }) => run(() => client.listAttachments(projectId, taskId, query)),
    "attachments.previewTicket": ({ projectId, taskId, fileId, clientNonce }) => run(async () => {
      const [grant, attachment] = await Promise.all([
        connectedGrant(),
        client.findAttachment(projectId, taskId, fileId),
      ]);
      if (!attachment.previewable || !ALLOWED_IMAGE_TYPES.has(attachment.contentType.toLowerCase())) {
        throw new TyriaClientFailure({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Only PNG and JPEG attachments can be previewed.", retryable: false });
      }
      if (attachment.sizeBytes !== null && attachment.sizeBytes > MAX_ATTACHMENT_BYTES) {
        throw new TyriaClientFailure({ code: "PAYLOAD_TOO_LARGE", message: "This attachment exceeds the 10 MiB limit.", retryable: false });
      }
      const ticket = randomTicket();
      const expiresAtMs = Date.now() + PREVIEW_TTL_MS;
      previewTickets.issue(ticket, clientNonce, {
        projectId,
        taskId,
        fileId,
        accountId: grant.account.id,
        workspaceId: grant.workspace.id,
        attachment,
        expiresAtMs,
      });
      return attachmentPreviewTicketSchema.parse({
        ticket,
        expiresAt: new Date(expiresAtMs).toISOString(),
        attachment,
      });
    }),
  });

  bb.http.route("POST", "/attachment-preview", async (context) => {
    let ticket: string;
    let clientNonce: string;
    try {
      const raw = await context.req.raw.json();
      const parsed = z.object({ ticket: z.string().min(32).max(200), clientNonce: previewClientNonceSchema }).strict().parse(raw);
      ticket = parsed.ticket;
      clientNonce = parsed.clientNonce;
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const record = previewTickets.consume(ticket, clientNonce);
    if (!record) {
      return Response.json({ error: "ticket_expired" }, { status: 410 });
    }
    try {
      const grant = await connectedGrant();
      if (grant.account.id !== record.accountId || grant.workspace.id !== record.workspaceId) {
        return Response.json({ error: "grant_changed" }, { status: 403 });
      }
      const attachment = await client.findAttachment(record.projectId, record.taskId, record.fileId);
      if (
        attachment.id !== record.attachment.id ||
        attachment.contentType !== record.attachment.contentType ||
        attachment.sizeBytes !== record.attachment.sizeBytes ||
        !attachment.previewable ||
        !ALLOWED_IMAGE_TYPES.has(attachment.contentType.toLowerCase())
      ) {
        return Response.json({ error: "attachment_changed" }, { status: 409 });
      }
      const upstream = await client.attachmentResponse(record.projectId, record.taskId, record.fileId);
      const mimeType = (upstream.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(mimeType) || mimeType !== attachment.contentType.toLowerCase()) {
        return Response.json({ error: "unsupported_media_type" }, { status: 415 });
      }
      if (!upstream.body) return Response.json({ error: "empty_attachment" }, { status: 502 });
      let streamedBytes = 0;
      const body = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          streamedBytes += chunk.byteLength;
          if (streamedBytes > MAX_ATTACHMENT_BYTES) {
            controller.error(new Error("attachment size limit exceeded"));
            return;
          }
          controller.enqueue(chunk);
        },
      }));
      const safeName = attachment.name.replace(/[^A-Za-z0-9._ -]/gu, "_").slice(0, 180) || "attachment";
      return new Response(body, {
        headers: {
          "cache-control": "no-store",
          "content-disposition": `inline; filename="${safeName}"`,
          "content-security-policy": "default-src 'none'; sandbox",
          "content-type": mimeType,
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      const apiError = asClientError(error);
      return Response.json({ error: apiError.code }, { status: apiError.code === "NOT_CONNECTED" ? 401 : 502 });
    }
  });

  async function confirm(
    context: PluginAgentToolContext,
    payload: z.infer<typeof confirmationPayloadSchema>,
  ): Promise<boolean> {
    const result = await bb.ui.requestInput(
      {
        threadId: context.threadId,
        rendererId: CONFIRM_RENDERER,
        title: payload.title,
        payload,
        timeoutMs: 10 * 60_000,
        presentation: {
          label: { pending: "Waiting for Tyria approval", completed: "Reviewed Tyria action" },
          icon: { glyph: "FolderKanban" },
        },
        describeSubmission: () => ({ title: "Approved Tyria Projects action" }),
      },
      { signal: context.signal },
    );
    if (result.outcome !== "submitted") return false;
    return confirmationResponseSchema.safeParse(result.value).success;
  }

  function registerMutationTool<T extends z.ZodType>(args: {
    name: string;
    description: string;
    schema: T;
    payload(input: z.output<T>): Promise<z.infer<typeof confirmationPayloadSchema>>;
    mutate(input: z.output<T>): Promise<unknown>;
  }): void {
    bb.agents.registerTool({
      name: args.name,
      description: args.description,
      parameters: args.schema,
      presentation: { label: { pending: "Reviewing Tyria action", completed: "Updated Tyria" }, icon: { glyph: "FolderKanban" } },
      async execute(input, context) {
        try {
          if (!(await confirm(context, await args.payload(input)))) {
            return compact({ cancelled: true });
          }
          const value = await args.mutate(input);
          changed();
          return compact(value);
        } catch (error) {
          return toolError(error);
        }
      },
    });
  }

  bb.agents.registerTool({
    name: "tyria_projects_list",
    description: "List Tyria projects available to the connected user.",
    parameters: tyriaProjectsRpcContract["projects.list"].input,
    async execute(input) {
      try { return compact(await client.listProjects(input)); } catch (error) { return toolError(error); }
    },
  });
  bb.agents.registerTool({
    name: "tyria_project_board",
    description: "Read a Tyria project board, phases, members, milestones, and capabilities.",
    parameters: tyriaProjectsRpcContract["projects.board"].input,
    async execute({ projectId }) {
      try { return compact(await client.getBoard(projectId)); } catch (error) { return toolError(error); }
    },
  });
  bb.agents.registerTool({
    name: "tyria_task_get",
    description: "Read one Tyria task.",
    parameters: tyriaProjectsRpcContract["tasks.get"].input,
    async execute({ projectId, taskId }) {
      try { return compact(await client.getTask(projectId, taskId)); } catch (error) { return toolError(error); }
    },
  });
  bb.agents.registerTool({
    name: "tyria_tasks_list",
    description: "List tasks in a Tyria project.",
    parameters: tyriaProjectsRpcContract["tasks.list"].input,
    async execute({ projectId, query }) {
      try { return compact(await client.listTasks(projectId, query)); } catch (error) { return toolError(error); }
    },
  });

  bb.agents.registerTool({
    name: "tyria_comments_list",
    description: "List comments on an authorized Tyria task.",
    parameters: tyriaProjectsRpcContract["comments.list"].input,
    async execute({ projectId, taskId, query }) {
      try { return compact(await client.listComments(projectId, taskId, query)); } catch (error) { return toolError(error); }
    },
  });
  bb.agents.registerTool({
    name: "tyria_attachments_list",
    description: "List authorized attachment metadata for a Tyria task without downloading content.",
    parameters: tyriaProjectsRpcContract["attachments.list"].input,
    async execute({ projectId, taskId, query }) {
      try { return compact(await client.listAttachments(projectId, taskId, query)); } catch (error) { return toolError(error); }
    },
  });

  const createToolSchema = tyriaProjectsRpcContract["tasks.create"].input;
  registerMutationTool({
    name: "tyria_task_create",
    description: "Create a Tyria task after showing the user an approval form.",
    schema: createToolSchema,
    async payload(input) {
      const [board, grant] = await Promise.all([client.getBoard(input.projectId), connectedGrant()]);
      const phase = board.phases.find((entry) => entry.id === input.input.phaseId);
      return confirmationPayloadSchema.parse({ kind: "create", title: "Create Tyria task?", details: [`Project: ${board.project.name}`, `Phase: ${phase?.name ?? input.input.phaseId}`, `Task: ${input.input.title}`, `Account: ${grant.account.displayName}`, `Workspace: ${grant.workspace.name}`], warning: input.input.acknowledgeWipLimit ? "This request acknowledges a phase WIP-limit warning." : null });
    },
    mutate: (input) => client.createTask(input.projectId, input.input),
  });

  const updateToolSchema = tyriaProjectsRpcContract["tasks.patch"].input;
  registerMutationTool({
    name: "tyria_task_update",
    description: "Update a Tyria task after showing the user an approval form.",
    schema: updateToolSchema,
    async payload(input) {
      const [task, board, grant] = await Promise.all([client.getTask(input.projectId, input.taskId), client.getBoard(input.projectId), connectedGrant()]);
      return confirmationPayloadSchema.parse({ kind: "update", title: "Update Tyria task?", details: [`Project: ${board.project.name}`, `Task: ${task.title}`, `Expected version: ${input.input.expectedVersion}`, `Fields: ${Object.keys(input.input).filter((key) => key !== "expectedVersion").join(", ")}`, `Account: ${grant.account.displayName}`, `Workspace: ${grant.workspace.name}`], warning: null });
    },
    mutate: ({ projectId, taskId, input }) => client.patchTask(projectId, taskId, input),
  });

  const moveToolSchema = tyriaProjectsRpcContract["tasks.move"].input;
  registerMutationTool({
    name: "tyria_task_move",
    description: "Move a Tyria task to a board phase after showing the user an approval form.",
    schema: moveToolSchema,
    async payload(input) {
      const [task, board, grant] = await Promise.all([client.getTask(input.projectId, input.taskId), client.getBoard(input.projectId), connectedGrant()]);
      return confirmationPayloadSchema.parse({ kind: "move", title: "Move Tyria task?", details: [`Project: ${board.project.name}`, `Task: ${task.title}`, `Destination: ${board.phases.find((phase) => phase.id === input.input.phaseId)?.name ?? input.input.phaseId}`, `Account: ${grant.account.displayName}`, `Workspace: ${grant.workspace.name}`], warning: input.input.acknowledgeWipLimit ? "This move acknowledges a phase WIP-limit warning." : null });
    },
    mutate: ({ projectId, taskId, input }) => client.moveTask(projectId, taskId, input),
  });

  const assignToolSchema = tyriaProjectsRpcContract["tasks.assign"].input;
  registerMutationTool({
    name: "tyria_task_assign",
    description: "Replace a Tyria task's assignees after showing the user an approval form.",
    schema: assignToolSchema,
    async payload(input) {
      const [task, board, grant] = await Promise.all([client.getTask(input.projectId, input.taskId), client.getBoard(input.projectId), connectedGrant()]);
      const names = input.input.assigneeIds.map((id) => board.members.find((member) => member.id === id)?.displayName ?? id);
      return confirmationPayloadSchema.parse({ kind: "assign", title: "Change Tyria task assignees?", details: [`Project: ${board.project.name}`, `Task: ${task.title}`, `Assignees: ${names.join(", ") || "none"}`, `Account: ${grant.account.displayName}`, `Workspace: ${grant.workspace.name}`], warning: null });
    },
    mutate: ({ projectId, taskId, input }) => client.assignTask(projectId, taskId, input),
  });

  const commentToolSchema = tyriaProjectsRpcContract["comments.create"].input;
  registerMutationTool({
    name: "tyria_comment_add",
    description: "Add a Tyria task comment after showing the user an approval form.",
    schema: commentToolSchema,
    async payload(input) {
      const [task, board, grant] = await Promise.all([client.getTask(input.projectId, input.taskId), client.getBoard(input.projectId), connectedGrant()]);
      return confirmationPayloadSchema.parse({ kind: "comment", title: "Post Tyria comment?", details: [`Project: ${board.project.name}`, `Task: ${task.title}`, `Comment length: ${input.input.text.length} characters`, `Account: ${grant.account.displayName}`, `Workspace: ${grant.workspace.name}`], warning: "The exact comment text will be sent to Tyria." });
    },
    mutate: ({ projectId, taskId, input }) => client.createComment(projectId, taskId, input),
  });

  bb.agents.registerTool({
    name: "tyria_attachment_analyze",
    description: "Read a PNG or JPEG Tyria task attachment for Muse analysis after explicit user approval.",
    parameters: z.object({ projectId: entityIdSchema, taskId: entityIdSchema, fileId: entityIdSchema }).strict(),
    presentation: { label: { pending: "Reviewing Tyria attachment", completed: "Read Tyria attachment" }, icon: { glyph: "FolderKanban" } },
    async execute(input, context) {
      try {
        const [attachment, task, board, grant] = await Promise.all([client.findAttachment(input.projectId, input.taskId, input.fileId), client.getTask(input.projectId, input.taskId), client.getBoard(input.projectId), connectedGrant()]);
        const approved = await confirm(context, buildAttachmentConfirmation({ projectName: board.project.name, taskTitle: task.title, attachment, accountName: grant.account.displayName, workspaceName: grant.workspace.name }));
        if (!approved) return compact({ cancelled: true });
        const image = await client.attachmentImage(input.projectId, input.taskId, input.fileId);
        return buildApprovedAttachmentResult(image);
      } catch (error) {
        return toolError(error);
      }
    },
  });

  bb.agents.configure(() => ({
    tools: client.isConnected()
      ? ["tyria_projects_list", "tyria_project_board", "tyria_tasks_list", "tyria_task_get", "tyria_task_create", "tyria_task_update", "tyria_task_move", "tyria_task_assign", "tyria_comments_list", "tyria_comment_add", "tyria_attachments_list", "tyria_attachment_analyze"]
      : [],
    skills: client.isConnected() ? ["tyria-projects"] : [],
  }));

  const withCli = async (json: boolean, operation: () => Promise<unknown>, label: (value: unknown) => string): Promise<PluginCliResult> => {
    try {
      const value = await operation();
      return cliResult(value, json, label(value));
    } catch (error) {
      if (error instanceof PluginCliError) throw error;
      return cliFailure(error, json);
    }
  };
  const resolveCliPath = (context: PluginCliContext, candidate: string): string => {
    if (path.posix.isAbsolute(candidate)) return path.posix.normalize(candidate);
    if (path.win32.isAbsolute(candidate)) return path.win32.normalize(candidate);
    if (!context.cwd) throw new PluginCliError("Relative file paths require the invoking working directory.", { code: "missing_cwd", exitCode: 2 });
    return path.win32.isAbsolute(context.cwd) ? path.win32.resolve(context.cwd, candidate) : path.posix.resolve(context.cwd, candidate);
  };
  const resolveCliHost = async (context: PluginCliContext): Promise<string | undefined> => {
    if (context.threadId) {
      const thread = await bb.sdk.threads.get({ threadId: context.threadId, include: "host" });
      const host = "host" in thread ? thread.host : null;
      if (host && typeof host === "object" && "id" in host && typeof host.id === "string") return host.id;
    }
    return (await bb.sdk.system.config()).primaryHostId ?? undefined;
  };
  const fileArgs = async (context: PluginCliContext, candidate: string) => {
    const hostId = await resolveCliHost(context);
    return { ...(hostId ? { hostId } : {}), path: resolveCliPath(context, candidate), signal: context.signal };
  };
  const readTextFile = async (context: PluginCliContext, candidate: string): Promise<string> => {
    const result = await bb.sdk.files.read(await fileArgs(context, candidate));
    if (result.contentEncoding !== "utf8") throw new PluginCliError("Input file must be UTF-8 text.", { code: "invalid_text_file", exitCode: 2 });
    return result.content;
  };
  const httpStatus = (error: unknown): number | null => {
    if (!error || typeof error !== "object" || !("status" in error)) return null;
    return typeof error.status === "number" ? error.status : null;
  };
  const downloadAttachment = async (context: PluginCliContext, args: { projectId: string; taskId: string; fileId: string; output: string; overwrite: boolean }) => {
    const attachment = await client.findAttachment(args.projectId, args.taskId, args.fileId);
    const response = await client.attachmentResponse(args.projectId, args.taskId, args.fileId);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new TyriaClientFailure({ code: "PAYLOAD_TOO_LARGE", message: "This attachment exceeds the 10 MiB limit.", retryable: false });
    const target = await fileArgs(context, args.output);
    let expectedSha256: string | null = null;
    try {
      const existing = await bb.sdk.files.read(target);
      if (!args.overwrite) throw new PluginCliError("Output already exists; pass --overwrite --yes to replace it.", { code: "output_exists", exitCode: 2 });
      expectedSha256 = existing.sha256;
    } catch (error) {
      if (error instanceof PluginCliError) throw error;
      if (httpStatus(error) !== 404) throw error;
    }
    const written = await bb.sdk.files.write({
      ...target,
      content: bytes.toString("base64"),
      contentEncoding: "base64",
      createParents: true,
      expectedSha256,
      mode: 0o600,
    });
    if (written.outcome !== "written") throw new TyriaClientFailure({ code: "VERSION_CONFLICT", message: "The output file changed before it could be written.", retryable: false });
    return { attachment, path: target.path, bytes: bytes.byteLength };
  };
  const listOptions = { json: JSON_OPTION, cursor: { type: "string", description: "Opaque Tyria pagination cursor" }, limit: { type: "integer", min: 1, max: 100, default: 50, description: "Maximum rows to return" } } as const;
  bb.cli.register(defineCli({
    name: "tyria",
    summary: "Read and manage Tyria Projects",
    usageErrorExitCode: 2,
    commands: {
      status: cliCommand({ summary: "Show Tyria connection status", options: { json: JSON_OPTION }, run: (input) => withCli(input.options.json, () => client.getConnection(), (value) => compact(value)) }),
      connect: cliCommand({ summary: "Start or poll the Tyria device authorization flow", options: { json: JSON_OPTION }, run: (input) => withCli(input.options.json, async () => { const state = await client.getConnection(); return state.state === "awaiting_user" ? client.pollConnection() : client.startConnection(); }, (value) => compact(value)) }),
      disconnect: cliCommand({ summary: "Revoke the local Tyria grant", options: { json: JSON_OPTION, yes: YES_OPTION }, run: (input) => { requireYes(input.options.yes, ["Action: disconnect the current local Tyria grant"]); return withCli(input.options.json, async () => { await client.disconnect(); previewTickets.clear(); return { state: "disconnected" }; }, () => "Disconnected Tyria"); } }),
      "projects list": cliCommand({ summary: "List Tyria projects", options: { ...listOptions, query: { type: "string", description: "Search project names" } }, run: (input) => withCli(input.options.json, () => client.listProjects({ cursor: input.options.cursor, limit: input.options.limit, query: input.options.query }), compact) }),
      "projects show": cliCommand({ summary: "Show a Tyria project board", options: { json: JSON_OPTION, project: PROJECT_OPTION }, run: (input) => withCli(input.options.json, () => client.getBoard(input.options.project), compact) }),
      "tasks list": cliCommand({ summary: "List Tyria project tasks", options: { ...listOptions, project: PROJECT_OPTION, phase: { type: "string", description: "Phase ID" }, query: { type: "string", description: "Search task titles" } }, run: (input) => withCli(input.options.json, () => client.listTasks(input.options.project, { cursor: input.options.cursor, limit: Math.min(input.options.limit, 75), phaseId: input.options.phase, query: input.options.query }), compact) }),
      "tasks show": cliCommand({ summary: "Show one Tyria task", options: { json: JSON_OPTION, project: PROJECT_OPTION, task: TASK_OPTION }, run: (input) => withCli(input.options.json, () => client.getTask(input.options.project, input.options.task), compact) }),
      "tasks create": cliCommand({ summary: "Create a Tyria task", constraints: [{ kind: "at-most-one", options: ["description", "description-file"] }], options: { json: JSON_OPTION, yes: YES_OPTION, project: PROJECT_OPTION, phase: { type: "string", required: true, description: "Destination phase ID" }, title: { type: "string", required: true, description: "Task title" }, description: { type: "string", stdin: true, description: "Task description; prefer --description-stdin to avoid shell history" }, "description-file": { type: "string", description: "UTF-8 file containing the task description" }, priority: { type: "enum", values: taskPrioritySchema.options, description: "Task priority" }, "acknowledge-wip-limit": { type: "boolean", description: "Accept a server-reported WIP warning" } }, run: (input, context) => { requireYes(input.options.yes, [`Action: create task`, `Project: ${input.options.project}`, `Phase: ${input.options.phase}`]); return withCli(input.options.json, async () => client.createTask(input.options.project, createTaskInputSchema.parse({ clientMutationId: crypto.randomUUID(), title: input.options.title, phaseId: input.options.phase, description: input.options["description-file"] ? await readTextFile(context, input.options["description-file"]) : input.options.description, priority: input.options.priority, acknowledgeWipLimit: input.options["acknowledge-wip-limit"] || undefined })), compact); } }),
      "tasks edit": cliCommand({ summary: "Edit a Tyria task", constraints: [{ kind: "at-most-one", options: ["description", "description-file"] }], options: { json: JSON_OPTION, yes: YES_OPTION, project: PROJECT_OPTION, task: TASK_OPTION, version: { type: "integer", required: true, min: 1, max: 2_147_483_647, description: "Expected task version" }, title: { type: "string", description: "Replacement title" }, description: { type: "string", stdin: true, description: "Replacement description; prefer --description-stdin" }, "description-file": { type: "string", description: "UTF-8 file containing the replacement description" }, priority: { type: "enum", values: taskPrioritySchema.options, description: "Replacement priority" } }, run: (input, context) => { requireYes(input.options.yes, [`Action: edit task`, `Project: ${input.options.project}`, `Task: ${input.options.task}`, `Expected version: ${input.options.version}`]); return withCli(input.options.json, async () => client.patchTask(input.options.project, input.options.task, patchTaskInputSchema.parse({ expectedVersion: input.options.version, title: input.options.title, description: input.options["description-file"] ? await readTextFile(context, input.options["description-file"]) : input.options.description, priority: input.options.priority })), compact); } }),
      "tasks move": cliCommand({ summary: "Move a Tyria task to a phase", options: { json: JSON_OPTION, yes: YES_OPTION, project: PROJECT_OPTION, task: TASK_OPTION, version: { type: "integer", required: true, min: 1, max: 2_147_483_647, description: "Expected task version" }, phase: { type: "string", required: true, description: "Destination phase ID" }, "acknowledge-wip-limit": { type: "boolean", description: "Accept a server-reported WIP warning" } }, run: (input) => { requireYes(input.options.yes, [`Action: move task`, `Project: ${input.options.project}`, `Task: ${input.options.task}`, `Destination phase: ${input.options.phase}`, `Expected version: ${input.options.version}`]); return withCli(input.options.json, () => client.moveTask(input.options.project, input.options.task, moveTaskInputSchema.parse({ expectedVersion: input.options.version, phaseId: input.options.phase, acknowledgeWipLimit: input.options["acknowledge-wip-limit"] || undefined })), compact); } }),
      "tasks assign": cliCommand({ summary: "Replace Tyria task assignees", options: { json: JSON_OPTION, yes: YES_OPTION, project: PROJECT_OPTION, task: TASK_OPTION, version: { type: "integer", required: true, min: 1, max: 2_147_483_647, description: "Expected task version" }, assignee: { type: "string", repeatable: true, split: ",", description: "Assignee ID; repeat or comma-separate; omit all to unassign" } }, run: (input) => { requireYes(input.options.yes, [`Action: replace task assignees`, `Project: ${input.options.project}`, `Task: ${input.options.task}`, `Assignee count: ${input.options.assignee?.length ?? 0}`, `Expected version: ${input.options.version}`]); return withCli(input.options.json, () => client.assignTask(input.options.project, input.options.task, assignTaskInputSchema.parse({ expectedVersion: input.options.version, assigneeIds: input.options.assignee ?? [] })), compact); } }),
      "comments list": cliCommand({ summary: "List Tyria task comments", options: { ...listOptions, project: PROJECT_OPTION, task: TASK_OPTION }, run: (input) => withCli(input.options.json, () => client.listComments(input.options.project, input.options.task, { cursor: input.options.cursor, limit: input.options.limit }), compact) }),
      "comments add": cliCommand({ summary: "Add a Tyria task comment", constraints: [{ kind: "exactly-one", options: ["text", "text-file"] }], options: { json: JSON_OPTION, yes: YES_OPTION, project: PROJECT_OPTION, task: TASK_OPTION, text: { type: "string", stdin: true, description: "Comment text; prefer --text-stdin to avoid shell history" }, "text-file": { type: "string", description: "UTF-8 file containing the complete comment" } }, run: (input, context) => { requireYes(input.options.yes, [`Action: add task comment`, `Project: ${input.options.project}`, `Task: ${input.options.task}`, `Source: ${input.options["text-file"] ? "UTF-8 file" : "inline/stdin text"}`]); return withCli(input.options.json, async () => client.createComment(input.options.project, input.options.task, createCommentInputSchema.parse({ clientMutationId: crypto.randomUUID(), text: input.options["text-file"] ? await readTextFile(context, input.options["text-file"]) : input.options.text })), compact); } }),
      "attachments list": cliCommand({ summary: "List Tyria task attachments", options: { ...listOptions, project: PROJECT_OPTION, task: TASK_OPTION }, run: (input) => withCli(input.options.json, () => client.listAttachments(input.options.project, input.options.task, { cursor: input.options.cursor, limit: input.options.limit, source: "all" }), compact) }),
      "attachments download": cliCommand({ summary: "Download a Tyria attachment to a host file", description: "Requires --yes because attachment content crosses the Tyria trust boundary. Never writes bytes to stdout and caps downloads at 10 MiB.", options: { json: JSON_OPTION, yes: YES_OPTION, overwrite: { type: "boolean", description: "Replace an existing output file; also requires --yes" }, project: PROJECT_OPTION, task: TASK_OPTION, file: { type: "string", required: true, description: "Attachment file ID" }, output: { type: "string", required: true, description: "Destination path on the invoking or primary BB host" } }, run: (input, context) => { requireYes(input.options.yes, [`Action: download attachment`, `Project: ${input.options.project}`, `Task: ${input.options.task}`, `File: ${input.options.file}`, `Output: ${input.options.output}`]); return withCli(input.options.json, () => downloadAttachment(context, { projectId: input.options.project, taskId: input.options.task, fileId: input.options.file, output: input.options.output, overwrite: input.options.overwrite }), (value) => { const result = value as { path: string; bytes: number }; return `Downloaded ${result.bytes} bytes to ${result.path}`; }); } }),
    },
  }));
}
