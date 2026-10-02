// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentKey } from "@bb/domain";
import { ExperimentsSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(
  onExperimentChange: (key: ExperimentKey, enabled: boolean) => void,
) {
  return render(
    <ExperimentsSettingsSection
      disabled={false}
      experiments={{
        changelogPreview: false,
        serverMove: false,
        performanceDiagnostics: false,
      }}
      onExperimentChange={onExperimentChange}
    />,
  );
}

describe("ExperimentsSettingsSection", () => {
  it.each([
    ["Changelog preview", "changelogPreview"],
    ["Server performance diagnostics", "performanceDiagnostics"],
  ])("reports %s changes", (label, key) => {
    const onChange = vi.fn();
    renderSection(onChange);
    fireEvent.click(screen.getByLabelText(label));
    expect(onChange).toHaveBeenCalledWith(key, true);
  });
});
