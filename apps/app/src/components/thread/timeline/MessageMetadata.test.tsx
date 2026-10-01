// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginMessageMetadataSlot } from "@/lib/plugin-slots";
import { MessageMetadata, resolveMessageMetadata } from "./MessageMetadata";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function slot(
  id: string,
  resolve: PluginMessageMetadataSlot["resolve"],
  roles?: PluginMessageMetadataSlot["roles"],
): PluginMessageMetadataSlot {
  return {
    id,
    pluginId: "fixture",
    generation: 1,
    resolve,
    ...(roles === undefined ? {} : { roles }),
  };
}

const message = {
  id: "msg_1",
  threadId: "thr_1",
  role: "user" as const,
  createdAt: 1_700_000_000_123,
};

describe("MessageMetadata", () => {
  it("filters by role before evaluation and preserves registration order", () => {
    const assistant = vi.fn(() => ({ label: "assistant" }));
    const values = resolveMessageMetadata(
      [
        slot("first", () => ({ label: "first" }), ["user"]),
        slot("assistant", assistant, ["assistant"]),
        slot("empty", () => null),
        slot("last", () => ({ label: "last", title: "Exact time" })),
      ],
      message,
    );
    expect(assistant).not.toHaveBeenCalled();
    expect(values.map((value) => value.label)).toEqual(["first", "last"]);
    expect(values[1]?.title).toBe("Exact time");
  });

  it("contains one resolver failure and rejects oversized output", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const values = resolveMessageMetadata(
      [
        slot("throws", () => {
          throw new Error("boom");
        }),
        slot("long", () => ({ label: "x".repeat(81) })),
        slot("valid", () => ({ label: "valid" })),
      ],
      message,
    );
    expect(values.map((value) => value.label)).toEqual(["valid"]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("passes exact createdAt and stays stable on an unrelated rerender", () => {
    const resolve = vi.fn(() => ({ label: "12:00", title: "Time" }));
    const slots = [slot("time", resolve, ["user"])];
    const view = render(<MessageMetadata slots={slots} {...message} />);
    expect(screen.getByText("12:00").getAttribute("title")).toBe("Time");
    expect(resolve).toHaveBeenCalledWith(message);
    view.rerender(<MessageMetadata slots={slots} {...message} />);
    expect(resolve).toHaveBeenCalledTimes(1);
    view.rerender(
      <MessageMetadata
        slots={slots}
        {...message}
        createdAt={message.createdAt + 1}
      />,
    );
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("refreshes mounted metadata at the local day boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 22, 23, 59, 59));
    const resolve = vi.fn(() => ({ label: "relative day" }));
    render(
      <MessageMetadata slots={[slot("relative", resolve)]} {...message} />,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2_000));
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
