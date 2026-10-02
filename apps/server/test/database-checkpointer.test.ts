import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createConnection, migrate } from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDatabaseCheckpointer } from "../src/services/system/database-checkpointer.js";

const cleanups: (() => Promise<void>)[] = [];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "bb-checkpointer-"));
  const path = join(dir, "core.db");
  const db = createConnection(path);
  migrate(db);
  db.$client.exec(
    "CREATE TABLE checkpoint_probe (id INTEGER PRIMARY KEY, data TEXT NOT NULL)",
  );
  db.$client.pragma("wal_checkpoint(TRUNCATE)");
  const logger = { warn: vi.fn() };
  const checkpointer = startDatabaseCheckpointer({
    databasePath: path,
    logger,
  });
  const result = { dir, path, db, logger, checkpointer };
  cleanups.push(async () => {
    await checkpointer.stop();
    db.$client.close();
    await rm(dir, { recursive: true, force: true });
  });
  return result;
}

async function checkpointedCount(
  args: Awaited<ReturnType<typeof fixture>>,
): Promise<number> {
  const copy = join(args.dir, "main-file-only.db");
  await copyFile(args.path, copy);
  const db = new Database(copy, { readonly: true });
  try {
    return db
      .prepare<[], { count: number }>(
        "SELECT count(*) AS count FROM checkpoint_probe",
      )
      .get()!.count;
  } finally {
    db.close();
  }
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("database checkpointer", () => {
  it("checkpoints committed rows while preserving automatic checkpoints and durability settings", async () => {
    const args = await fixture();
    const initialInsert = args.db.$client.prepare(
      "INSERT INTO checkpoint_probe VALUES (?, ?)",
    );
    args.db.$client.transaction(() => {
      for (let id = 1; id <= 600; id += 1)
        initialInsert.run(id, "x".repeat(4096));
    })();
    await expect
      .poll(() => checkpointedCount(args), { timeout: 5000 })
      .toBe(600);
    expect(args.db.$client.pragma("wal_autocheckpoint", { simple: true })).toBe(
      1000,
    );
    expect(args.db.$client.pragma("synchronous", { simple: true })).toBe(1);
    await args.checkpointer.stop();
    await args.checkpointer.stop();
    expect(args.logger.warn).not.toHaveBeenCalled();
    const insert = args.db.$client.prepare(
      "INSERT INTO checkpoint_probe VALUES (?, ?)",
    );
    for (let id = 601; id <= 1100; id += 1) insert.run(id, "x".repeat(16_384));
    expect(await checkpointedCount(args)).toBeGreaterThan(600);
    expect(
      args.db.$client
        .prepare("SELECT count(*) AS count FROM checkpoint_probe")
        .get(),
    ).toEqual({ count: 1100 });
  });

  it("leaves small idle WALs to the existing checkpoint policy", async () => {
    const args = await fixture();
    args.db.$client
      .prepare("INSERT INTO checkpoint_probe VALUES (?, ?)")
      .run(1, "small write");
    await new Promise((resolve) => setTimeout(resolve, 350));
    await args.checkpointer.stop();
    expect(await checkpointedCount(args)).toBe(0);
    expect(args.logger.warn).not.toHaveBeenCalled();
  });

  it("allows writes with a pinned reader and resumes checkpointing when the reader releases", async () => {
    const args = await fixture();
    const reader = new Database(args.path, { readonly: true });
    try {
      reader.exec("BEGIN");
      reader.prepare("SELECT count(*) FROM checkpoint_probe").get();
      const insert = args.db.$client.prepare(
        "INSERT INTO checkpoint_probe VALUES (?, ?)",
      );
      for (let batch = 0; batch < 3; batch += 1) {
        args.db.$client.transaction(() => {
          for (let offset = 0; offset < 600; offset += 1)
            insert.run(batch * 600 + offset, "x".repeat(4096));
        })();
      }
      expect(statSync(`${args.path}-wal`).size).toBeGreaterThan(1000 * 4096);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await checkpointedCount(args)).toBe(0);
      reader.exec("ROLLBACK");
      await expect
        .poll(() => checkpointedCount(args), { timeout: 5000 })
        .toBe(1800);
      await args.checkpointer.stop();
      expect(args.logger.warn).not.toHaveBeenCalled();
    } finally {
      reader.close();
    }
  });

  it("tolerates another checkpointer and continues after that connection stops", async () => {
    const args = await fixture();
    const other = startDatabaseCheckpointer({
      databasePath: args.path,
      logger: args.logger,
    });
    try {
      const insert = args.db.$client.prepare(
        "INSERT INTO checkpoint_probe VALUES (?, ?)",
      );
      args.db.$client.transaction(() => {
        for (let id = 0; id < 600; id += 1) insert.run(id, "x".repeat(4096));
      })();
      await expect
        .poll(() => checkpointedCount(args), { timeout: 5000 })
        .toBe(600);
      await other.stop();
      args.db.$client.transaction(() => {
        for (let id = 600; id < 1200; id += 1) insert.run(id, "x".repeat(4096));
      })();
      await expect
        .poll(() => checkpointedCount(args), { timeout: 5000 })
        .toBe(1200);
      expect(args.logger.warn).not.toHaveBeenCalled();
    } finally {
      await other.stop();
    }
  });

  it("reports startup failure without creating a database or breaking shutdown", async () => {
    const args = await fixture();
    const missing = join(args.dir, "missing.db");
    const logger = { warn: vi.fn() };
    const checkpointer = startDatabaseCheckpointer({
      databasePath: missing,
      logger,
    });
    try {
      await expect
        .poll(() => logger.warn.mock.calls.length, { timeout: 5000 })
        .toBe(1);
      expect(existsSync(missing)).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        { err: expect.objectContaining({ code: "SQLITE_CANTOPEN" }) },
        "Database checkpointer failed; automatic checkpoints remain enabled",
      );
    } finally {
      await checkpointer.stop();
    }
  });
});
