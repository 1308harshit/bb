import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { startPerformanceDiagnostics } from "../src/performance-diagnostics.js";

describe("performance diagnostics", () => {
  it("saves an actual CPU profile on shutdown and stops idempotently", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-test-"));
    const warnings: unknown[] = [];
    const monitor = await startPerformanceDiagnostics({
      dataDir,
      logger: {
        info: () => {},
        warn: (fields: unknown) => {
          warnings.push(fields);
        },
      },
    });
    try {
      const until = performance.now() + 40;
      while (performance.now() < until) Math.sqrt(performance.now());
      await Promise.all([monitor.stop(), monitor.stop()]);
      const directory = join(dataDir, "logs", "performance");
      const files = await readdir(directory);
      expect(files).toEqual(["profile-00.cpuprofile"]);
      const path = join(directory, files[0]!);
      const profile = JSON.parse(await readFile(path, "utf8"));
      expect(profile.nodes.length).toBeGreaterThan(0);
      expect(profile.samples.length).toBeGreaterThan(0);
      expect(profile.endTime).toBeGreaterThan(profile.startTime);
      if (process.platform !== "win32")
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(warnings).toEqual([]);
    } finally {
      await monitor.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps startup and shutdown usable when the profile directory cannot be created", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-unwritable-"));
    const warnings: unknown[] = [];
    try {
      await writeFile(join(dataDir, "logs"), "not a directory");
      const monitor = await startPerformanceDiagnostics({
        dataDir,
        logger: {
          info: () => {},
          warn: (fields: unknown) => {
            warnings.push(fields);
          },
        },
      });
      await monitor.stop();
      expect(warnings).toHaveLength(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
