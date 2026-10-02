import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { readOrCreateSecretFile } from "../src/secret-file.ts";

if (process.argv[2] === "worker") {
  process.on("message", async (dataDir) => {
    const start = performance.now();
    try {
      const secret = await readOrCreateSecretFile({
        bytes: 32,
        dataDir,
        encoding: "base64",
        fileName: "secret",
      });
      process.send({
        ms: performance.now() - start,
        digest: createHash("sha256").update(secret).digest("hex"),
      });
    } catch (error) {
      process.send({
        ms: performance.now() - start,
        failed: true,
        code: error.code ?? error.name,
      });
    }
  });
  process.send("ready");
} else {
  const clients = Number(process.argv[2] ?? 8);
  const rounds = Number(process.argv[3] ?? 200);
  if (
    !Number.isInteger(clients) ||
    clients < 1 ||
    clients > 32 ||
    !Number.isInteger(rounds) ||
    rounds < 1
  )
    throw new Error("Usage: contention-benchmark.mjs [clients:1..32] [rounds]");
  const directory = await mkdtemp(join(tmpdir(), "bb-secret-contention-"));
  const children = Array.from({ length: clients }, () =>
    fork(fileURLToPath(import.meta.url), ["worker"], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    }),
  );
  const latencies = [];
  const cycles = [];
  let failedCalls = 0;
  let failedRounds = 0;
  let disagreements = 0;
  let temporaryFileLeaks = 0;
  try {
    await Promise.all(children.map((child) => once(child, "message")));
    for (let round = -10; round < rounds; round++) {
      const dataDir = join(directory, String(round));
      const start = performance.now();
      const results = await Promise.all(
        children.map(async (child) => {
          const response = once(child, "message");
          child.send(dataDir);
          return (await response)[0];
        }),
      );
      const elapsed = performance.now() - start;
      if (round >= 0) {
        temporaryFileLeaks += Number(
          (await readdir(dataDir)).some((name) => name !== "secret"),
        );
        cycles.push(elapsed);
        latencies.push(...results.map((r) => r.ms));
        failedCalls += results.filter((r) => r.failed).length;
        failedRounds += Number(results.some((r) => r.failed));
        disagreements += Number(
          new Set(results.filter((r) => !r.failed).map((r) => r.digest))
            .size !== 1,
        );
      }
    }
    const stats = (values) => {
      values.sort((a, b) => a - b);
      return {
        n: values.length,
        p50: values[Math.floor(values.length * 0.5)],
        p95: values[Math.floor(values.length * 0.95)],
        p99: values[Math.floor(values.length * 0.99)],
        max: values.at(-1),
      };
    };
    console.log(
      JSON.stringify(
        {
          clients,
          rounds,
          bytes: 32,
          warmupRounds: 10,
          failedCalls,
          failedRounds,
          disagreements,
          temporaryFileLeaks,
          operationMs: stats(latencies),
          roundMs: stats(cycles),
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(
      children.map(async (child) => {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }),
    );
    await rm(directory, { recursive: true, force: true });
  }
}
