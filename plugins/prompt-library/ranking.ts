import { Fzf } from "fzf";
import type { PromptSnippet } from "./contract.js";

const SNIPPET_LENGTH = 160;
const SNIPPET_LEAD = 32;

export interface RankedMatch<T> {
  item: T;
  positions: readonly number[];
}

export function queryTerms(query: string): string[] {
  return query.trim().split(/\s+/u).filter(Boolean);
}

export function rankByQuery<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
): RankedMatch<T>[] {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return items.map((item) => ({ item, positions: [] }));
  }
  const matchesByIndex = new Map<
    number,
    { score: number; positions: Set<number>; termCount: number }
  >();
  const indexed = items.map((item, index) => ({ item, index }));
  const matcher = new Fzf(indexed, {
    selector: (entry) => getText(entry.item),
    casing: "smart-case",
    sort: false,
  });
  for (const term of terms) {
    for (const match of matcher.find(term)) {
      const existing = matchesByIndex.get(match.item.index) ?? {
        score: 0,
        positions: new Set<number>(),
        termCount: 0,
      };
      existing.score += match.score;
      existing.termCount += 1;
      for (const position of match.positions) existing.positions.add(position);
      matchesByIndex.set(match.item.index, existing);
    }
  }
  return [...matchesByIndex.entries()]
    .filter(([, match]) => match.termCount === terms.length)
    .sort(
      ([leftIndex, left], [rightIndex, right]) =>
        right.score - left.score || leftIndex - rightIndex,
    )
    .map(([index, match]) => ({
      item: items[index]!,
      positions: [...match.positions].sort((left, right) => left - right),
    }));
}

export function buildSnippet(
  text: string,
  positions: readonly number[],
): PromptSnippet {
  const firstPosition = positions[0] ?? 0;
  const start =
    firstPosition < SNIPPET_LENGTH - SNIPPET_LEAD
      ? 0
      : firstPosition - SNIPPET_LEAD;
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const body = text.slice(start, end).replace(/\s/gu, " ");
  const highlights: [number, number][] = [];
  for (const position of positions) {
    if (position < start || position >= end) continue;
    const offset = position - start + prefix.length;
    const last = highlights.at(-1);
    if (last !== undefined && last[1] === offset) {
      last[1] = offset + 1;
    } else {
      highlights.push([offset, offset + 1]);
    }
  }
  return { text: `${prefix}${body}${suffix}`, highlights };
}
