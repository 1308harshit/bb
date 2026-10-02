import { threadScope, turnScope } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { createEventSink, type CreateEventSinkOptions } from "./event-sink.js";
import { ServerResponseError } from "./server-client.js";

function permanentRejection(bodyMessage: string): ServerResponseError {
  return new ServerResponseError({
    action: "post events",
    bodyMessage,
    code: "invalid_request",
    retryable: false,
    status: 409,
    statusText: "Conflict",
  });
}

function createLogger(): CreateEventSinkOptions["logger"] {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
}

function acceptingPostEvents() {
  return vi.fn<CreateEventSinkOptions["postEvents"]>(async (events) => ({
    acceptedEvents: events.map((event, eventIndex) => ({
      eventIndex,
      sequence: eventIndex + 1,
      threadId: event.threadId,
    })),
    rejectedEvents: [],
  }));
}

function systemErrorEvent(threadId: string) {
  return {
    type: "system/error",
    threadId,
    scope: threadScope(),
    message: "boom",
  } as const;
}

describe("event sink", () => {
  it("bounds backlog requests and retries only the unacknowledged suffix in order", async () => {
    const delivered: string[] = [];
    let calls = 0;
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async (events) => {
        calls += 1;
        if (calls === 2) throw new Error("temporary outage");
        delivered.push(...events.map((entry) => entry.threadId));
        return { acceptedEvents: [], rejectedEvents: [] };
      },
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });
    const ids = Array.from({ length: 200 }, (_, index) => `thr_${index}`);
    for (const threadId of ids)
      sink.emit({ threadId, event: systemErrorEvent(threadId) });
    await sink.flush();
    expect(delivered).toEqual(ids.slice(0, 64));
    expect(sink.listUndeliveredThreadIds()).toEqual(ids.slice(64));
    await sink.flush();
    expect(delivered).toEqual(ids);
    expect(postEvents.mock.calls.every(([events]) => events.length <= 64)).toBe(
      true,
    );
    expect(sink.listUndeliveredThreadIds()).toEqual([]);
    await sink.dispose();
  });

  it.each(["session", "dispose"] as const)(
    "stops backlog delivery between batches on %s closure",
    async (closure) => {
      let sessionOpen = true;
      let release: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
        async (events) => {
          await pending;
          return { acceptedEvents: [], rejectedEvents: [] };
        },
      );
      const sink = createEventSink({
        isSessionOpen: () => sessionOpen,
        logger: createLogger(),
        postEvents,
      });
      for (let i = 0; i < 130; i += 1)
        sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
      const flush = sink.flush();
      sessionOpen = false;
      const disposal = closure === "dispose" ? sink.dispose() : null;
      release?.();
      await flush;
      await disposal;
      expect(postEvents.mock.calls[0]?.[0]).toHaveLength(64);
      expect(postEvents).toHaveBeenCalledTimes(1);
      expect(sink.listUndeliveredThreadIds()).toEqual(
        closure === "dispose" ? [] : ["thr_1"],
      );
      await sink.dispose();
    },
  );

  it("bounds serialized bytes without losing oversized or newly arriving events", async () => {
    const messages = [
      "🌍".repeat(180_000),
      "🌍".repeat(180_000),
      "🌍".repeat(300_000),
      "small",
    ];
    const delivered: string[] = [];
    const batches: { count: number; bytes: number }[] = [];
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents: async (events) => {
        batches.push({
          count: events.length,
          bytes: Buffer.byteLength(JSON.stringify(events)),
        });
        for (const { event } of events) {
          if (event.type !== "system/error")
            throw new Error("Unexpected event");
          delivered.push(event.message);
        }
        if (batches.length === 1)
          sink.emit({
            threadId: "thr_1",
            event: {
              ...systemErrorEvent("thr_1"),
              message: "arrived during drain",
            },
          });
        return { acceptedEvents: [], rejectedEvents: [] };
      },
    });
    for (const message of messages)
      sink.emit({
        threadId: "thr_1",
        event: { ...systemErrorEvent("thr_1"), message },
      });
    await sink.flush();
    expect(delivered).toEqual([...messages, "arrived during drain"]);
    expect(
      batches.every((batch) => batch.bytes <= 1024 * 1024 || batch.count === 1),
    ).toBe(true);
    expect(batches.length).toBeGreaterThan(1);
    expect(sink.listUndeliveredThreadIds()).toEqual([]);
    await sink.dispose();
  });

  it("drains successfully skipped diffs without requiring allocated sequences", async () => {
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async () => ({
        acceptedEvents: [],
        rejectedEvents: [],
      }),
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });
    sink.emit({
      threadId: "thr_1",
      event: {
        type: "turn/diff/updated",
        threadId: "thr_1",
        providerThreadId: "provider-1",
        scope: turnScope("turn-1"),
        diff: "discarded snapshot",
      },
    });
    await sink.flush();
    await sink.flush();
    expect(postEvents).toHaveBeenCalledTimes(1);
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await sink.flush();
    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
  });

  it("holds events while the session is closed, reports their threads, and delivers them once it reopens", async () => {
    let sessionOpen = false;
    const postEvents = acceptingPostEvents();
    const sink = createEventSink({
      isSessionOpen: () => sessionOpen,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    sink.emit({ threadId: "thr_2", event: systemErrorEvent("thr_2") });
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await sink.flush();
    expect(postEvents).not.toHaveBeenCalled();
    expect(sink.listUndeliveredThreadIds()).toEqual(["thr_1", "thr_2"]);

    sessionOpen = true;
    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(1);
    expect(postEvents).toHaveBeenCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
      { threadId: "thr_2", event: systemErrorEvent("thr_2") },
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
    expect(sink.listUndeliveredThreadIds()).toEqual([]);
  });

  it("keeps events queued after a post failure and redelivers them on the next flush", async () => {
    const postEvents = vi
      .fn<CreateEventSinkOptions["postEvents"]>()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockImplementation(async (events) => ({
        acceptedEvents: events.map((event, eventIndex) => ({
          eventIndex,
          sequence: eventIndex + 1,
          threadId: event.threadId,
        })),
        rejectedEvents: [],
      }));
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await expect(sink.flush()).resolves.toBeUndefined();

    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
  });

  it("drops rejected events with a warning without throwing", async () => {
    const logger = createLogger();
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async () => ({
        acceptedEvents: [],
        rejectedEvents: [
          {
            eventIndex: 0,
            reason: "thread_not_owned_by_host",
            threadId: "thr_1",
          },
        ],
      }),
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger,
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await expect(sink.flush()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);

    await sink.flush();
    expect(postEvents).toHaveBeenCalledTimes(1);
  });

  it("warns once when a large queue remains undelivered", () => {
    const logger = createLogger();
    let now = 0;
    const sink = createEventSink({
      isSessionOpen: () => false,
      logger,
      now: () => now,
      postEvents: acceptingPostEvents(),
    });

    for (let index = 0; index < 511; index += 1) {
      sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    }
    expect(logger.warn).not.toHaveBeenCalled();

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    expect(logger.warn).not.toHaveBeenCalled();

    now = 5_000;
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueAgeMs: 5_000, queueDepth: 513 }),
      expect.any(String),
    );
  });

  it("warns when even a small queue is stalled for thirty seconds", () => {
    const logger = createLogger();
    let now = 0;
    const sink = createEventSink({
      isSessionOpen: () => false,
      logger,
      now: () => now,
      postEvents: acceptingPostEvents(),
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    now = 30_000;
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueAgeMs: 30_000, queueDepth: 2 }),
      expect.any(String),
    );
  });

  it("drops a permanently rejected event instead of retrying it forever", async () => {
    const logger = createLogger();
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async (events) => {
        if (events.some((event) => event.threadId === "thr_poison")) {
          throw permanentRejection(
            "Cannot append provider/unhandled for turn auto-compact-1 before turn/started is stored",
          );
        }
        return {
          acceptedEvents: events.map((event, eventIndex) => ({
            eventIndex,
            sequence: eventIndex + 1,
            threadId: event.threadId,
          })),
          rejectedEvents: [],
        };
      },
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger,
      postEvents,
    });

    sink.emit({
      threadId: "thr_poison",
      event: systemErrorEvent("thr_poison"),
    });
    await sink.flush();

    postEvents.mockClear();
    await sink.flush();
    expect(postEvents).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("retains only the undelivered suffix after a permanent rejection and partial retryable failure", async () => {
    const delivered: string[] = [];
    let failOnce = true;
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async (events) => {
        if (events.some((event) => event.threadId === "thr_80"))
          throw permanentRejection("Poison event");
        if (failOnce && events.some((event) => event.threadId === "thr_90")) {
          failOnce = false;
          throw new Error("Temporary outage after partial delivery");
        }
        delivered.push(...events.map((event) => event.threadId));
        return { acceptedEvents: [], rejectedEvents: [] };
      },
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });
    const ids = Array.from({ length: 140 }, (_, index) => `thr_${index}`);
    for (const threadId of ids)
      sink.emit({ threadId, event: systemErrorEvent(threadId) });
    await sink.flush();
    const pending = sink.listUndeliveredThreadIds();
    expect(pending).toContain("thr_90");
    expect(pending).not.toContain("thr_80");
    expect([...delivered, ...pending]).toEqual(
      ids.filter((id) => id !== "thr_80"),
    );
    await sink.flush();
    expect(delivered).toEqual(ids.filter((id) => id !== "thr_80"));
    expect(sink.listUndeliveredThreadIds()).toEqual([]);
    await sink.dispose();
  });

  it("keeps retrying a batch that fails for a retryable reason", async () => {
    const postEvents = vi
      .fn<CreateEventSinkOptions["postEvents"]>()
      .mockRejectedValueOnce(
        new ServerResponseError({
          action: "post events",
          bodyMessage: "database is locked",
          code: "internal_error",
          retryable: true,
          status: 500,
          statusText: "Internal Server Error",
        }),
      )
      .mockImplementation(async (events) => ({
        acceptedEvents: events.map((event, eventIndex) => ({
          eventIndex,
          sequence: eventIndex + 1,
          threadId: event.threadId,
        })),
        rejectedEvents: [],
      }));
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await sink.flush();
    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
  });

  it("keeps events queued when the session, not the batch, is rejected", async () => {
    const postEvents = vi
      .fn<CreateEventSinkOptions["postEvents"]>()
      .mockRejectedValueOnce(
        new ServerResponseError({
          action: "post events",
          bodyMessage: "Session is not active",
          code: "inactive_session",
          retryable: false,
          status: 401,
          statusText: "Unauthorized",
        }),
      )
      .mockImplementation(async (events) => ({
        acceptedEvents: events.map((event, eventIndex) => ({
          eventIndex,
          sequence: eventIndex + 1,
          threadId: event.threadId,
        })),
        rejectedEvents: [],
      }));
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    sink.emit({ threadId: "thr_2", event: systemErrorEvent("thr_2") });
    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(1);

    await sink.flush();
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
      { threadId: "thr_2", event: systemErrorEvent("thr_2") },
    ]);
  });

  it("never throws from emit regardless of how many events queue up", () => {
    const sink = createEventSink({
      isSessionOpen: () => false,
      logger: createLogger(),
      postEvents: acceptingPostEvents(),
    });

    expect(() => {
      for (let index = 0; index < 1000; index += 1) {
        sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
      }
    }).not.toThrow();
  });
});
