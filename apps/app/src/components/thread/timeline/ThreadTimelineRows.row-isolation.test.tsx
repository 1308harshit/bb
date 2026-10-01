// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const renderedMessageTexts = vi.hoisted(() => [] as string[]);

vi.mock("./ConversationMessageContent.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./ConversationMessageContent.js")>();
  const Actual = actual.ConversationMessageContent;
  return {
    ...actual,
    ConversationMessageContent: (props: ComponentProps<typeof Actual>) => {
      renderedMessageTexts.push(props.text);
      return createElement(Actual, props);
    },
  };
});

function assistantRow(index: number) {
  return conversationRow({
    id: `assistant_message_${index}`,
    role: "assistant",
    text: `Assistant answer number ${index}.`,
    sourceSeqStart: 10 + index,
    sourceSeqEnd: 10 + index,
    threadId: "thr_main",
  });
}

afterEach(() => {
  cleanup();
  renderedMessageTexts.length = 0;
  resetPluginSlotStoreForTest();
});

describe("ThreadTimelineRows row isolation", () => {
  it("does not resolve metadata again when assistant text streams", () => {
    const resolve = vi.fn(() => ({ label: "Stable" }));
    setPluginSlotRegistrations(
      "fixture",
      makePluginRegistrationSet({
        messageMetadata: [{ id: "stable", resolve }],
      }),
    );
    const queryClient = new QueryClient();
    const renderTimeline = (text: string) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={[
              conversationRow({
                id: "streaming_message",
                role: "assistant",
                text,
                createdAt: 1_700_000_000_123,
                threadId: "thr_main",
              }),
            ]}
            threadRuntimeDisplayStatus="active"
            workspaceRootPath={undefined}
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(renderTimeline("first"));
    expect(resolve).toHaveBeenCalledTimes(1);
    view.rerender(renderTimeline("first second"));
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("re-renders only the rows whose mobile action display flips when a message is appended", () => {
    const queryClient = new QueryClient();
    const rows = Array.from({ length: 12 }, (_, index) => assistantRow(index));
    const renderTimeline = (timelineRows: typeof rows) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={timelineRows}
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={undefined}
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(renderTimeline(rows));
    expect(renderedMessageTexts).toHaveLength(12);
    renderedMessageTexts.length = 0;

    view.rerender(renderTimeline([...rows, assistantRow(12)]));
    expect([...renderedMessageTexts].sort()).toEqual([
      "Assistant answer number 11.",
      "Assistant answer number 12.",
    ]);
  });
});
