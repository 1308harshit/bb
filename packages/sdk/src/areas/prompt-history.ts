import type {
  PromptHistorySearchQuery,
  PromptHistorySearchResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export type PromptHistorySearchArgs = PromptHistorySearchQuery & {
  signal?: AbortSignal;
};

export type PromptHistorySearchResult = PromptHistorySearchResponse;

export interface PromptHistoryArea {
  search(args: PromptHistorySearchArgs): Promise<PromptHistorySearchResult>;
}

export function createPromptHistoryArea({
  transport,
}: CreateSdkAreaArgs): PromptHistoryArea {
  return {
    async search(input) {
      const { signal, ...query } = input;
      return transport.readJson(
        transport.api.v1["prompt-history"].search.$get(
          { query },
          ...signalRequestArgs(signal),
        ),
      );
    },
  };
}
