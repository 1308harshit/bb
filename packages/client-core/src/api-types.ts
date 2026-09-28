import type { ThreadOriginKind } from "@bb/domain";
import type { CreateThreadRequest } from "@bb/server-contract";

export type AppCreateThreadRequest = Omit<
  CreateThreadRequest,
  "origin" | "startedOnBehalfOf" | "originKind"
> &
  Partial<Pick<CreateThreadRequest, "startedOnBehalfOf" | "originKind">>;

export interface ThreadListFilters {
  projectId?: string;
  parentThreadId?: string;
  sourceThreadId?: string;
  sectionId?: string | null;
  hasParent?: boolean;
  originKind?: ThreadOriginKind;
  archived: boolean;
}

export interface ThreadSearchFilters {
  query: string;
  limitPerGroup?: number;
}
