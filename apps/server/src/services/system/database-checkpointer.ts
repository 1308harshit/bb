import { Worker } from "node:worker_threads";
import type { ServerLogger } from "../../types.js";

interface DatabaseCheckpointer {
  stop(): Promise<void>;
}

export function startDatabaseCheckpointer(args: {
  databasePath: string;
  logger: Pick<ServerLogger, "warn">;
}): DatabaseCheckpointer {
  const reportFailure = (error: unknown): void => {
    args.logger.warn(
      { err: error },
      "Database checkpointer failed; automatic checkpoints remain enabled",
    );
  };
  let worker: Worker;
  try {
    worker = new Worker(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "./database-checkpoint-worker.ts"
          : "./database-checkpoint-worker.js",
        import.meta.url,
      ),
      { workerData: { databasePath: args.databasePath } },
    );
  } catch (error) {
    reportFailure(error);
    return { async stop(): Promise<void> {} };
  }
  worker.unref();
  let stopping = false;
  let failed = false;
  let stopPromise: Promise<void> | null = null;
  worker.on("error", (error: Error) => {
    failed = true;
    reportFailure(error);
  });
  const exited = new Promise<void>((resolve) => {
    worker.once("exit", (code) => {
      if (!stopping && !failed) {
        args.logger.warn(
          { code },
          "Database checkpointer exited; automatic checkpoints remain enabled",
        );
      }
      resolve();
    });
  });
  return {
    stop(): Promise<void> {
      if (stopPromise !== null) return stopPromise;
      stopping = true;
      worker.postMessage("stop");
      stopPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          args.logger.warn({}, "Database checkpointer shutdown timed out");
          void worker.terminate();
          resolve();
        }, 1_000);
        void exited.then(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
      return stopPromise;
    },
  };
}
