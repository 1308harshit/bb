import type { ThreadStatus, ThreadTimelinePendingTodos } from "@bb/domain";
import type {
  ProjectResponse,
  ThreadListResponse,
  ThreadResponse,
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface StatusGetArgs {
  projectId?: string;
  signal?: AbortSignal;
  threadId?: string;
}

export interface StatusThreadSummary {
  environmentId: string | null;
  id: string;
  parentThreadId: string | null;
  pinnedAt: number | null;
  projectId: string;
  status: ThreadStatus;
  title: string | null;
}

export type StatusProject = ProjectResponse;
export type StatusSourceThread = ThreadResponse | ThreadWithIncludesResponse;
export type StatusChildThreads = ThreadListResponse;
export type StatusTimeline = ThreadTimelineResponse;

export interface StatusResult {
  childThreads: StatusChildThreads | null;
  childThreadCount: number | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  project: StatusProject | null;
  thread: StatusThreadSummary | null;
}

export interface StatusArea {
  get(args?: StatusGetArgs): Promise<StatusResult>;
}

async function fetchSilent<TValue>(
  fn: () => Promise<TValue>,
): Promise<TValue | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function summarizeThread(thread: StatusSourceThread): StatusThreadSummary {
  return {
    environmentId: thread.environmentId ?? null,
    id: thread.id,
    parentThreadId: thread.parentThreadId ?? null,
    pinnedAt: thread.pinnedAt,
    projectId: thread.projectId,
    status: thread.status,
    title: thread.title ?? null,
  };
}

export function createStatusArea(args: CreateSdkAreaArgs): StatusArea {
  const { transport } = args;
  return {
    async get(input = {}) {
      const projectId = input.projectId;
      const signal = input.signal;
      const threadId = input.threadId;
      const [project, thread] = await Promise.all([
        projectId
          ? fetchSilent(() =>
              transport.readJson(
                transport.api.v1.projects[":id"].$get(
                  {
                    param: { id: projectId },
                  },
                  ...signalRequestArgs(signal),
                ),
              ),
            )
          : Promise.resolve(null),
        threadId
          ? fetchSilent(() =>
              transport.readJson(
                transport.api.v1.threads[":id"].$get(
                  {
                    param: { id: threadId },
                  },
                  ...signalRequestArgs(signal),
                ),
              ),
            )
          : Promise.resolve(null),
      ]);
      const pendingTodos =
        thread === null
          ? null
          : await fetchSilent(async () => {
              const timeline: StatusTimeline = await transport.readJson(
                transport.api.v1.threads[":id"].timeline.$get(
                  {
                    param: { id: thread.id },
                    query: { summaryOnly: "true" },
                  },
                  ...signalRequestArgs(signal),
                ),
              );
              return timeline.pendingTodos;
            });
      const childThreadData =
        thread === null
          ? null
          : await fetchSilent(async () => {
              const [summary, activePage, archivedPage] = await Promise.all([
                transport.readJson(
                  transport.api.v1.threads[":id"]["child-summary"].$get(
                    { param: { id: thread.id } },
                    ...signalRequestArgs(signal),
                  ),
                ),
                ...[false, true].map((archived) =>
                  transport.readJson(
                    transport.api.v1.threads.$get(
                      {
                        query: {
                          parentThreadId: thread.id,
                          archived: archived ? "true" : "false",
                          pageSize: "20",
                        },
                      },
                      ...signalRequestArgs(signal),
                    ),
                  ),
                ),
              ]);
              if (Array.isArray(activePage) || Array.isArray(archivedPage))
                throw new Error("Expected a paginated thread list response");
              const children = [...activePage.threads, ...archivedPage.threads];
              return {
                count: summary.nonDeletedChildCount,
                threads: children
                  .sort(
                    (left, right) =>
                      right.createdAt - left.createdAt ||
                      right.id.localeCompare(left.id),
                  )
                  .slice(0, 20),
              };
            });

      return {
        childThreads: childThreadData?.threads ?? null,
        childThreadCount: childThreadData?.count ?? null,
        pendingTodos,
        project,
        thread: thread === null ? null : summarizeThread(thread),
      };
    },
  };
}
