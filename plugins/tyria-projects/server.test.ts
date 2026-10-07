import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import plugin, { buildApprovedAttachmentResult, buildAttachmentConfirmation, PreviewTicketVault } from "./server.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>["harness"]> = [];

afterEach(async () => {
  await Promise.all(hosts.map((host) => host.dispose()));
  hosts.length = 0;
});

async function setup() {
  const host = createFakePluginHost({
    pluginId: "tyria-projects",
    agentSkillIds: ["tyria-projects"],
  });
  hosts.push(host.harness);
  await plugin(host.bb);
  return host;
}

describe("Tyria Projects server registration", () => {
  it("registers the strict RPC, fixed preview route, CLI, tools, and secret setting", async () => {
    const { harness } = await setup();

    expect(harness.registrations.rpcMethods).toEqual([
      "connection.get",
      "connection.start",
      "connection.poll",
      "connection.disconnect",
      "projects.list",
      "projects.board",
      "tasks.list",
      "tasks.get",
      "tasks.create",
      "tasks.patch",
      "tasks.move",
      "tasks.assign",
      "comments.list",
      "comments.create",
      "attachments.list",
      "attachments.previewTicket",
    ]);
    expect(harness.registrations.httpRoutes).toMatchObject([
      { method: "POST", path: "/attachment-preview", auth: "local" },
    ]);
    expect(harness.registrations.settingsDescriptors.tyriaRefreshToken).toMatchObject({
      type: "string",
      secret: true,
    });
    expect(harness.registrations.cli?.name).toBe("tyria");
    expect(harness.registrations.agentTools.map((tool) => tool.name)).toEqual([
      "tyria_projects_list",
      "tyria_project_board",
      "tyria_task_get",
      "tyria_tasks_list",
      "tyria_comments_list",
      "tyria_attachments_list",
      "tyria_task_create",
      "tyria_task_update",
      "tyria_task_move",
      "tyria_task_assign",
      "tyria_comment_add",
      "tyria_attachment_analyze",
    ]);
  });

  it("does not expose tools or the skill before a Tyria grant is connected", async () => {
    const { harness } = await setup();
    const configured = harness.registrations.agentConfigurationProvider?.(
      makePluginAgentConfigurationContext(),
    );
    expect(configured).toEqual({ tools: [], skills: [] });
  });

  it("requires explicit CLI confirmation before every mutation, download, and disconnect", async () => {
    const { harness } = await setup();
    const cases = [
      { args: ["disconnect", "--json"], target: "disconnect the current local Tyria grant" },
      { args: ["tasks", "create", "--project", "project_1", "--phase", "phase_1", "--title", "Safe title", "--json"], target: "create task" },
      { args: ["tasks", "edit", "--project", "project_1", "--task", "task_1", "--version", "1", "--title", "Revised", "--json"], target: "edit task" },
      { args: ["tasks", "move", "--project", "project_1", "--task", "task_1", "--version", "1", "--phase", "phase_2", "--json"], target: "move task" },
      { args: ["tasks", "assign", "--project", "project_1", "--task", "task_1", "--version", "1", "--json"], target: "replace task assignees" },
      { args: ["comments", "add", "--project", "project_1", "--task", "task_1", "--text", "Hello", "--json"], target: "add task comment" },
      { args: ["attachments", "download", "--project", "project_1", "--task", "task_1", "--file", "file_1", "--output", "screen.png", "--json"], target: "download attachment" },
    ];

    for (const entry of cases) {
      const result = await harness.runCli(entry.args);
      expect(result.exitCode, entry.args.join(" ")).toBe(2);
      const payload = JSON.parse(result.stdout) as { error: { code: string; message: string } };
      expect(payload.error.code).toBe("confirmation_required");
      expect(payload.error.message).toContain(entry.target);
      expect(payload.error.message).toContain("rerun the command with --yes");
      expect(payload.error.message).toContain("cannot prompt on CLI stdin");
      expect(payload.error.message.length).toBeLessThanOrEqual(800);
    }
  });

  it("names Meta Muse and conversation history in attachment confirmation", () => {
    const confirmation = buildAttachmentConfirmation({
      projectName: "TyriaCore",
      taskTitle: "Inspect screenshot",
      attachment: {
        id: "file_1",
        source: { type: "Task", id: "task_1" },
        name: "screen.png",
        contentType: "image/png",
        sizeBytes: 42,
        createdAt: "2026-10-06T10:00:00.000Z",
        previewable: true,
      },
      accountName: "Harshit",
      workspaceName: "Tyria",
    });

    expect(confirmation.title).toContain("Meta Muse");
    expect(confirmation.details).toContain("Destination: Meta Muse");
    expect(confirmation.warning).toContain("may become part of the Muse conversation history");
  });

  it("returns only generic text beside approved attachment pixels", () => {
    const result = buildApprovedAttachmentResult({ data: "pixel-data", mimeType: "image/png" });

    expect(result).toEqual({
      content: [
        { type: "text", text: "Approved Tyria attachment image" },
        { type: "image", data: "pixel-data", mimeType: "image/png" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("screen.png");
  });

  it("rejects unknown and replayed preview tickets without contacting Tyria", async () => {
    const { harness } = await setup();
    const clientNonce = crypto.randomUUID();
    const request = () =>
      harness.fetchHttp("POST", "/attachment-preview", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: "x".repeat(43), clientNonce }),
      });
    const first = await request();
    const second = await request();
    expect(first.status).toBe(410);
    expect(second.status).toBe(410);
  });

  it("consumes a preview ticket when another browser instance presents it", () => {
    const vault = new PreviewTicketVault<{ expiresAtMs: number; fileId: string }>();
    const firstClient = crypto.randomUUID();
    const secondClient = crypto.randomUUID();
    vault.issue("ticket", firstClient, { expiresAtMs: 2_000, fileId: "file_1" });

    expect(vault.consume("ticket", secondClient, 1_000)).toBeNull();
    expect(vault.consume("ticket", firstClient, 1_000)).toBeNull();
  });

  it("returns a matching preview ticket once", () => {
    const vault = new PreviewTicketVault<{ expiresAtMs: number; fileId: string }>();
    const clientNonce = crypto.randomUUID();
    vault.issue("ticket", clientNonce, { expiresAtMs: 2_000, fileId: "file_1" });

    expect(vault.consume("ticket", clientNonce, 1_000)).toEqual({ expiresAtMs: 2_000, fileId: "file_1" });
    expect(vault.consume("ticket", clientNonce, 1_000)).toBeNull();
  });
});
