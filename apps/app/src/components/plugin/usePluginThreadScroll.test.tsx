// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useContext, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadScroll } from "@get-bb/plugin-sdk";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { ThreadScrollContext } from "@/components/ui/thread-scroll-context";
import { PluginSlotMount } from "./PluginSlotMount";
import { usePluginThreadScroll } from "./usePluginThreadScroll";

let resize: () => void;
let scroll: ExperimentalThreadScroll;
let contentArrived: (version: number) => void;

function Probe() {
  const api = usePluginThreadScroll();
  const timeline = useContext(ThreadScrollContext);
  useLayoutEffect(() => {
    scroll = api;
    contentArrived = timeline?.contentArrived ?? (() => {});
  }, [api, timeline]);
  return (
    <>
      <div data-testid="own">Routine emails</div>
      <PluginSlotMount pluginId="nested" slotKind="directive" slotId="nested">
        <div data-testid="nested">Nested plugin</div>
      </PluginSlotMount>
    </>
  );
}

function Slots() {
  return (
    <>
      <PluginSlotMount pluginId="digest" slotKind="directive" slotId="issue">
        <Probe />
      </PluginSlotMount>
      <PluginSlotMount
        pluginId="digest"
        slotKind="directive"
        slotId="other-issue"
      >
        <div data-testid="sibling">Another instance of the same plugin</div>
      </PluginSlotMount>
      <div data-testid="host">Host element</div>
    </>
  );
}

function fixture(footer = false) {
  const view = render(
    <BottomAnchoredScrollBody
      footer={footer ? <div>Composer</div> : null}
      maxWidthClassName="max-w-none"
    >
      <Slots />
    </BottomAnchoredScrollBody>,
  );
  const viewport = view.container.querySelector<HTMLElement>(
    "[data-page-scroll-viewport]",
  );
  if (!viewport) throw new Error("Missing timeline viewport");
  let height = 1400;
  Object.defineProperties(viewport, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, value: 400 },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 600, 400),
  );
  const own = view.getByTestId("own");
  vi.spyOn(own, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 200 - viewport.scrollTop, 600, 800),
  );
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    viewport.scrollTop = options.top ?? viewport.scrollTop;
  });
  Object.defineProperty(viewport, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  act(() => {
    contentArrived(10);
    resize();
  });
  return {
    ...view,
    viewport,
    own,
    scrollTo,
    grow: () => {
      height += 200;
      resize();
    },
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("plugin timeline scrolling", () => {
  it("holds expanded content through resize and resumes for a newer event or a user return to bottom", () => {
    const { viewport, own, grow, scrollTo } = fixture();
    expect(viewport.scrollTop).toBe(1000);
    act(() =>
      expect(scroll.scrollIntoView(own, { behavior: "smooth" })).toBe(true),
    );
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: "smooth" });
    fireEvent.scroll(viewport);
    act(grow);
    expect(viewport.scrollTop).toBe(200);
    act(() => contentArrived(10));
    expect(viewport.scrollTop).toBe(200);
    act(() => contentArrived(11));
    expect(viewport.scrollTop).toBe(1200);
    act(() => scroll.scrollIntoView(own));
    fireEvent.wheel(viewport, { deltaY: 1000 });
    viewport.scrollTop = 1200;
    fireEvent.scroll(viewport);
    act(grow);
    expect(viewport.scrollTop).toBe(1400);
  });

  it("retries a target clamped by the host's expanding message height", () => {
    const { viewport, own, grow } = fixture();
    vi.spyOn(own, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 1100 - viewport.scrollTop, 600, 100),
    );
    act(() => scroll.scrollIntoView(own));
    expect(viewport.scrollTop).toBe(1000);
    act(grow);
    expect(viewport.scrollTop).toBe(1100);
    act(grow);
    expect(viewport.scrollTop).toBe(1100);
  });

  it.each(["end", "nearest"] as const)(
    "keeps %s alignment above the sticky composer",
    (block) => {
      const { viewport, own, container } = fixture(true);
      const footer = container.querySelector("[data-scroll-footer]");
      if (!footer) throw new Error("Missing composer");
      vi.spyOn(footer, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 280, 600, 120),
      );
      vi.spyOn(own, "getBoundingClientRect").mockImplementation(
        () => new DOMRect(0, 550 - viewport.scrollTop, 600, 100),
      );
      viewport.scrollTop = 300;
      act(() => scroll.scrollIntoView(own, { block }));
      expect(viewport.scrollTop).toBe(370);
    },
  );

  it("does not reattach on a smooth scroll's first near-bottom frame", () => {
    const { viewport, own, scrollTo, grow } = fixture();
    scrollTo.mockImplementation(() => {});
    act(() => scroll.scrollIntoView(own, { behavior: "smooth" }));
    fireEvent.scroll(viewport);
    act(grow);
    expect(viewport.scrollTop).toBe(1000);
  });

  it("rejects foreign, nested, disconnected and expired slot elements without moving the timeline", () => {
    const view = fixture();
    for (const element of [
      view.getByTestId("sibling"),
      view.getByTestId("nested"),
      view.getByTestId("host"),
      document.createElement("div"),
    ]) {
      expect(scroll.scrollIntoView(element)).toBe(false);
    }
    expect(view.scrollTo).not.toHaveBeenCalled();
    const retained = scroll;
    view.unmount();
    expect(retained.scrollIntoView(view.own)).toBe(false);
  });

  it("returns false when a plugin renders outside a timeline", () => {
    const view = render(<Slots />);
    expect(scroll.scrollIntoView(view.getByTestId("own"))).toBe(false);
  });

  it("honors reduced motion even when the plugin requests smooth scrolling", () => {
    const original = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    const { own, scrollTo } = fixture();
    act(() => scroll.scrollIntoView(own, { behavior: "smooth", block: "end" }));
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 600,
      behavior: "instant",
    });
  });
});
