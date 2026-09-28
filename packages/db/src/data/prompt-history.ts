import { acquireProjectAttachmentOwnership } from "./project-attachments.js";
import { projectAttachmentPaths } from "@bb/domain";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  PROMPT_HISTORY_ENTRY_LIMIT,
  PROMPT_HISTORY_SEARCH_CANDIDATE_LIMIT,
  type PromptHistoryScope,
  type PromptInput,
} from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import { promptHistoryEntries, threads } from "../schema.js";
import { createPromptHistoryEntryId } from "../ids.js";

export interface StoredPromptHistoryEntryRow {
  createdAt: number;
  id: string;
  input: string;
  projectId: string;
  requestSequence: number;
  threadId: string;
}

export interface CreatePromptHistoryEntryInput {
  createdAt?: number;
  input: PromptInput[];
  projectId: string;
  requestSequence: number;
  scope: PromptHistoryScope;
  threadId: string;
}

export interface ListStoredPromptHistoryArgs {
  limit: number;
}

export interface ListStoredProjectPromptHistoryArgs extends ListStoredPromptHistoryArgs {
  projectId: string;
}

export interface ListStoredThreadPromptHistoryArgs extends ListStoredPromptHistoryArgs {
  threadId: string;
}

export type ListPromptHistoryCandidatesArgs = {
  limit: number;
  query?: string;
} & (
  | { scope: "global"; projectId?: never; threadId?: never }
  | { scope: "project"; projectId: string; threadId?: never }
  | { scope: "thread"; projectId?: never; threadId: string }
);

function rawPromptHistoryRowLimit(limit: number): number {
  return Math.min(
    PROMPT_HISTORY_ENTRY_LIMIT * 2,
    limit + PROMPT_HISTORY_ENTRY_LIMIT,
  );
}

export function createPromptHistoryEntry(
  db: DbQueryConnection,
  input: CreatePromptHistoryEntryInput,
): StoredPromptHistoryEntryRow {
  return db.transaction(
    (tx) => {
      acquireProjectAttachmentOwnership(
        tx,
        input.threadId,
        projectAttachmentPaths(input.input),
      );
      const createdAt = input.createdAt ?? Date.now();
      return tx
        .insert(promptHistoryEntries)
        .values({
          id: createPromptHistoryEntryId(),
          projectId: input.projectId,
          threadId: input.threadId,
          scope: input.scope,
          requestSequence: input.requestSequence,
          input: JSON.stringify(input.input),
          createdAt,
        })
        .returning({
          createdAt: promptHistoryEntries.createdAt,
          id: promptHistoryEntries.id,
          input: promptHistoryEntries.input,
          projectId: promptHistoryEntries.projectId,
          requestSequence: promptHistoryEntries.requestSequence,
          threadId: promptHistoryEntries.threadId,
        })
        .get();
    },
    { behavior: "immediate" },
  );
}

export function listStoredProjectPromptHistoryRows(
  db: DbQueryConnection,
  args: ListStoredProjectPromptHistoryArgs,
): StoredPromptHistoryEntryRow[] {
  return db
    .select({
      createdAt: promptHistoryEntries.createdAt,
      id: promptHistoryEntries.id,
      input: promptHistoryEntries.input,
      projectId: promptHistoryEntries.projectId,
      requestSequence: promptHistoryEntries.requestSequence,
      threadId: promptHistoryEntries.threadId,
    })
    .from(promptHistoryEntries)
    .innerJoin(threads, eq(threads.id, promptHistoryEntries.threadId))
    .where(
      and(
        eq(promptHistoryEntries.projectId, args.projectId),
        eq(promptHistoryEntries.scope, "project"),
        isNull(threads.deletedAt),
      ),
    )
    .orderBy(
      desc(promptHistoryEntries.createdAt),
      desc(promptHistoryEntries.requestSequence),
      desc(promptHistoryEntries.id),
    )
    .limit(rawPromptHistoryRowLimit(args.limit))
    .all();
}

export function listStoredThreadPromptHistoryRows(
  db: DbQueryConnection,
  args: ListStoredThreadPromptHistoryArgs,
): StoredPromptHistoryEntryRow[] {
  return db
    .select({
      createdAt: promptHistoryEntries.createdAt,
      id: promptHistoryEntries.id,
      input: promptHistoryEntries.input,
      projectId: promptHistoryEntries.projectId,
      requestSequence: promptHistoryEntries.requestSequence,
      threadId: promptHistoryEntries.threadId,
    })
    .from(promptHistoryEntries)
    .where(
      and(
        eq(promptHistoryEntries.threadId, args.threadId),
        eq(promptHistoryEntries.scope, "thread"),
      ),
    )
    .orderBy(
      desc(promptHistoryEntries.createdAt),
      desc(promptHistoryEntries.requestSequence),
      desc(promptHistoryEntries.id),
    )
    .limit(rawPromptHistoryRowLimit(args.limit))
    .all();
}

function escapeLikeTerm(term: string): string {
  return term
    .replaceAll("!", "!!")
    .replaceAll("%", "!%")
    .replaceAll("_", "!_");
}

function promptHistoryTextMatchesTerm(term: string): SQL {
  const pattern = `%${escapeLikeTerm(term)}%`;
  return sql`EXISTS (
    SELECT 1
    FROM json_each(
      CASE
        WHEN json_valid(${promptHistoryEntries.input})
        THEN ${promptHistoryEntries.input}
        ELSE '[]'
      END
    ) AS input_part
    WHERE COALESCE(json_extract(input_part.value, '$.visibility'), '') <> 'agent-only'
      AND json_extract(input_part.value, '$.type') = 'text'
      AND COALESCE(json_extract(input_part.value, '$.text'), '') LIKE ${pattern} ESCAPE '!'
  )`;
}

function promptHistoryScopeCondition(
  args: ListPromptHistoryCandidatesArgs,
): SQL | undefined {
  if (args.scope === "project") {
    return eq(promptHistoryEntries.projectId, args.projectId);
  }
  if (args.scope === "thread") {
    return eq(promptHistoryEntries.threadId, args.threadId);
  }
  return undefined;
}

export function listPromptHistoryCandidates(
  db: DbQueryConnection,
  args: ListPromptHistoryCandidatesArgs,
): StoredPromptHistoryEntryRow[] {
  const limit = Math.min(
    Math.max(0, args.limit),
    PROMPT_HISTORY_SEARCH_CANDIDATE_LIMIT,
  );
  if (limit === 0) {
    return [];
  }
  const terms = (args.query ?? "")
    .trim()
    .split(/\s+/u)
    .filter((term) => term.length > 0);
  const conditions = [
    isNull(threads.deletedAt),
    promptHistoryScopeCondition(args),
    ...terms.map(promptHistoryTextMatchesTerm),
  ].filter((condition): condition is SQL => condition !== undefined);

  return db
    .select({
      createdAt: promptHistoryEntries.createdAt,
      id: promptHistoryEntries.id,
      input: promptHistoryEntries.input,
      projectId: promptHistoryEntries.projectId,
      requestSequence: promptHistoryEntries.requestSequence,
      threadId: promptHistoryEntries.threadId,
    })
    .from(promptHistoryEntries)
    .innerJoin(threads, eq(threads.id, promptHistoryEntries.threadId))
    .where(and(...conditions))
    .orderBy(
      desc(promptHistoryEntries.createdAt),
      desc(promptHistoryEntries.requestSequence),
      desc(promptHistoryEntries.id),
    )
    .limit(limit)
    .all();
}
