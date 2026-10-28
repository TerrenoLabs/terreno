/**
 * Typed per-collection hook factory used by generated SDKs and hand-written
 * custom hooks. Mirrors RTK Query's `injectEndpoints` pattern: generated code
 * and app code both call this factory; the generated file only renames the
 * returned hooks to friendly collection-specific names.
 */

import {useCallback, useMemo} from "react";

import {retriesToMaxAttempts} from "../maxAttempts";
import type {
  UseEntityResult,
  UseQueryOptions,
  UseWindowQueryOptions,
  UseWindowQueryResult,
} from "./hooks";
import {useEntity, useMutate, useQuery, useWindowQuery} from "./hooks";

export interface CollectionHooksConfig {
  collection: string;
  /**
   * `false` → 1 attempt (fail fast); a number → that many error-nack attempts;
   * omitted → engine default (`MAX_ERROR_NACK_ATTEMPTS`).
   */
  retries?: boolean | number;
}

export type MutationTrigger<TArgs> = (args: TArgs) => {mutationId: string; id: string};

export interface CollectionHooks<TData, TCreate, TUpdate> {
  /** List query (RTK: useGet{Path}Query). */
  useListQuery: (options?: UseQueryOptions<TData>) => {data: TData[]};
  /**
   * Server-filtered list for `queryCollections` (RTK: useGet{Path}Query with
   * filter/sort/limit/page args). Overlapping windows share entity rows.
   */
  useWindowQuery: (options?: UseWindowQueryOptions) => UseWindowQueryResult<TData>;
  /** Single-entity read (RTK: useGet{Path}ByIdQuery). */
  useReadQuery: (id: string) => UseEntityResult<TData>;
  /** Create (RTK: usePost{Path}Mutation). Optional `id` pins the client-minted entity id. */
  useCreateMutation: () => [MutationTrigger<{data: TCreate; id?: string}>];
  /** Update via merge — patch semantics (RTK: usePatch{Path}ByIdMutation). */
  useUpdateMutation: () => [MutationTrigger<{id: string; data: TUpdate}>];
  /** Soft delete (RTK: useDelete{Path}ByIdMutation). */
  useDeleteMutation: () => [MutationTrigger<{id: string}>];
}

export const createCollectionHooks = <
  TData = Record<string, unknown>,
  TCreate = Record<string, unknown>,
  TUpdate = Partial<TCreate>,
>(
  config: CollectionHooksConfig
): CollectionHooks<TData, TCreate, TUpdate> => {
  const maxAttempts = retriesToMaxAttempts(config.retries);

  const useListQuery = (options?: UseQueryOptions<TData>): {data: TData[]} => {
    const data = useQuery<TData>(config.collection, options);
    return {data};
  };

  const useCollectionWindowQuery = (options?: UseWindowQueryOptions): UseWindowQueryResult<TData> =>
    useWindowQuery<TData>(config.collection, options);

  const useReadQuery = (id: string): UseEntityResult<TData> =>
    useEntity<TData>(config.collection, id);

  const useCreateMutation = (): [MutationTrigger<{data: TCreate; id?: string}>] => {
    const {create} = useMutate(config.collection);
    const trigger = useCallback(
      (args: {data: TCreate; id?: string}): {mutationId: string; id: string} =>
        create({
          data: args.data as unknown as Record<string, unknown>,
          ...(args.id !== undefined ? {id: args.id} : {}),
          ...(maxAttempts !== undefined ? {maxAttempts} : {}),
        }),
      [create]
    );
    return useMemo(() => [trigger], [trigger]);
  };

  const useUpdateMutation = (): [MutationTrigger<{id: string; data: TUpdate}>] => {
    const {update} = useMutate(config.collection);
    const trigger = useCallback(
      (args: {id: string; data: TUpdate}): {mutationId: string; id: string} =>
        update({
          data: args.data as unknown as Record<string, unknown>,
          id: args.id,
          ...(maxAttempts !== undefined ? {maxAttempts} : {}),
        }),
      [update]
    );
    return useMemo(() => [trigger], [trigger]);
  };

  const useDeleteMutation = (): [MutationTrigger<{id: string}>] => {
    const {remove} = useMutate(config.collection);
    const trigger = useCallback(
      (args: {id: string}): {mutationId: string; id: string} =>
        remove({
          id: args.id,
          ...(maxAttempts !== undefined ? {maxAttempts} : {}),
        }),
      [remove]
    );
    return useMemo(() => [trigger], [trigger]);
  };

  return {
    useCreateMutation,
    useDeleteMutation,
    useListQuery,
    useReadQuery,
    useUpdateMutation,
    useWindowQuery: useCollectionWindowQuery,
  };
};
