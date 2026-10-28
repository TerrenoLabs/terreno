import type {ColumnSortInterface} from "@terreno/ui";
import {DEFAULT_TRACE_SORT, type TraceSortKey} from "./traceTypes";

/** Column order; `TRACE_SORT_KEY_BY_COLUMN` and the row builder index into it. */
const COLUMN_INDEX = {
  cost: 9,
  latency: 10,
  name: 2,
  scores: 11,
  spans: 7,
  startedAt: 3,
  status: 1,
  tokens: 8,
} as const;

const TRACE_SORT_KEY_BY_COLUMN: Partial<Record<number, TraceSortKey>> = {
  [COLUMN_INDEX.cost]: "cost",
  [COLUMN_INDEX.latency]: "latency",
  [COLUMN_INDEX.name]: "name",
  [COLUMN_INDEX.scores]: "scores",
  [COLUMN_INDEX.spans]: "spans",
  [COLUMN_INDEX.startedAt]: "startedAt",
  [COLUMN_INDEX.status]: "status",
  [COLUMN_INDEX.tokens]: "tokens",
};

/** Maps a `sort` query value such as `-cost` to the DataTable's column sort state. */
export const traceSortToSortColumn = (sort: string): ColumnSortInterface | undefined => {
  const descending = sort.startsWith("-");
  const key = descending ? sort.slice(1) : sort;
  const entry = Object.entries(TRACE_SORT_KEY_BY_COLUMN).find(([, value]) => value === key);
  if (!entry) {
    return undefined;
  }
  return {column: Number(entry[0]), direction: descending ? "desc" : "asc"};
};

/**
 * Maps a DataTable header press back to a `sort` value. The table cycles asc → desc → none;
 * "none" falls back to newest first, and pressing Started while already newest first flips
 * it to oldest first so that column can still toggle.
 */
export const sortColumnToTraceSort = (
  next: ColumnSortInterface | undefined,
  current: string
): string => {
  if (!next) {
    return current === DEFAULT_TRACE_SORT ? "startedAt" : DEFAULT_TRACE_SORT;
  }
  const key = TRACE_SORT_KEY_BY_COLUMN[next.column];
  if (!key) {
    return current;
  }
  return next.direction === "desc" ? `-${key}` : key;
};
