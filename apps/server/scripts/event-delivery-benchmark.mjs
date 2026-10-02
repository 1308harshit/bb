import {
  createConnection,
  appendDaemonEventsInTransaction,
  migrate,
  upsertHost,
  createProject,
  createThread,
  noopNotifier,
} from "@bb/db";
import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { once } from "node:events";
import {
  statSync,
  writeFileSync,
  mkdtempSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [capText, mode, out, snapshot] = process.argv.slice(2);
const cap = Number(capText);
if (
  !Number.isInteger(cap) ||
  cap < 1 ||
  cap > 2000 ||
  !["off", "on"].includes(mode) ||
  !out
) {
  throw new Error(
    "Usage: event-delivery-benchmark.mjs <events/request:1..2000> <off|on> <output.json> [offline-snapshot.db]",
  );
}
const directory = mkdtempSync(join(tmpdir(), "bb-event-delivery-benchmark-"));
process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
const path = join(directory, "core.db");
if (snapshot) copyFileSync(snapshot, path);
const { createEventSink } = await import("../../host-daemon/src/event-sink.ts");
const db = createConnection(path);
const native = db.$client;
let thread;
let turn;
let lengths;
if (snapshot) {
  thread = native
    .prepare("SELECT id FROM threads ORDER BY updated_at DESC LIMIT 1")
    .get().id;
  turn = native
    .prepare(
      "SELECT turn_id FROM events WHERE thread_id=? AND type='turn/started' ORDER BY sequence DESC LIMIT 1",
    )
    .get(thread).turn_id;
  lengths = native
    .prepare(
      "SELECT length(CAST(data AS BLOB)) AS n FROM events WHERE thread_id=? ORDER BY sequence DESC LIMIT 1000",
    )
    .all(thread)
    .map((r) => r.n);
} else {
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "benchmark" });
  const project = createProject(db, noopNotifier, {
    name: "benchmark",
    source: { type: "local_path", hostId: host.id, path: directory },
  }).project;
  thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "benchmark",
  }).id;
  turn = "turn_benchmark";
  db.transaction(
    (tx) =>
      appendDaemonEventsInTransaction(tx, [
        {
          threadId: thread,
          type: "turn/started",
          scope: { kind: "turn", turnId: turn },
          environmentId: null,
          providerThreadId: "benchmark",
          itemId: null,
          itemKind: null,
          parentToolCallId: null,
          data: JSON.stringify({ providerThreadId: "benchmark" }),
        },
      ]),
    { behavior: "immediate" },
  );
  lengths = Array.from({ length: 1000 }, (_, i) =>
    i < 950 ? 220 : i < 990 ? 3150 : 10885,
  );
}
const read = native.prepare(
  "SELECT sequence,type,item_kind FROM events WHERE thread_id=? ORDER BY sequence DESC LIMIT 50",
);
const inputs = Array.from({ length: 2000 }, (_, i) => ({
  threadId: thread,
  type: "item/agentMessage/delta",
  scope: { kind: "turn", turnId: turn },
  environmentId: null,
  providerThreadId: null,
  itemId: "load-message",
  itemKind: "agentMessage",
  parentToolCallId: null,
  data: JSON.stringify({
    itemId: "load-message",
    delta: "x".repeat(Math.max(1, lengths[i % lengths.length] - 50)),
  }),
}));

const sql = [];
const transactions = [];
let recording = false;
const originalExec = native.exec.bind(native);
native.exec = (source) => {
  const start = performance.now();
  try {
    return originalExec(source);
  } finally {
    if (recording)
      sql.push({
        kind: source.toUpperCase().startsWith("COMMIT")
          ? "commit"
          : source.toUpperCase().startsWith("BEGIN")
            ? "begin"
            : "exec",
        ms: performance.now() - start,
      });
  }
};
const prepare = native.prepare.bind(native);
native.prepare = (source) => {
  const st = prepare(source);
  for (const method of ["get", "all"]) {
    const original = st[method].bind(st);
    st[method] = (...args) => {
      const start = performance.now();
      try {
        return original(...args);
      } finally {
        if (recording)
          sql.push({
            kind: source.startsWith("INSERT")
              ? "insert"
              : source.startsWith("COMMIT")
                ? "commit"
                : source.startsWith("BEGIN")
                  ? "begin"
                  : "read",
            ms: performance.now() - start,
          });
      }
    };
  }
  return st;
};
const statementPrototype = Object.getPrototypeOf(native.prepare("SELECT 1"));
const originalRun = statementPrototype.run;
statementPrototype.run = function (...args) {
  const start = performance.now();
  try {
    return originalRun.apply(this, args);
  } finally {
    if (recording)
      sql.push({
        kind: this.source.startsWith("INSERT")
          ? "insert"
          : this.source.startsWith("COMMIT")
            ? "commit"
            : this.source.startsWith("BEGIN")
              ? "begin"
              : "run",
        ms: performance.now() - start,
      });
  }
};
const server = createServer(async (req, res) => {
  if (req.url === "/ping") {
    res.end("ok");
    return;
  }
  if (req.url === "/read") {
    read.all(thread);
    res.end("ok");
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const entries = JSON.parse(Buffer.concat(chunks).toString());
  const start = performance.now();
  db.transaction((tx) => appendDaemonEventsInTransaction(tx, entries), {
    behavior: "immediate",
  });
  if (recording) transactions.push(performance.now() - start);
  res.end("ok");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
for (let i = 0; i < 3; i++)
  await fetch(`http://127.0.0.1:${port}/append`, {
    method: "POST",
    body: JSON.stringify(inputs.slice(0, 10)),
  }).then((r) => r.text());
native.pragma("wal_checkpoint(TRUNCATE)");
const worker = new Worker(
  new URL("./event-delivery-probe.mjs", import.meta.url),
  { workerData: { port } },
);
await once(worker, "message");
const checkpointInterval = mode === "on" ? 20 : 0;
let checkpointErrors = 0;
const checkpointWorker = checkpointInterval
  ? (
      await import("../src/services/system/database-checkpointer.ts")
    ).startDatabaseCheckpointer({
      databasePath: path,
      logger: {
        warn() {
          checkpointErrors++;
        },
      },
    })
  : null;
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
await new Promise((r) => setTimeout(r, 50));
recording = true;
const sink = createEventSink({
  isSessionOpen: () => true,
  logger: {
    debug() {},
    warn() {},
    error() {
      throw new Error("sink error");
    },
  },
  postEvents: async (envelopes) => {
    const batch = envelopes.map(({ event }) => ({
      ...inputs[0],
      data: JSON.stringify({ itemId: event.itemId, delta: event.delta }),
    }));
    await fetch(`http://127.0.0.1:${port}/append`, {
      method: "POST",
      body: JSON.stringify(batch),
    }).then((r) => {
      if (!r.ok) throw new Error("HTTP failure");
      return r.text();
    });
    return { acceptedEvents: [], rejectedEvents: [] };
  },
});
let maxWal = 0;
const start = performance.now();
for (let burst = 0; burst < 6; burst++) {
  for (let offset = 0; offset < inputs.length; offset += cap) {
    for (const input of inputs.slice(offset, offset + cap)) {
      const data = JSON.parse(input.data);
      sink.emit({
        threadId: thread,
        event: {
          type: "item/agentMessage/delta",
          threadId: thread,
          scope: input.scope,
          itemId: data.itemId,
          delta: data.delta,
        },
      });
    }
    await sink.flush();
  }
  maxWal = Math.max(maxWal, statSync(path + "-wal").size);
  await new Promise((r) => setTimeout(r, 20));
}
await sink.dispose();
const duration = performance.now() - start;
recording = false;
await new Promise((r) => setTimeout(r, 50));
worker.postMessage("stop");
const [samples] = await once(worker, "message");
await worker.terminate();
delay.disable();
function stats(values) {
  values.sort((a, b) => a - b);
  return {
    n: values.length,
    p50: values[Math.floor(values.length * 0.5)],
    p95: values[Math.floor(values.length * 0.95)],
    p99: values[Math.floor(values.length * 0.99)],
    max: values.at(-1),
  };
}
const stopStarted = performance.now();
await checkpointWorker?.stop();
const stopMs = performance.now() - stopStarted;
const result = {
  provenance: snapshot
    ? "offline snapshot with synthetic payloads"
    : "fresh synthetic database",
  sqliteVersion: native.prepare("SELECT sqlite_version() AS version").get()
    .version,
  nodeVersion: process.version,
  checkpointInterval,
  checkpointErrors,
  stopMs,
  cap,
  events: 12000,
  payloadTotalBytes: inputs.reduce((s, r) => s + r.data.length, 0) * 6,
  elapsedMs: duration,
  maxWalBytes: maxWal,
  transaction: stats(transactions),
  sql: Object.fromEntries(
    ["insert", "commit", "begin", "read"].map((kind) => [
      kind,
      stats(sql.filter((s) => s.kind === kind).map((s) => s.ms)),
    ]),
  ),
  probes: Object.fromEntries(
    ["/ping", "/read"].map((path) => [
      path,
      stats(
        samples.filter((s) => s.path === path && !s.error).map((s) => s.ms),
      ),
    ]),
  ),
  probeErrors: samples.filter((s) => s.error).length,
  eventLoop: {
    p95: delay.percentile(95) / 1e6,
    p99: delay.percentile(99) / 1e6,
    max: delay.max / 1e6,
  },
  settings: {
    synchronous: native.pragma("synchronous"),
    autocheckpoint: native.pragma("wal_autocheckpoint"),
  },
};
writeFileSync(out, JSON.stringify(result, null, 2));
await new Promise((resolve) => server.close(resolve));
native.close();
rmSync(directory, { recursive: true, force: true });
