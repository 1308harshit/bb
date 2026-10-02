import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";
import { z } from "zod";

const { databasePath } = z
  .object({ databasePath: z.string().min(1) })
  .strict()
  .parse(workerData);
const port = parentPort;
if (port === null) throw new Error("Database checkpointer requires a worker");
const db = new Database(databasePath, { fileMustExist: true });
db.pragma("busy_timeout = 0");
db.pragma("synchronous = NORMAL");

const dataVersion = db.prepare<[], { data_version: number }>(
  "PRAGMA data_version",
);
const checkpointStatus = db.prepare<
  [],
  { busy: number; log: number; checkpointed: number }
>("PRAGMA wal_checkpoint(NOOP)");
let previousVersion = dataVersion.get()!.data_version;
let delayMs = 20;
let timer: ReturnType<typeof setTimeout>;
function checkpoint(): void {
  const version = dataVersion.get()!.data_version;
  const status = checkpointStatus.get()!;
  if (status.busy === 0 && status.log - status.checkpointed >= 512) {
    db.pragma("wal_checkpoint(PASSIVE)");
  }
  delayMs = version === previousVersion ? Math.min(delayMs * 2, 200) : 20;
  previousVersion = version;
  timer = setTimeout(checkpoint, delayMs);
}

timer = setTimeout(checkpoint, 20);
port.on("message", (message: unknown) => {
  if (message !== "stop") throw new Error("Invalid checkpointer message");
  clearTimeout(timer);
  db.close();
  port.close();
});
