import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const entityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const cursorSchema = z.string().min(1).max(4096);
export const taskStatusSchema = z.enum([
  "Incomplete",
  "Pending",
  "Completed",
  "Archived",
]);
export const taskPrioritySchema = z.enum(["Low", "Medium", "High", "Urgent"]);
export const apiErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "INVALID_CURSOR",
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "INVALID_AUDIENCE",
  "INSUFFICIENT_SCOPE",
  "PERMISSION_DENIED",
  "FEATURE_DISABLED",
  "RESOURCE_NOT_FOUND",
  "VERSION_CONFLICT",
  "DUPLICATE_MUTATION",
  "WIP_LIMIT_WARNING",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "INTERNAL_ERROR",
]);
export const clientErrorCodeSchema = z.union([
  apiErrorCodeSchema,
  z.enum([
    "NOT_CONNECTED",
    "CONNECTION_CANCELLED",
    "NETWORK_ERROR",
    "INVALID_CONFIGURATION",
  ]),
]);
export const clientErrorSchema = z
  .object({
    code: clientErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    requestId: z.string().min(1).max(200).optional(),
    currentVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

export const userSummarySchema = z
  .object({ id: entityIdSchema, displayName: z.string().max(255) })
  .strict();
export const projectSummarySchema = z
  .object({
    id: entityIdSchema,
    name: z.string().max(255),
    description: z.string().nullable(),
    status: z.string().max(100),
    health: z.string().max(100),
    owner: userSummarySchema.nullable(),
    taskTableId: entityIdSchema,
    memberCount: z.number().int().nonnegative(),
    taskCount: z.number().int().nonnegative(),
    inProgressCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
  })
  .strict();
export const projectPhaseSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().max(255),
    description: z.string().nullable(),
    color: z.string().max(100).nullable(),
    order: z.number().int(),
    wipLimit: z.number().int().nonnegative().nullable(),
    taskCount: z.number().int().nonnegative(),
  })
  .strict();
export const projectMilestoneSchema = z
  .object({
    id: entityIdSchema,
    phaseId: entityIdSchema.nullable(),
    name: z.string().max(255),
    status: z.string().max(100),
    targetDate: isoDateTimeSchema.nullable(),
    order: z.number().int(),
  })
  .strict();
export const capabilitiesSchema = z
  .object({
    createTask: z.boolean(),
    editTask: z.boolean(),
    moveTask: z.boolean(),
    assignTask: z.boolean(),
    viewComments: z.boolean(),
    createComment: z.boolean(),
    readFiles: z.boolean(),
  })
  .strict();
export const projectBoardSchema = z
  .object({
    project: projectSummarySchema,
    phases: z.array(projectPhaseSchema),
    milestones: z.array(projectMilestoneSchema),
    members: z.array(userSummarySchema),
    capabilities: capabilitiesSchema,
  })
  .strict();
export const taskSummarySchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema,
    phaseId: entityIdSchema.nullable(),
    milestoneId: entityIdSchema.nullable(),
    parentTaskId: entityIdSchema.nullable(),
    title: z.string().max(255),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    assignees: z.array(userSummarySchema),
    startDate: isoDateTimeSchema.nullable(),
    dueDate: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
    version: z.number().int().min(1),
  })
  .strict();
export const taskDetailSchema = taskSummarySchema
  .extend({
    description: z.string().nullable(),
    commentCount: z.number().int().nonnegative().optional(),
    attachmentCount: z.number().int().nonnegative().optional(),
    capabilities: capabilitiesSchema,
  })
  .strict();
export const commentViewSchema = z
  .object({
    id: entityIdSchema,
    taskId: entityIdSchema,
    replyToCommentId: entityIdSchema.nullable(),
    author: userSummarySchema,
    text: z.string().max(2500),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export const attachmentViewSchema = z
  .object({
    id: entityIdSchema,
    source: z
      .object({ type: z.enum(["Task", "Comment"]), id: entityIdSchema })
      .strict(),
    name: z.string().max(255),
    contentType: z.string().max(255),
    sizeBytes: z.number().int().nonnegative().nullable(),
    createdAt: isoDateTimeSchema,
    previewable: z.boolean(),
  })
  .strict();

const uuidSchema = z.string().uuid();
const uniqueIdsSchema = z
  .array(entityIdSchema)
  .max(100)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "IDs must be unique" });
    }
  });
export const createTaskInputSchema = z
  .object({
    clientMutationId: uuidSchema,
    title: z.string().trim().min(1).max(255),
    description: z.string().max(20_000).nullable().optional(),
    phaseId: entityIdSchema,
    milestoneId: entityIdSchema.nullable().optional(),
    assigneeIds: uniqueIdsSchema.optional(),
    priority: taskPrioritySchema.optional(),
    startDate: isoDateTimeSchema.nullable().optional(),
    dueDate: isoDateTimeSchema.nullable().optional(),
    parentTaskId: entityIdSchema.nullable().optional(),
    acknowledgeWipLimit: z.boolean().optional(),
  })
  .strict();
export const patchTaskInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(20_000).nullable().optional(),
    priority: taskPrioritySchema.optional(),
    startDate: isoDateTimeSchema.nullable().optional(),
    dueDate: isoDateTimeSchema.nullable().optional(),
    milestoneId: entityIdSchema.nullable().optional(),
    status: taskStatusSchema.exclude(["Archived"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), {
    message: "At least one task field is required",
  });
export const moveTaskInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    phaseId: entityIdSchema,
    acknowledgeWipLimit: z.boolean().optional(),
  })
  .strict();
export const assignTaskInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    assigneeIds: uniqueIdsSchema,
  })
  .strict();
export const createCommentInputSchema = z
  .object({
    clientMutationId: uuidSchema,
    text: z.string().trim().min(1).max(2500),
    replyToCommentId: entityIdSchema.nullable().optional(),
  })
  .strict();

export const projectListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    query: z.string().trim().max(255).optional(),
    status: z.string().trim().max(100).optional(),
    health: z.string().trim().max(100).optional(),
    mine: z.boolean().optional(),
  })
  .strict();
export const taskListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(75).optional(),
    phaseId: entityIdSchema.optional(),
    assigneeId: entityIdSchema.optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    query: z.string().trim().max(255).optional(),
    includeArchived: z.boolean().optional(),
  })
  .strict();
export const attachmentListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    source: z.enum(["task", "comments", "all"]).optional(),
  })
  .strict();
export const commentListQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const connectionStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("disconnected") }).strict(),
  z.object({ state: z.literal("starting") }).strict(),
  z
    .object({
      state: z.literal("awaiting_user"),
      verificationUri: z.string().url(),
      userCode: z.string().min(1).max(100),
      expiresAt: isoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("connected"),
      account: userSummarySchema,
      workspace: z.object({ id: entityIdSchema, name: z.string() }).strict(),
      expiresAt: isoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("refreshing"),
      account: userSummarySchema,
      workspace: z.object({ id: entityIdSchema, name: z.string() }).strict(),
    })
    .strict(),
  z.object({ state: z.literal("expired"), reason: z.string().max(500) }).strict(),
  z.object({ state: z.literal("error"), error: clientErrorSchema }).strict(),
]);

const emptySchema = z.object({}).strict();
const result = <T extends z.ZodType>(schema: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data: schema }).strict(),
    z.object({ ok: z.literal(false), error: clientErrorSchema }).strict(),
  ]);
const cursorPage = <T extends z.ZodType>(schema: T) =>
  z.object({ items: z.array(schema), nextCursor: z.string().nullable() }).strict();

export const attachmentPreviewTicketSchema = z
  .object({
    ticket: z.string().min(32).max(200),
    expiresAt: isoDateTimeSchema,
    attachment: attachmentViewSchema,
  })
  .strict();
export const previewClientNonceSchema = z.string().uuid();

export const tyriaProjectsRpcContract = defineRpcContract({
  "connection.get": { input: emptySchema, output: result(connectionStateSchema) },
  "connection.start": { input: emptySchema, output: result(connectionStateSchema) },
  "connection.poll": { input: emptySchema, output: result(connectionStateSchema) },
  "connection.disconnect": {
    input: emptySchema,
    output: result(z.object({ state: z.literal("disconnected") }).strict()),
  },
  "projects.list": { input: projectListQuerySchema, output: result(cursorPage(projectSummarySchema)) },
  "projects.board": {
    input: z.object({ projectId: entityIdSchema }).strict(),
    output: result(projectBoardSchema),
  },
  "tasks.list": {
    input: z.object({ projectId: entityIdSchema, query: taskListQuerySchema }).strict(),
    output: result(cursorPage(taskSummarySchema)),
  },
  "tasks.get": {
    input: z.object({ projectId: entityIdSchema, taskId: entityIdSchema }).strict(),
    output: result(taskDetailSchema),
  },
  "tasks.create": {
    input: z.object({ projectId: entityIdSchema, input: createTaskInputSchema }).strict(),
    output: result(taskDetailSchema),
  },
  "tasks.patch": {
    input: z.object({ projectId: entityIdSchema, taskId: entityIdSchema, input: patchTaskInputSchema }).strict(),
    output: result(taskDetailSchema),
  },
  "tasks.move": {
    input: z.object({ projectId: entityIdSchema, taskId: entityIdSchema, input: moveTaskInputSchema }).strict(),
    output: result(taskDetailSchema),
  },
  "tasks.assign": {
    input: z.object({ projectId: entityIdSchema, taskId: entityIdSchema, input: assignTaskInputSchema }).strict(),
    output: result(taskDetailSchema),
  },
  "comments.list": {
    input: z.object({ projectId: entityIdSchema, taskId: entityIdSchema, query: commentListQuerySchema }).strict(),
    output: result(cursorPage(commentViewSchema)),
  },
  "comments.create": {
    input: z.object({ projectId: entityIdSchema, taskId: entityIdSchema, input: createCommentInputSchema }).strict(),
    output: result(commentViewSchema),
  },
  "attachments.list": {
    input: z.object({ projectId: entityIdSchema, taskId: entityIdSchema, query: attachmentListQuerySchema }).strict(),
    output: result(cursorPage(attachmentViewSchema)),
  },
  "attachments.previewTicket": {
    input: z.object({ projectId: entityIdSchema, taskId: entityIdSchema, fileId: entityIdSchema, clientNonce: previewClientNonceSchema }).strict(),
    output: result(attachmentPreviewTicketSchema),
  },
});

export const confirmationPayloadSchema = z
  .object({
    kind: z.enum(["create", "update", "move", "assign", "comment", "attachment"]),
    title: z.string().min(1).max(255),
    details: z.array(z.string().min(1).max(500)).max(12),
    warning: z.string().max(1000).nullable(),
  })
  .strict();
export const confirmationResponseSchema = z.object({ confirmed: z.literal(true) }).strict();

export type ClientError = z.infer<typeof clientErrorSchema>;
export type ConnectionState = z.infer<typeof connectionStateSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectBoard = z.infer<typeof projectBoardSchema>;
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export type CommentView = z.infer<typeof commentViewSchema>;
export type AttachmentView = z.infer<typeof attachmentViewSchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type PatchTaskInput = z.infer<typeof patchTaskInputSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskInputSchema>;
export type AssignTaskInput = z.infer<typeof assignTaskInputSchema>;
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;
export type AttachmentListQuery = z.infer<typeof attachmentListQuerySchema>;
