// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

const now = "2026-10-07T12:00:00.000Z";
const capabilities = {
  createTask: true,
  editTask: true,
  moveTask: true,
  assignTask: true,
  viewComments: true,
  createComment: true,
  readFiles: true,
};
const project = {
  id: "project:alpha",
  name: "Project Alpha",
  description: "A test project",
  status: "Active",
  health: "On track",
  owner: { id: "user:owner", displayName: "Owner" },
  taskTableId: "table:alpha",
  memberCount: 1,
  taskCount: 1,
  inProgressCount: 1,
  completedCount: 0,
  blockedCount: 0,
  createdAt: now,
};
const board = {
  project,
  phases: [
    { id: "phase:backlog", name: "Backlog", description: null, color: null, order: 0, wipLimit: null, taskCount: 1 },
    { id: "phase:done", name: "Done", description: null, color: null, order: 1, wipLimit: null, taskCount: 0 },
  ],
  milestones: [],
  members: [{ id: "user:owner", displayName: "Owner" }],
  capabilities,
};
const task = {
  id: "task:one",
  projectId: project.id,
  phaseId: "phase:backlog",
  milestoneId: null,
  parentTaskId: null,
  title: "Inspect attachments",
  status: "Incomplete" as const,
  priority: "Medium" as const,
  assignees: [],
  startDate: null,
  dueDate: null,
  createdAt: now,
  completedAt: null,
  version: 1,
};

afterEach(() => cleanup());

function rpcHandlers(taskCapabilities = capabilities, attachmentPages?: (input: unknown) => unknown) {
  return {
    "connection.get": () => ({ ok: true, data: { state: "connected", account: { id: "user:owner", displayName: "Owner" }, workspace: { id: "workspace:tyria", name: "Tyria" }, expiresAt: now } }),
    "projects.list": () => ({ ok: true, data: { items: [project], nextCursor: null } }),
    "projects.board": () => ({ ok: true, data: { ...board, capabilities: taskCapabilities } }),
    "tasks.list": (input: unknown) => {
      const phaseId = (input as { query?: { phaseId?: string } }).query?.phaseId;
      return { ok: true, data: { items: phaseId === task.phaseId ? [task] : [], nextCursor: null } };
    },
    "tasks.get": () => ({ ok: true, data: { ...task, description: "Task details", commentCount: 0, attachmentCount: 2, capabilities: taskCapabilities } }),
    "comments.list": () => ({ ok: true, data: { items: [], nextCursor: null } }),
    "attachments.list": attachmentPages ?? (() => ({ ok: true, data: { items: [], nextCursor: null } })),
  };
}

async function openBoard(rpc = rpcHandlers()) {
  const panel = app.navPanels[0];
  if (!panel) throw new Error("Tyria Projects panel was not registered");
  const slot = renderSlot(panel, { subPath: "" }, { rpc });
  fireEvent.click(await slot.findByRole("button", { name: /Project Alpha/ }, { timeout: 5_000 }));
  await slot.findByTestId("tyria-board-grid", {}, { timeout: 5_000 });
  return slot;
}

describe("Tyria Projects panel", () => {
  it("registers its nav panel and keeps the responsive create dialog closed by default", async () => {
    expect(app.navPanels[0]).toMatchObject({ id: "tyria-projects", title: "Tyria Projects", path: "projects" });
    const slot = await openBoard();
    expect(slot.queryByRole("dialog", { name: "Create task" })).toBeNull();
    const grid = slot.getByTestId("tyria-board-grid");
    expect(grid.className).toContain("min-w-0");
    expect(grid.className).toContain("md:grid-cols-2");
    expect(grid.className).not.toContain("overflow-x");
    fireEvent.click(slot.getByRole("button", { name: "Create task" }));
    expect(await slot.findByRole("dialog", { name: "Create task" })).toBeTruthy();
  });

  it("loads task files without comment permission and hides denied comment-file metadata", async () => {
    const taskFile = { id: "file:task", source: { type: "Task", id: task.id }, name: "task-file.png", contentType: "image/png", sizeBytes: 100, createdAt: now, previewable: true };
    const deniedCommentFile = { id: "file:comment", source: { type: "Comment", id: "comment:hidden" }, name: "comment-file.png", contentType: "image/png", sizeBytes: 100, createdAt: now, previewable: true };
    const taskOnly = { ...capabilities, viewComments: false, createComment: false };
    const slot = await openBoard(rpcHandlers(taskOnly, () => ({ ok: true, data: { items: [taskFile, deniedCommentFile], nextCursor: null } })));
    fireEvent.click(slot.getByRole("button", { name: /Inspect attachments/ }));
    expect(await slot.findByText(/task-file\.png/)).toBeTruthy();
    expect(slot.queryByText(/comment-file\.png/)).toBeNull();
    expect(slot.rpcCalls).toContainEqual({
      method: "attachments.list",
      input: { projectId: project.id, taskId: task.id, query: { limit: 100, source: "task" } },
    });
    expect(slot.rpcCalls.some((call) => call.method === "comments.list")).toBe(false);
  });

  it("requests and presents comment attachments only when comments are visible", async () => {
    const commentFile = { id: "file:comment", source: { type: "Comment", id: "comment:visible" }, name: "visible-comment-file.png", contentType: "image/png", sizeBytes: 100, createdAt: now, previewable: true };
    const slot = await openBoard(rpcHandlers(capabilities, () => ({ ok: true, data: { items: [commentFile], nextCursor: null } })));
    fireEvent.click(slot.getByRole("button", { name: /Inspect attachments/ }));
    expect(await slot.findByText(/visible-comment-file\.png/)).toBeTruthy();
    expect(slot.rpcCalls).toContainEqual({
      method: "attachments.list",
      input: { projectId: project.id, taskId: task.id, query: { limit: 100, source: "all" } },
    });
  });

  it("follows attachment cursors to the safe cap and exposes truncation", async () => {
    let page = 0;
    const slot = await openBoard(rpcHandlers(capabilities, () => {
      page += 1;
      const items = Array.from({ length: 100 }, (_, index) => ({
        id: `file:${page}:${index}`,
        source: { type: "Task", id: task.id },
        name: `page-${page}-file-${index}.png`,
        contentType: "image/png",
        sizeBytes: 100,
        createdAt: now,
        previewable: true,
      }));
      return { ok: true, data: { items, nextCursor: `cursor:${page}` } };
    }));
    fireEvent.click(slot.getByRole("button", { name: /Inspect attachments/ }));
    expect(await slot.findByText(/Showing the first 500 authorized attachments/)).toBeTruthy();
    await waitFor(() => expect(slot.rpcCalls.filter((call) => call.method === "attachments.list")).toHaveLength(5));
    expect(slot.rpcCalls.filter((call) => call.method === "attachments.list").at(-1)).toMatchObject({
      input: { query: { cursor: "cursor:4", limit: 100, source: "all" } },
    });
  });
});
