import { Command } from "commander";
import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { resolveExplicitIdFlag } from "../../context-env.js";
import {
  columnWidths,
  printBorderlessTable,
  truncateCell,
} from "../../table.js";
import { outputJson } from "../helpers.js";
import {
  resolveMachineHostId,
  resolveMachineTargetOption,
} from "../machine.js";

interface ThreadListCommandOptions {
  environment?: string;
  machine?: string;
  host?: string;
  project?: string;
  parentThread?: string;
  archived?: boolean;
  section?: string;
  unsectioned?: boolean;
  json?: boolean;
  includeHidden?: boolean;
  limit?: string;
  cursor?: string;
}

const DEFAULT_THREAD_LIST_PAGE_SIZE = 50;
const MAX_THREAD_LIST_PAGE_SIZE = 200;

function parseThreadListPageSize(value: string | undefined): number {
  if (value === undefined) return DEFAULT_THREAD_LIST_PAGE_SIZE;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("--limit must be an integer between 1 and 200.");
  }
  const pageSize = Number(value);
  if (!Number.isSafeInteger(pageSize) || pageSize > MAX_THREAD_LIST_PAGE_SIZE) {
    throw new Error("--limit must be an integer between 1 and 200.");
  }
  return pageSize;
}

export function registerListCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("list")
    .description("List a page of active threads, newest first")
    .option("--project <id>", "Filter by project ID (defaults to all projects)")
    .option("--environment <id>", "Filter by environment ID")
    .option(
      "--machine <id-or-name>",
      "Filter by machine ID or active machine name",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--parent-thread <id>", "Filter by parent thread ID")
    .option("--section <id>", "Filter by thread section ID")
    .option("--unsectioned", "Show only threads outside sections")
    .option(
      "--archived",
      "Show only archived threads, most recently archived first",
    )
    .option("--include-hidden", "Include hidden threads")
    .option("--limit <count>", "Threads per page, 1–200 (default 50)")
    .option("--cursor <cursor>", "Continue from a previous page's nextCursor")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ThreadListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const projectId = resolveExplicitIdFlag({
          flagName: "--project flag",
          value: opts.project,
        });
        const parentThreadId = resolveExplicitIdFlag({
          flagName: "--parent-thread",
          value: opts.parentThread,
        });
        const environmentId = resolveExplicitIdFlag({
          flagName: "--environment",
          value: opts.environment,
        });
        const machineTarget = resolveMachineTargetOption(opts);
        const hostId =
          machineTarget === undefined
            ? undefined
            : machineTarget.trim().startsWith("host_")
              ? resolveExplicitIdFlag({
                  flagName: "--machine",
                  value: machineTarget,
                })
              : await resolveMachineHostId({
                  serverUrl: getUrl(),
                  target: machineTarget,
                });
        if (opts.section && opts.unsectioned) {
          throw new Error("Cannot combine --section with --unsectioned.");
        }
        const sectionId = resolveExplicitIdFlag({
          flagName: "--section",
          value: opts.section,
        });
        const filters = {
          ...(projectId ? { projectId } : {}),
          ...(environmentId ? { environmentId } : {}),
          ...(hostId ? { hostId } : {}),
          ...(parentThreadId ? { parentThreadId } : {}),
          ...(opts.archived
            ? { archived: true, order: "archived" as const }
            : {}),
          ...(sectionId ? { sectionId } : {}),
          ...(opts.unsectioned ? { sectionId: null } : {}),
          ...(opts.includeHidden ? { includeHidden: true } : {}),
        };
        const pageSize = parseThreadListPageSize(opts.limit);
        if (opts.cursor !== undefined && opts.cursor.trim().length === 0) {
          throw new Error(
            "--cursor must be a nonempty cursor from a previous page.",
          );
        }
        const page = await sdk.threads.list({
          ...filters,
          pageSize,
          ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
        });
        if (outputJson(opts, page)) return;
        if (page.threads.length === 0) {
          console.log("No threads found");
          return;
        }
        const projects = await sdk.projects.list({ includePersonal: false });
        const projectNames = new Map(
          projects.map((project) => [project.id, project.name]),
        );
        printThreadTable(page.threads, projectNames);
        if (page.nextCursor !== null) {
          console.log(`Next cursor: ${page.nextCursor}`);
          console.log("Use --cursor with the same filters to continue.");
        }
      }),
    );
}

const MAX_TITLE_WIDTH = 60;

function printThreadTable(
  threads: Thread[],
  projectNames: ReadonlyMap<string, string>,
): void {
  const rows = threads.map((thread) => [
    thread.id,
    truncateCell(formatThreadListTitle(thread), MAX_TITLE_WIDTH),
    formatThreadListProject(thread, projectNames),
    formatThreadListStatus(thread),
  ]);
  printBorderlessTable(
    {
      head: ["ID", "Title", "Project", "Status"],
      colWidths: columnWidths(rows, [4, 5, 7, 12]),
    },
    rows,
  );
}

function formatThreadListTitle(thread: Thread): string {
  const title = thread.title?.trim();
  if (title) return title;
  const fallback = thread.titleFallback?.trim();
  if (fallback) return fallback;
  return "-";
}

function formatThreadListProject(
  thread: Thread,
  projectNames: ReadonlyMap<string, string>,
): string {
  if (thread.projectId === PERSONAL_PROJECT_ID) return "-";
  return projectNames.get(thread.projectId) ?? thread.projectId;
}

function formatThreadListStatus(thread: Thread): string {
  const flags: string[] = [];
  if (thread.archivedAt !== null) {
    flags.push("archived");
  }
  if (thread.pinnedAt !== null) {
    flags.push("pinned");
  }
  if (flags.length === 0) {
    return thread.status;
  }
  return `${thread.status} (${flags.join(", ")})`;
}
