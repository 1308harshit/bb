// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THREAD_NAMING_PROMPT, defaultAppSettings } from "@bb/domain";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import type { SystemAiServicesResponse } from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  AiServicesSettingsSection,
  automaticServiceFor,
} from "./AiServicesSettingsSection";

const VIEW: SystemAiServicesResponse = {
  selections: {
    "thread-title": { mode: "automatic" },
    "commit-message": {
      mode: "service",
      pluginId: "my-openrouter",
      serviceId: "openrouter-helper",
    },
    voice: { mode: "service", pluginId: "gone-plugin", serviceId: "gone" },
  },
  services: [
    {
      id: "codex",
      displayName: "Codex",
      pluginId: "provider-codex",
      tasks: ["thread-title", "commit-message", "voice"],
      automaticRank: 2,
      status: { ready: false, message: "Run `codex login` to sign in" },
    },
    {
      id: "bb",
      displayName: "bb cloud",
      pluginId: "bb-ai",
      tasks: ["thread-title", "commit-message"],
      automaticRank: 0,
      status: { ready: true },
    },
    {
      id: "openrouter-helper",
      displayName: "OpenRouter",
      pluginId: "my-openrouter",
      tasks: ["thread-title", "commit-message"],
      automaticRank: 1,
      status: { ready: true },
    },
  ],
};

interface RecordedRequest {
  url: string;
  method: string;
  body: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TEST_SUCCESS = (): Response =>
  jsonResponse({
    ok: true,
    pluginId: "bb-ai",
    serviceId: "bb",
    displayName: "bb cloud",
    text: "Add a dark mode toggle",
    durationMs: 412,
  });

function stubFetch(
  testResponse: () => Response = TEST_SUCCESS,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  let settings = { ...defaultAppSettings };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), "http://bb.test"), init);
      const url = new URL(request.url).pathname;
      const text = await request.text();
      requests.push({ url, method: request.method, body: text });
      if (url === "/api/v1/system/config") {
        return jsonResponse(makeSystemConfig({ generalSettings: settings }));
      }
      if (url === "/api/v1/settings/general") {
        settings = JSON.parse(text);
        return jsonResponse(settings);
      }
      if (url === "/api/v1/system/ai-services/selection") {
        const body = JSON.parse(text);
        return jsonResponse({
          ...VIEW,
          selections: { ...VIEW.selections, [body.task]: body.selection },
        });
      }
      if (url === "/api/v1/system/ai-services/test") {
        return testResponse();
      }
      return jsonResponse(VIEW);
    }),
  );
  return requests;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AiServicesSettingsSection", () => {
  it("resolves Automatic to the first ready compatible service", () => {
    expect(automaticServiceFor(VIEW, "thread-title")?.id).toBe("bb");
    expect(automaticServiceFor(VIEW, "voice")).toBeNull();
  });

  it("shows each task's choice, including a selection whose plugin is gone", async () => {
    stubFetch();
    const { wrapper } = createQueryClientTestHarness();
    render(<AiServicesSettingsSection />, { wrapper });

    const titles = await screen.findByRole("button", { name: "Thread titles" });
    await vi.waitFor(() => expect(titles.textContent).toContain("Automatic"));
    expect(
      screen.getByRole("button", { name: "Commit messages" }).textContent,
    ).toContain("OpenRouter");
    expect(
      screen.getByRole("button", { name: "Voice input" }).textContent,
    ).toContain("Unavailable plugin");
    expect(screen.getByText(/Using bb cloud\./u)).toBeTruthy();
  });

  it("offers only services that handle the task and saves the choice", async () => {
    const requests = stubFetch();
    const { wrapper } = createQueryClientTestHarness();
    render(<AiServicesSettingsSection />, { wrapper });

    const trigger = await screen.findByRole("button", { name: "Voice input" });
    await vi.waitFor(() =>
      expect(trigger.textContent).toContain("Unavailable plugin"),
    );
    fireEvent.pointerDown(trigger, { button: 0 });
    expect(
      await screen.findByRole("menuitem", { name: /^Codex/u }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^bb cloud/u })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^OpenRouter/u })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Off/u }));

    await vi.waitFor(() => {
      const put = requests.find(
        (request) => request.url === "/api/v1/system/ai-services/selection",
      );
      expect(JSON.parse(put?.body ?? "null")).toEqual({
        task: "voice",
        selection: { mode: "off" },
      });
    });
    await vi.waitFor(() => expect(trigger.textContent).toContain("Off"));
  });

  it("saves a naming prompt and resets the editor to the default", async () => {
    const requests = stubFetch();
    const { wrapper } = createQueryClientTestHarness();
    render(<AiServicesSettingsSection />, { wrapper });
    const editor = await screen.findByRole("textbox", {
      name: "Thread naming prompt",
    });
    await vi.waitFor(() => expect(editor).not.toBeDisabled());
    fireEvent.change(editor, { target: { value: "Write titles in French." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      const put = requests.find(
        (request) => request.url === "/api/v1/settings/general",
      );
      expect(JSON.parse(put?.body ?? "null").threadNamingPrompt).toBe(
        "Write titles in French.",
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    await vi.waitFor(() =>
      expect(editor).toHaveValue(DEFAULT_THREAD_NAMING_PROMPT),
    );
    const writes = requests.filter(
      (request) => request.url === "/api/v1/settings/general",
    );
    expect(
      JSON.parse(writes.at(-1)?.body ?? "null").threadNamingPrompt,
    ).toBeNull();
  });

  it("runs a test and shows the reply", async () => {
    stubFetch();
    const { wrapper } = createQueryClientTestHarness();
    render(<AiServicesSettingsSection />, { wrapper });

    fireEvent.click(
      await screen.findByRole("button", { name: "Test thread titles" }),
    );
    expect(
      await screen.findByText(
        /Test: “Add a dark mode toggle” from bb cloud in 412 ms\./u,
      ),
    ).toBeTruthy();
  });

  it("shows why a test failed when the service could not answer", async () => {
    stubFetch(() =>
      jsonResponse({
        ok: false,
        message: "Codex: Run `codex login` to sign in",
        durationMs: 3,
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(<AiServicesSettingsSection />, { wrapper });

    fireEvent.click(
      await screen.findByRole("button", { name: "Test commit messages" }),
    );
    expect(
      await screen.findByText(
        /Test failed: Codex: Run `codex login` to sign in/u,
      ),
    ).toBeTruthy();
  });

  it("shows the error when the test request itself fails", async () => {
    stubFetch(() =>
      jsonResponse(
        { code: "internal_error", message: "The sample prompt is empty" },
        500,
      ),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(<AiServicesSettingsSection />, { wrapper });

    fireEvent.click(
      await screen.findByRole("button", { name: "Test thread titles" }),
    );
    expect(
      await screen.findByText(/Test failed: .*The sample prompt is empty/u),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Test thread titles" }).textContent,
    ).toBe("Test");
  });
});
