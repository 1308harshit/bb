// @vitest-environment jsdom

import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ComposerTypeaheadRegistration } from "@get-bb/plugin-sdk";
import {
  EMPTY_ORDERED_MENTION_SUGGESTIONS,
  type PromptDraftState,
} from "@bb/client-core";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  PluginComposerHostProvider,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import {
  openComposerTypeahead,
  useComposerTypeaheadApi,
} from "@/components/plugin/ComposerTypeaheadHost";
import { useComposer } from "@/lib/plugin-sdk-hooks";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
} from "./PromptBoxInternal";

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => setTimeout(resolve, 2));
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.clearAllMocks();
});

function PickerTypeahead() {
  const composer = useComposer();
  const typeahead = useComposerTypeaheadApi();
  return (
    <div>
      <input aria-label="Search prompts" autoFocus />
      <span data-testid="typeahead-draft">{composer.draft.text}</span>
      <button
        type="button"
        onClick={() => {
          composer.insert("see it ");
          typeahead.close();
        }}
      >
        Insert saved prompt
      </button>
      <button type="button" onClick={() => typeahead.close()}>
        Close picker
      </button>
    </div>
  );
}

function registerPicker(
  overrides: Partial<ComposerTypeaheadRegistration> = {},
) {
  setPluginSlotRegistrations(
    "prompt-library",
    makePluginRegistrationSet({
      composerCustomizations: [
        {
          id: "library",
          experimental_typeaheads: [
            {
              id: "prompts",
              label: "Prompts…",
              component: PickerTypeahead,
              ...overrides,
            },
          ],
        },
      ],
    }),
  );
}

interface RenderedComposer {
  changes: PromptDraftState[];
}

async function renderComposer(initialValue: string): Promise<RenderedComposer> {
  const changes: PromptDraftState[] = [];
  let current: PromptDraftState = {
    text: initialValue,
    mentions: [],
    attachments: [],
  };
  const listeners = new Set<() => void>();

  function Harness() {
    const [draft, setDraftState] = useState(current);
    const [host] = useState<PluginComposerHost>(() => ({
      scope: { kind: "thread", threadId: "thread-1" },
      textEffectKey: "typeahead-test",
      getCurrent: () => current,
      subscribeDraft: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setDraft: (next) => commit(next),
      focus: () => {},
    }));
    const commit = (next: PromptDraftState) => {
      current = next;
      setDraftState(next);
      for (const listener of listeners) listener();
    };
    return (
      <PluginComposerHostProvider value={host}>
        <PromptBoxInternal
          value={draft.text}
          mentionRanges={draft.mentions}
          onChange={(nextValue, nextMentions) => {
            const next = {
              text: nextValue,
              mentions: nextMentions,
              attachments: [],
            };
            changes.push(next);
            commit(next);
          }}
          onSubmit={vi.fn()}
          mentionMenuPlacement="top"
          typeahead={{
            mention: {
              results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
              isLoading: false,
              isError: false,
              onQueryChange: vi.fn(),
            },
            command: INERT_TYPEAHEAD_COMMAND_CONFIG,
          }}
        />
      </PluginComposerHostProvider>
    );
  }

  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(document.querySelector(".ProseMirror")),
  );
  return { changes };
}

function getEditor() {
  const element = document.querySelector(".ProseMirror");
  const editor = (element as TiptapEditorHTMLElement | null)?.editor;
  if (!editor) throw new Error("Prompt editor was not mounted");
  return editor;
}

function placeCaret(position: number) {
  const editor = getEditor();
  act(() => {
    editor.commands.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, position),
      ),
    );
  });
}

async function openFromPlusMenu(label: string) {
  const trigger = screen.getByRole("button", { name: "Prompt actions" });
  fireEvent.pointerDown(trigger, { button: 0 });
  const menu = await screen.findByRole("menu", { name: "Prompt actions" });
  fireEvent.click(within(menu).getByRole("menuitem", { name: label }));
  return screen.findByRole("dialog", { name: label });
}

describe("PromptBoxInternal plugin typeaheads", () => {
  it("opens from the + menu bound to its composer and inserts at the kept cursor", async () => {
    registerPicker();
    const { changes } = await renderComposer("hello world");
    placeCaret(7);

    const dialog = await openFromPlusMenu("Prompts…");
    expect(
      document
        .querySelector("[data-promptbox-typeahead-menu]")
        ?.contains(dialog),
    ).toBe(true);
    expect(within(dialog).getByTestId("typeahead-draft").textContent).toBe(
      "hello world",
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("textbox", { name: "Search prompts" }),
      ),
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Insert saved prompt" }),
    );

    await waitFor(() =>
      expect(changes.at(-1)?.text).toBe("hello see it world"),
    );
    expect(screen.queryByRole("dialog", { name: "Prompts…" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector(".ProseMirror"),
      ),
    );
  });

  it("closes back to the editor without moving the cursor or changing the draft", async () => {
    registerPicker();
    const { changes } = await renderComposer("hello world");
    placeCaret(3);

    const dialog = await openFromPlusMenu("Prompts…");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close picker" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Prompts…" })).toBeNull(),
    );
    expect(changes).toEqual([]);
    expect(getEditor().state.selection.from).toBe(3);
  });

  it("opens from a command in the last focused composer and rejects unknown ids", async () => {
    registerPicker({ plusMenu: false });
    await renderComposer("draft");
    placeCaret(1);

    let opened = false;
    act(() => {
      opened = openComposerTypeahead("prompt-library", "prompts");
    });
    expect(opened).toBe(true);
    expect(
      await screen.findByRole("dialog", { name: "Prompts…" }),
    ).toBeTruthy();
    expect(openComposerTypeahead("prompt-library", "missing")).toBe(false);
    expect(openComposerTypeahead("other-plugin", "prompts")).toBe(false);
  });

  it("omits the + menu row when plusMenu is false", async () => {
    registerPicker({ plusMenu: false });
    await renderComposer("");

    expect(screen.queryByRole("button", { name: "Prompt actions" })).toBeNull();
  });
});
