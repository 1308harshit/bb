import { describe, expect, it } from "vitest";
import type { PromptInput, PromptHistoryScope } from "@bb/domain";
import { createConnection } from "../../src/connection.js";
import {
  createProject,
  createPromptHistoryEntry,
  createThread,
  listPromptHistoryCandidates,
  markThreadDeleted,
  upsertHost,
} from "../../src/data/index.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";

type TestDb = ReturnType<typeof createConnection>;

function text(text: string, visibility?: "agent-only"): PromptInput {
  return {
    type: "text",
    text,
    mentions: [],
    ...(visibility === undefined ? {} : { visibility }),
  };
}

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const firstProject = createProject(db, noopNotifier, {
    name: "First",
    source: { type: "local_path", hostId: host.id, path: "/tmp/first" },
  }).project;
  const secondProject = createProject(db, noopNotifier, {
    name: "Second",
    source: { type: "local_path", hostId: host.id, path: "/tmp/second" },
  }).project;
  const firstThread = createThread(db, noopNotifier, {
    projectId: firstProject.id,
    providerId: "codex",
  });
  const secondThread = createThread(db, noopNotifier, {
    projectId: firstProject.id,
    providerId: "codex",
  });
  const otherProjectThread = createThread(db, noopNotifier, {
    projectId: secondProject.id,
    providerId: "codex",
  });
  return {
    db,
    firstProject,
    firstThread,
    otherProjectThread,
    secondProject,
    secondThread,
  };
}

function insert(
  db: TestDb,
  args: {
    createdAt: number;
    input: PromptInput[];
    projectId: string;
    requestSequence: number;
    scope: PromptHistoryScope;
    threadId: string;
  },
) {
  return createPromptHistoryEntry(db, args);
}

describe("prompt history candidate queries", () => {
  it("applies thread, project, and global scopes and orders newest first", () => {
    const fixture = setup();
    const first = insert(fixture.db, {
      createdAt: 10,
      input: [text("first project starter")],
      projectId: fixture.firstProject.id,
      requestSequence: 1,
      scope: "project",
      threadId: fixture.firstThread.id,
    });
    const followUp = insert(fixture.db, {
      createdAt: 30,
      input: [text("first project follow up")],
      projectId: fixture.firstProject.id,
      requestSequence: 1,
      scope: "thread",
      threadId: fixture.secondThread.id,
    });
    const other = insert(fixture.db, {
      createdAt: 20,
      input: [text("other project")],
      projectId: fixture.secondProject.id,
      requestSequence: 1,
      scope: "project",
      threadId: fixture.otherProjectThread.id,
    });

    expect(
      listPromptHistoryCandidates(fixture.db, {
        scope: "thread",
        threadId: fixture.firstThread.id,
        limit: 20,
      }).map((row) => row.id),
    ).toEqual([first.id]);
    expect(
      listPromptHistoryCandidates(fixture.db, {
        scope: "project",
        projectId: fixture.firstProject.id,
        limit: 20,
      }).map((row) => row.id),
    ).toEqual([followUp.id, first.id]);
    expect(
      listPromptHistoryCandidates(fixture.db, {
        scope: "global",
        limit: 20,
      }).map((row) => row.id),
    ).toEqual([followUp.id, other.id, first.id]);
  });

  it("ANDs case-insensitive terms across visible text and treats LIKE characters literally", () => {
    const fixture = setup();
    const matching = insert(fixture.db, {
      createdAt: 10,
      input: [text("Deploy AUTH"), text("flow at 100%_ready")],
      projectId: fixture.firstProject.id,
      requestSequence: 1,
      scope: "project",
      threadId: fixture.firstThread.id,
    });
    insert(fixture.db, {
      createdAt: 20,
      input: [text("deploy only")],
      projectId: fixture.firstProject.id,
      requestSequence: 2,
      scope: "thread",
      threadId: fixture.firstThread.id,
    });
    insert(fixture.db, {
      createdAt: 30,
      input: [text("auth flow", "agent-only"), text("deploy visible")],
      projectId: fixture.firstProject.id,
      requestSequence: 3,
      scope: "thread",
      threadId: fixture.firstThread.id,
    });

    expect(
      listPromptHistoryCandidates(fixture.db, {
        scope: "global",
        query: "auth FLOW deploy",
        limit: 20,
      }).map((row) => row.id),
    ).toEqual([matching.id]);
    expect(
      listPromptHistoryCandidates(fixture.db, {
        scope: "global",
        query: "%_ready",
        limit: 20,
      }).map((row) => row.id),
    ).toEqual([matching.id]);
  });

  it("excludes prompt history belonging to soft-deleted threads", () => {
    const fixture = setup();
    const live = insert(fixture.db, {
      createdAt: 10,
      input: [text("live prompt")],
      projectId: fixture.firstProject.id,
      requestSequence: 1,
      scope: "project",
      threadId: fixture.firstThread.id,
    });
    insert(fixture.db, {
      createdAt: 20,
      input: [text("deleted prompt")],
      projectId: fixture.firstProject.id,
      requestSequence: 1,
      scope: "thread",
      threadId: fixture.secondThread.id,
    });
    markThreadDeleted(fixture.db, noopNotifier, {
      threadId: fixture.secondThread.id,
    });

    expect(
      listPromptHistoryCandidates(fixture.db, {
        scope: "global",
        limit: 20,
      }).map((row) => row.id),
    ).toEqual([live.id]);
  });

  it("caps candidate scans at 300 rows", () => {
    const fixture = setup();
    for (let index = 1; index <= 305; index += 1) {
      insert(fixture.db, {
        createdAt: index,
        input: [text(`prompt ${index}`)],
        projectId: fixture.firstProject.id,
        requestSequence: index,
        scope: index === 1 ? "project" : "thread",
        threadId: fixture.firstThread.id,
      });
    }

    const rows = listPromptHistoryCandidates(fixture.db, {
      scope: "global",
      limit: 1_000,
    });
    expect(rows).toHaveLength(300);
    expect(rows[0]?.createdAt).toBe(305);
    expect(rows.at(-1)?.createdAt).toBe(6);
  });
});
