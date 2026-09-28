import type { Hono } from "hono";
import { PROMPT_HISTORY_SEARCH_CANDIDATE_LIMIT } from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import { ApiError } from "../errors.js";
import {
  requirePublicProject,
  requirePublicThread,
} from "../services/lib/entity-lookup.js";
import { parseBoundedPositiveOptionalInteger } from "../services/lib/validation.js";
import { searchPromptHistory } from "../services/prompt-history.js";
import type { AppDeps } from "../types.js";

export function registerPromptHistoryRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  get(publicApiRoutes.promptHistory.search, (context, query) => {
    const limit = parseBoundedPositiveOptionalInteger({
      defaultValue: PROMPT_HISTORY_SEARCH_CANDIDATE_LIMIT,
      max: PROMPT_HISTORY_SEARCH_CANDIDATE_LIMIT,
      name: "limit",
      value: query.limit,
    });
    if (query.scope === "project") {
      requirePublicProject(deps.db, query.projectId);
      return context.json(
        searchPromptHistory(deps, {
          scope: query.scope,
          projectId: query.projectId,
          query: query.query,
          limit,
        }),
      );
    }
    if (query.scope === "thread") {
      requirePublicThread(deps.db, query.threadId);
      return context.json(
        searchPromptHistory(deps, {
          scope: query.scope,
          threadId: query.threadId,
          query: query.query,
          limit,
        }),
      );
    }
    return context.json(
      searchPromptHistory(deps, {
        scope: query.scope,
        query: query.query,
        limit,
      }),
    );
  });
}
