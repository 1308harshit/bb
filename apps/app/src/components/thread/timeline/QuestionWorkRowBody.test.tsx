// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { questionRow } from "@/test/fixtures/thread-timeline-rows";
import { QuestionWorkRowBody } from "./QuestionWorkRowBody.js";

vi.mock("@/lib/sdk", () => ({ sdk: { threads: { send: vi.fn() } } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows an undelivered answer and sends it only after explicit recovery", async () => {
  const { wrapper, queryClient } = createQueryClientTestHarness();
  vi.mocked(sdk.threads.send).mockResolvedValue({ ok: true, delivery: "sent" });
  const row = questionRow({
    lifecycle: "interrupted",
    status: "interrupted",
    threadId: "thr_recovery",
    questions: [
      {
        id: "q",
        prompt: "Which target?",
        shortLabel: "Target",
        multiSelect: false,
        options: [{ value: "staging", label: "Staging" }],
        allowFreeText: true,
      },
    ],
    answers: { q: { selected: ["staging"], freeText: "Please explain first" } },
    statusReason: "Question cancelled",
  });
  render(<QuestionWorkRowBody row={row} />, { wrapper });
  expect(screen.getByText("Please explain first")).toBeTruthy();
  expect(
    screen.getByText(
      "Answer delivery wasn’t confirmed. Your answer has been saved.",
    ),
  ).toBeTruthy();
  expect(sdk.threads.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send as message" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Answer sent" })
        .hasAttribute("disabled"),
    ).toBe(true),
  );
  expect(sdk.threads.send).toHaveBeenCalledTimes(1);
  expect(sdk.threads.send).toHaveBeenCalledWith(
    expect.objectContaining({
      threadId: "thr_recovery",
      mode: "queue-if-active",
      input: [
        {
          type: "text",
          mentions: [],
          text: "Which target?\nStaging, Please explain first",
        },
      ],
    }),
  );
  queryClient.clear();
});
