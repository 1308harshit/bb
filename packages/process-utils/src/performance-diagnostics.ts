import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import { join } from "node:path";
import {
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
} from "node:perf_hooks";

const PROFILE_INTERVAL_MS = 30_000;
const PROFILE_SLOTS = 10;
const MAX_PROFILE_BYTES = 12 * 1024 * 1024;

export async function startPerformanceDiagnostics(options: {
  dataDir: string;
  logger: {
    info(fields: object, message: string): void;
    warn(fields: object, message: string): void;
  };
}): Promise<{ stop: () => Promise<void> }> {
  const directory = join(options.dataDir, "logs", "performance");
  const session = new Session();
  let profiling = false;
  let stopped = false;
  let slot = 0;
  let profileStartedAt = new Date().toISOString();
  let rotation: Promise<void> = Promise.resolve();
  const pendingPath = join(directory, "profile.pending");
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  let gcDurationMs = 0;
  let gcCount = 0;
  let gcMaxDurationMs = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gcDurationMs += entry.duration;
      gcCount += 1;
      gcMaxDurationMs = Math.max(gcMaxDurationMs, entry.duration);
    }
  });
  observer.observe({ entryTypes: ["gc"] });
  histogram.enable();
  let previousCpu = process.cpuUsage();
  let previousThreadCpu = process.threadCpuUsage();
  let previousTime = performance.now();
  let previousUtilization = performance.eventLoopUtilization();
  const summaryTimer = setInterval(() => {
    const now = performance.now();
    const cpu = process.cpuUsage();
    const threadCpu = process.threadCpuUsage();
    const utilization = performance.eventLoopUtilization();
    options.logger.info(
      {
        pid: process.pid,
        intervalMs: now - previousTime,
        processCpuMs:
          (cpu.user + cpu.system - previousCpu.user - previousCpu.system) /
          1_000,
        mainThreadCpuMs:
          (threadCpu.user +
            threadCpu.system -
            previousThreadCpu.user -
            previousThreadCpu.system) /
          1_000,
        eventLoopUtilization: performance.eventLoopUtilization(
          utilization,
          previousUtilization,
        ).utilization,
        maxDelayMs: histogram.max / 1e6,
        p99DelayMs: histogram.percentile(99) / 1e6,
        gcDurationMs,
        gcCount,
        gcMaxDurationMs,
        memory: process.memoryUsage(),
      },
      "Server performance sample",
    );
    previousCpu = cpu;
    previousThreadCpu = threadCpu;
    previousTime = now;
    previousUtilization = utilization;
    gcDurationMs = 0;
    gcCount = 0;
    gcMaxDurationMs = 0;
    histogram.reset();
  }, 5_000);
  summaryTimer.unref();

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 1_000 });
    await session.post("Profiler.start");
    profiling = true;
    options.logger.info(
      {
        directory,
        profileIntervalMs: PROFILE_INTERVAL_MS,
        profileSlots: PROFILE_SLOTS,
        maxProfileBytes: MAX_PROFILE_BYTES,
        pid: process.pid,
      },
      "Server performance diagnostics enabled",
    );
  } catch (error) {
    session.disconnect();
    options.logger.warn(
      { err: error },
      "CPU profiling unavailable; performance summaries remain enabled",
    );
  }

  const capture = async (restart: boolean): Promise<void> => {
    if (!profiling) return;
    try {
      const { profile } = await session.post("Profiler.stop");
      profiling = false;
      const startedAt = profileStartedAt;
      const endedAt = new Date().toISOString();
      if (restart && !stopped) {
        await session.post("Profiler.start");
        profileStartedAt = new Date().toISOString();
        profiling = true;
      }
      const contents = JSON.stringify(profile);
      const bytes = Buffer.byteLength(contents);
      if (bytes > MAX_PROFILE_BYTES) {
        options.logger.warn(
          { bytes, startedAt, endedAt },
          "CPU profile exceeded size limit; discarded",
        );
        return;
      }
      const path = join(
        directory,
        `profile-${String(slot).padStart(2, "0")}.cpuprofile`,
      );
      await writeFile(pendingPath, contents, { mode: 0o600 });
      await rename(pendingPath, path);
      slot = (slot + 1) % PROFILE_SLOTS;
      options.logger.info(
        {
          path,
          bytes,
          startedAt,
          endedAt,
          pid: process.pid,
          sampleTimeBasis: "elapsed",
          nativeFramesMayIncludeWaiting: true,
        },
        "Server CPU profile saved",
      );
    } catch (error) {
      profiling = false;
      session.disconnect();
      await rm(pendingPath, { force: true }).catch(() => {});
      options.logger.warn(
        { err: error },
        "CPU profiling stopped after capture failure; performance summaries remain enabled",
      );
    }
  };
  const profileTimer = setInterval(() => {
    rotation = rotation.then(() => capture(true));
  }, PROFILE_INTERVAL_MS);
  profileTimer.unref();
  let stopPromise: Promise<void> | undefined;
  return {
    stop: () => {
      stopPromise ??= (async () => {
        stopped = true;
        clearInterval(profileTimer);
        clearInterval(summaryTimer);
        histogram.disable();
        observer.disconnect();
        await rotation;
        await capture(false);
        session.disconnect();
      })();
      return stopPromise;
    },
  };
}
