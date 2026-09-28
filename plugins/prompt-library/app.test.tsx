// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginComposerScope } from "@get-bb/plugin-sdk/app";
import type {
  promptLibraryRpcContract,
  RecentPromptRow,
  StarredPromptRow,
  SearchPromptsInput,
} from "./contract.js";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

let pickerWidth = 728;

class TestResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe() {
    this.callback();
  }
  disconnect() {}
  unobserve() {}
}
globalThis.ResizeObserver =
  TestResizeObserver as unknown as typeof ResizeObserver;
Element.prototype.getBoundingClientRect = function () {
  return { width: pickerWidth, height: 320 } as DOMRect;
};

const app = await loadPluginApp(() => import("./app"));
const typeahead = app.composerCustomizations[0]!.experimental_typeaheads![0]!;

function draft(value: string) {
  return { text: value, mentions: [] };
}

function starredRow(id: string, value: string): StarredPromptRow {
  return {
    id,
    prompt: draft(value),
    snippet: { text: value, highlights: [] },
    createdAt: 1,
    lastUsedAt: null,
  };
}

function recentRow(
  id: string,
  value: string,
  starredId: string | null = null,
): RecentPromptRow {
  return {
    id,
    prompt: draft(value),
    snippet: { text: value, highlights: [] },
    createdAt: 1,
    projectId: "proj_a",
    projectName: "Alpha",
    threadId: "thr_1",
    starredId,
  };
}

function render(
  options: {
    scope?: PluginComposerScope;
    draft?: string;
    starred?: StarredPromptRow[];
    recent?: RecentPromptRow[];
  } = {},
) {
  const search = vi.fn((_input: SearchPromptsInput) => ({
    starred: options.starred ?? [starredRow("prompt_1", "starred prompt")],
    recent: options.recent ?? [recentRow("h1", "recent prompt")],
  }));
  const star = vi.fn(() => ({ id: "prompt_new" }));
  const unstar = vi.fn(() => ({ unstarred: true }));
  const markUsed = vi.fn(() => null);
  const slot = renderSlot<object, typeof promptLibraryRpcContract>(
    typeahead,
    {},
    {
      pluginId: "prompt-library",
      context: { projectId: "proj_a", threadId: "thr_1" },
      composer: {
        scope: options.scope ?? { kind: "thread", threadId: "thr_1" },
        text: options.draft ?? "",
      },
      rpc: { search, star, unstar, markUsed },
    },
  );
  return { slot, search, star, unstar, markUsed };
}

function searchBox(slot: ReturnType<typeof renderSlot>) {
  return slot.getByRole("textbox", { name: "Search prompts" });
}

afterEach(() => {
  pickerWidth = 728;
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("prompt library typeahead", () => {
  it("inserts the highlighted prompt and records use of a starred one", async () => {
    const { slot, markUsed } = render();
    await slot.findByRole("option", { name: /starred prompt/ });

    fireEvent.keyDown(searchBox(slot), { key: "Enter" });

    expect(slot.composer.draft.text).toBe("starred prompt");
    expect(slot.composer.typeaheadCloseCount).toBe(1);
    await waitFor(() =>
      expect(markUsed).toHaveBeenCalledWith({ id: "prompt_1" }),
    );
  });

  it("moves through starred and recent rows with the arrow keys", async () => {
    const { slot, markUsed } = render();
    await slot.findByText("recent prompt");

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    fireEvent.keyDown(searchBox(slot), { key: "Enter" });

    expect(slot.composer.draft.text).toBe("recent prompt");
    expect(markUsed).not.toHaveBeenCalled();
  });

  it("searches as you type and remembers the scope per composer kind", async () => {
    const first = render();
    await first.slot.findByRole("option", { name: /starred prompt/ });
    expect(first.search).toHaveBeenLastCalledWith({
      query: "",
      scope: "global",
      projectId: "proj_a",
      threadId: "thr_1",
    });

    fireEvent.keyDown(searchBox(first.slot), { key: "Tab" });
    await waitFor(() =>
      expect(first.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: "thread" }),
      ),
    );
    fireEvent.change(searchBox(first.slot), { target: { value: "deploy" } });
    await waitFor(() =>
      expect(first.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: "deploy", scope: "thread" }),
      ),
    );
    cleanup();

    const again = render();
    await again.slot.findByRole("option", { name: /starred prompt/ });
    expect(again.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "thread" }),
    );
    cleanup();

    const newThread = render({
      scope: { kind: "new-thread", projectId: "proj_a" },
    });
    await newThread.slot.findByRole("option", { name: /starred prompt/ });
    expect(newThread.search).toHaveBeenLastCalledWith({
      query: "",
      scope: "global",
      projectId: "proj_a",
      threadId: null,
    });
    expect(
      within(newThread.slot.getByRole("radiogroup", { name: "Search scope" }))
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Project", "All"]);
  });

  it("stars and unstars prompts with Mod+S", async () => {
    const { slot, star, unstar } = render({
      recent: [
        recentRow("h1", "recent prompt"),
        recentRow("h2", "already starred", "prompt_2"),
      ],
    });
    await slot.findByText("recent prompt");

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    fireEvent.keyDown(searchBox(slot), { key: "s", metaKey: true });
    await waitFor(() =>
      expect(star).toHaveBeenCalledWith({ prompt: draft("recent prompt") }),
    );

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    fireEvent.keyDown(searchBox(slot), { key: "s", ctrlKey: true });
    await waitFor(() =>
      expect(unstar).toHaveBeenCalledWith({ id: "prompt_2" }),
    );
  });

  it("offers to star a non-empty draft that is not starred yet", async () => {
    const { slot, star } = render({ draft: "draft to keep" });
    await slot.findByText("Star current draft");

    fireEvent.keyDown(searchBox(slot), { key: "Enter" });

    await waitFor(() =>
      expect(star).toHaveBeenCalledWith({ prompt: draft("draft to keep") }),
    );
    expect(slot.composer.draft.text).toBe("draft to keep");
    expect(slot.composer.typeaheadCloseCount).toBe(0);
  });

  it("inserts into a non-empty draft instead of replacing it", async () => {
    const { slot } = render({ draft: "Before merging, " });
    await slot.findByText("recent prompt");

    fireEvent.click(slot.getByText("recent prompt"));

    expect(slot.composer.draft.text).toBe("Before merging, recent prompt");
    expect(slot.composer.typeaheadCloseCount).toBe(1);
  });

  it("previews the highlighted prompt in full beside the list", async () => {
    const long = `${"Please start a worktree server. ".repeat(20)}\n\nThen share the link.`;
    const { slot } = render({ recent: [recentRow("h1", long)] });
    await slot.findByRole("option", { name: /starred prompt/ });
    const preview = slot.getByRole("region", { name: "Prompt preview" });
    expect(preview.textContent).toContain("starred prompt");

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });

    await waitFor(() =>
      expect(
        slot.getByRole("region", { name: "Prompt preview" }).textContent,
      ).toContain("Then share the link."),
    );
    fireEvent.click(
      within(slot.getByRole("region", { name: "Prompt preview" })).getByRole(
        "button",
        { name: "Insert" },
      ),
    );
    expect(slot.composer.draft.text).toBe(long);
  });

  it("opens a preview on tap when there is no room for two panes", async () => {
    pickerWidth = 390;
    const { slot } = render();
    await slot.findByText("recent prompt");
    expect(slot.queryByRole("region", { name: "Prompt preview" })).toBeNull();

    fireEvent.click(slot.getByText("recent prompt"));

    const preview = await slot.findByRole("region", { name: "Prompt preview" });
    expect(slot.queryByRole("listbox", { name: "Prompts" })).toBeNull();
    expect(slot.composer.draft.text).toBe("");

    fireEvent.click(within(preview).getByRole("button", { name: "Back" }));
    expect(await slot.findByRole("listbox", { name: "Prompts" })).toBeTruthy();

    fireEvent.click(slot.getByText("recent prompt"));
    fireEvent.click(
      within(
        await slot.findByRole("region", { name: "Prompt preview" }),
      ).getByRole("button", { name: "Insert" }),
    );
    expect(slot.composer.draft.text).toBe("recent prompt");
  });

  it("closes on Escape without inserting", async () => {
    const { slot } = render();
    await slot.findByRole("option", { name: /starred prompt/ });

    fireEvent.keyDown(searchBox(slot), { key: "Escape" });

    expect(slot.composer.typeaheadCloseCount).toBe(1);
    expect(slot.composer.draft.text).toBe("");
  });
});
