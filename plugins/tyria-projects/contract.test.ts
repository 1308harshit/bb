import { describe, expect, it } from "vitest";
import {
  createTaskInputSchema,
  patchTaskInputSchema,
  projectListQuerySchema,
  tyriaProjectsRpcContract,
} from "./contract.js";

describe("Tyria Projects contract", () => {
  it("rejects unknown keys at every public input boundary", () => {
    expect(projectListQuerySchema.safeParse({ limit: 50, token: "secret" }).success).toBe(false);
    expect(createTaskInputSchema.safeParse({ clientMutationId: crypto.randomUUID(), title: "Task", phaseId: "phase_1", extra: true }).success).toBe(false);
    expect(tyriaProjectsRpcContract["tasks.get"].input.safeParse({ projectId: "project_1", taskId: "task_1", extra: true }).success).toBe(false);
  });

  it("requires a real patch and rejects archived status", () => {
    expect(patchTaskInputSchema.safeParse({ expectedVersion: 0, title: "Task" }).success).toBe(false);
    expect(patchTaskInputSchema.safeParse({ expectedVersion: 3 }).success).toBe(false);
    expect(patchTaskInputSchema.safeParse({ expectedVersion: 3, status: "Archived" }).success).toBe(false);
    expect(patchTaskInputSchema.safeParse({ expectedVersion: 3, status: "Completed" }).success).toBe(true);
  });

  it("matches Tyria's 20,000-character task description limit", () => {
    const base = { clientMutationId: crypto.randomUUID(), title: "Task", phaseId: "phase_1" };
    expect(createTaskInputSchema.safeParse({ ...base, description: "x".repeat(20_000) }).success).toBe(true);
    expect(createTaskInputSchema.safeParse({ ...base, description: "x".repeat(20_001) }).success).toBe(false);
    expect(patchTaskInputSchema.safeParse({ expectedVersion: 1, description: "x".repeat(20_000) }).success).toBe(true);
    expect(patchTaskInputSchema.safeParse({ expectedVersion: 1, description: "x".repeat(20_001) }).success).toBe(false);
  });

  it("rejects duplicate assignees and unsafe identifiers", () => {
    const base = { clientMutationId: crypto.randomUUID(), title: "Task", phaseId: "phase_1" };
    expect(createTaskInputSchema.safeParse({ ...base, assigneeIds: ["user_1", "user_1"] }).success).toBe(false);
    expect(tyriaProjectsRpcContract["tasks.get"].input.safeParse({ projectId: "../other", taskId: "task_1" }).success).toBe(false);
  });

  it("matches Tyria's opaque identifier alphabet", () => {
    for (const id of ["project_1", "task-1", "task:01HF7YAT00ABC123", "A9:_-"]) {
      expect(tyriaProjectsRpcContract["tasks.get"].input.safeParse({ projectId: id, taskId: id }).success).toBe(true);
    }
    for (const id of ["task/1", "task.1", "task 1", "task@1", "task\\1"]) {
      expect(tyriaProjectsRpcContract["tasks.get"].input.safeParse({ projectId: "project_1", taskId: id }).success).toBe(false);
    }
  });

  it("accepts Tyria's combined task and comment attachment source", () => {
    expect(tyriaProjectsRpcContract["attachments.list"].input.safeParse({
      projectId: "project_1",
      taskId: "task_1",
      query: { limit: 100, source: "all" },
    }).success).toBe(true);
    expect(tyriaProjectsRpcContract["attachments.list"].input.safeParse({
      projectId: "project_1",
      taskId: "task_1",
      query: { source: "everything" },
    }).success).toBe(false);
  });

  it("requires an ephemeral browser-instance nonce for preview tickets", () => {
    const base = { projectId: "project_1", taskId: "task_1", fileId: "file_1" };
    expect(tyriaProjectsRpcContract["attachments.previewTicket"].input.safeParse(base).success).toBe(false);
    expect(tyriaProjectsRpcContract["attachments.previewTicket"].input.safeParse({ ...base, clientNonce: crypto.randomUUID() }).success).toBe(true);
  });
});
