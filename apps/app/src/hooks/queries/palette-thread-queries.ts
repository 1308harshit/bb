import { useQuery } from "@tanstack/react-query";
import type { ThreadListResponse } from "@bb/server-contract";
import { useThreadListRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { sdk } from "@/lib/sdk";
import { threadListQueryKey } from "./query-keys";
import {
  THREAD_LIST_STALE_TIME_MS,
  THREAD_SEARCH_LIMIT_PER_GROUP,
} from "./thread-queries";

export function usePaletteRecentArchivedThreads({
  enabled,
}: {
  enabled: boolean;
}) {
  useThreadListRealtimeSubscription({ enabled });
  const filters = {
    archived: true,
    pageSize: THREAD_SEARCH_LIMIT_PER_GROUP,
    order: "archived" as const,
  };
  return useQuery<ThreadListResponse>({
    queryKey: threadListQueryKey(filters),
    queryFn: ({ signal }) =>
      sdk.threads.list({ ...filters, signal }).then((page) => page.threads),
    enabled,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}
