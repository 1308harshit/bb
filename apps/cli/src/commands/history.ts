import { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface HistorySearchOptions {
  json?: boolean;
  project?: string;
  thread?: string;
}

export function registerHistoryCommands(
  program: Command,
  getUrl: () => string,
): void {
  const history = program
    .command("history")
    .description("Search prompt history across threads and projects");

  history
    .command("search <query>")
    .description("Search prompt history")
    .option("--project <id>", "Search one project's prompt history")
    .option("--thread <id>", "Search one thread's prompt history")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (query: string, opts: HistorySearchOptions) => {
        if (opts.project !== undefined && opts.thread !== undefined) {
          throw new Error("--project and --thread are mutually exclusive.");
        }
        const sdk = createCliBbSdk(getUrl());
        const result =
          opts.project !== undefined
            ? await sdk.promptHistory.search({
                scope: "project",
                projectId: opts.project,
                query,
              })
            : opts.thread !== undefined
              ? await sdk.promptHistory.search({
                  scope: "thread",
                  threadId: opts.thread,
                  query,
                })
              : await sdk.promptHistory.search({ scope: "global", query });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );
}
