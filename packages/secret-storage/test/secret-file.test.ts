import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOrCreateSecretFile } from "../src/index.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-secret-file-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
});

describe("secret file", () => {
  it("reuses the same secret across repeated reads", async () => {
    const dataDir = await makeTempDir();

    const first = await readOrCreateSecretFile({
      bytes: 32,
      dataDir,
      encoding: "base64",
      fileName: "secret",
    });
    const second = await readOrCreateSecretFile({
      bytes: 32,
      dataDir,
      encoding: "base64",
      fileName: "secret",
    });

    expect(second).toBe(first);
    expect(await readdir(dataDir)).toEqual(["secret"]);
    expect((await stat(path.join(dataDir, "secret"))).mode & 0o777).toBe(0o600);
  });

  it("returns one complete secret to competing processes", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import",
      "tsx",
      fileURLToPath(
        new URL("../scripts/contention-benchmark.mjs", import.meta.url),
      ),
      "8",
      "200",
    ]);
    const results = JSON.parse(stdout);
    expect(results.failedCalls).toBe(0);
    expect(results.disagreements).toBe(0);
    expect(results.temporaryFileLeaks).toBe(0);
    expect(results.operationMs.n).toBe(1600);
  }, 30_000);

  it("throws when an existing secret file is empty", async () => {
    const dataDir = await makeTempDir();
    await writeFile(path.join(dataDir, "secret"), "\n", "utf8");

    await expect(
      readOrCreateSecretFile({
        bytes: 32,
        dataDir,
        encoding: "base64",
        fileName: "secret",
      }),
    ).rejects.toThrow("Failed to initialize secret");
    expect(await readdir(dataDir)).toEqual(["secret"]);
  });

  it("preserves filesystem errors without leaving temporary secrets", async () => {
    const dataDir = await makeTempDir();
    await mkdir(path.join(dataDir, "secret"));
    await expect(
      readOrCreateSecretFile({
        bytes: 32,
        dataDir,
        encoding: "base64",
        fileName: "secret",
      }),
    ).rejects.toMatchObject({ code: "EISDIR" });
    expect(await readdir(dataDir)).toEqual(["secret"]);
  });
});
