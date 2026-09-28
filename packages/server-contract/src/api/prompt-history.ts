import { z } from "zod";
import {
  promptHistorySearchEntrySchema,
  promptHistorySearchScopeSchema,
} from "@bb/domain";

const promptHistorySearchCommonQueryFields = {
  limit: z.string().regex(/^\d+$/u).optional(),
  query: z.string().optional(),
};

export const promptHistorySearchQuerySchema = z.discriminatedUnion("scope", [
  z.object({
    ...promptHistorySearchCommonQueryFields,
    projectId: z.never().optional(),
    scope: promptHistorySearchScopeSchema.extract(["global"]),
    threadId: z.never().optional(),
  }),
  z.object({
    ...promptHistorySearchCommonQueryFields,
    projectId: z.string().min(1),
    scope: promptHistorySearchScopeSchema.extract(["project"]),
    threadId: z.never().optional(),
  }),
  z.object({
    ...promptHistorySearchCommonQueryFields,
    projectId: z.never().optional(),
    scope: promptHistorySearchScopeSchema.extract(["thread"]),
    threadId: z.string().min(1),
  }),
]);
export type PromptHistorySearchQuery = z.infer<
  typeof promptHistorySearchQuerySchema
>;

export const promptHistorySearchResponseSchema = z.array(
  promptHistorySearchEntrySchema,
);
export type PromptHistorySearchResponse = z.infer<
  typeof promptHistorySearchResponseSchema
>;
