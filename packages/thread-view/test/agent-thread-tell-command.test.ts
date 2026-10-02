import { describe, expect, it } from "vitest";
import { parseAgentThreadTellCommand } from "../src/agent-thread-tell-command.js";

describe("parseAgentThreadTellCommand", () => {
  it("reads the target thread and quoted message", () => {
    expect(
      parseAgentThreadTellCommand(
        'bb thread tell thr_abc123 "Is the fix \\"ready\\"?"',
      ),
    ).toEqual({ targetThreadId: "thr_abc123", message: 'Is the fix "ready"?' });
  });

  it("accepts the message alias, BB_CLI, flags and shell wrappers", () => {
    expect(
      parseAgentThreadTellCommand(
        `/bin/zsh -lc '"$BB_CLI" thread message thr_x1 --mode queue "hi there"'`,
      ),
    ).toEqual({ targetThreadId: "thr_x1", message: "hi there" });
  });

  it("reads a heredoc passed to --message-file", () => {
    expect(
      parseAgentThreadTellCommand(
        "bb thread tell thr_x1 --message-file - <<'EOF'\nline one\nline two\nEOF",
      ),
    ).toEqual({ targetThreadId: "thr_x1", message: "line one\nline two" });
  });

  it("keeps the target when the message comes from a file", () => {
    expect(
      parseAgentThreadTellCommand(
        "bb thread tell thr_x1 --message-file /tmp/msg.txt",
      ),
    ).toEqual({ targetThreadId: "thr_x1", message: null });
  });

  it("ignores other thread commands, help, and lookalikes", () => {
    expect(parseAgentThreadTellCommand("bb thread wait thr_x1")).toBeNull();
    expect(parseAgentThreadTellCommand("bb thread tell --help")).toBeNull();
    expect(parseAgentThreadTellCommand("nbb thread tell thr_x1 hi")).toBeNull();
    expect(parseAgentThreadTellCommand("bb thread tell")).toBeNull();
  });
});
