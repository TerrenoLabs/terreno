import type {SyncEntity} from "../storage/types";
import {compileSort, type SortSpec} from "./sort";
import {compileWhere, type WhereFilter} from "./where";

/** A comparator, or a `modelRouter`-style sort spec (`"-created"`, `{created: "descending"}`). */
export type QuerySort<TData> = SortSpec | ((a: TData, b: TData) => number);

export const resolveComparator = <TData>(
  sort: QuerySort<TData> | undefined
): ((a: TData, b: TData) => number) | undefined => {
  if (sort === undefined) {
    return undefined;
  }
  if (typeof sort === "function") {
    return sort;
  }
  return compileSort<TData>(sort);
};

export interface LocalQueryOptions<TData> {
  /** Mongo-style filter evaluated against decoded data. */
  where?: WhereFilter;
  /** Arbitrary predicate, applied after `where`. */
  filter?: (data: TData) => boolean;
  sort?: QuerySort<TData>;
  /** Keep only the first N results (after sort). */
  limit?: number;
}

/**
 * Filter/sort/limit entities that are already in the local store. Used by
 * `useQuery`/`useEntityIds` for fully-synced collections. A `where` that cannot be
 * evaluated locally (e.g. `$search`) throws — only server windows can run it.
 */
export const applyLocalQuery = <TData>(
  entities: SyncEntity<TData>[],
  {where, filter, sort, limit}: LocalQueryOptions<TData>
): SyncEntity<TData>[] => {
  let results = entities.filter((entity) => entity.data !== null);
  if (where) {
    const {match} = compileWhere(where);
    if (!match) {
      throw new Error(
        "useQuery `where` uses an operator syncdb cannot evaluate locally; use useWindowQuery"
      );
    }
    results = results.filter((entity) => match(entity.data));
  }
  if (filter) {
    results = results.filter((entity) => filter(entity.data));
  }
  const comparator = resolveComparator(sort);
  if (comparator) {
    results = [...results].sort((a, b) => comparator(a.data, b.data));
  }
  if (limit !== undefined && limit >= 0) {
    results = results.slice(0, limit);
  }
  return results;
};
