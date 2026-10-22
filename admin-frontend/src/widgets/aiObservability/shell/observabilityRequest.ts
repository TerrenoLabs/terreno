import {useCallback, useRef, useState} from "react";
import type {AdminRequestArgs} from "../../../adminRequest";
import {
  type AdminRpcQueryState,
  unwrapAdminEnvelope,
  useAdminRpc,
  useAdminRpcMutation,
  useAdminRpcQuery,
} from "../../../useAdminRpc";

/** Plugin status route read by the status chip and every observability screen. */
export const OBSERVABILITY_STATUS_URL = "/ai/observability/status";

/** Query options shared by the AI observability hooks. */
export interface ObservabilityQueryOptions {
  skip?: boolean;
}

/** Mutation state: the last result, the last error, and in-flight state. */
export interface ObservabilityMutationState<Result> {
  data?: Result;
  error?: unknown;
  isError: boolean;
  isLoading: boolean;
}

export type ObservabilityMutation<Arg, Result> = [
  (arg: Arg) => {unwrap: () => Promise<Result>},
  ObservabilityMutationState<Result>,
];

/**
 * GET an observability route through the host-bound admin client. Single-document
 * `{data}` envelopes unwrap to the document (list envelopes stay whole).
 */
export const useObservabilityQuery = <T>({
  providesTags,
  skip,
  url,
}: {
  providesTags?: readonly string[];
  skip?: boolean;
  url: string;
}): AdminRpcQueryState<T> => {
  const rpc = useAdminRpc();
  return useAdminRpcQuery<T>({
    providesTags,
    rpc,
    skip,
    transformResponse: unwrapAdminEnvelope,
    url,
  });
};

/**
 * Write to an observability route. The request starts when the trigger is called
 * (not on mount); `unwrap()` resolves to the response or rejects
 * with the request error, and the hook state tracks the last outcome.
 */
export const useObservabilityMutation = <Arg, Result>({
  invalidatesTags,
  toRequest,
}: {
  invalidatesTags?: readonly string[];
  toRequest: (arg: Arg) => AdminRequestArgs;
}): ObservabilityMutation<Arg, Result> => {
  const rpc = useAdminRpc();
  const [trigger, {isLoading}] = useAdminRpcMutation(rpc, {
    invalidatesTags,
    transformResponse: unwrapAdminEnvelope,
  });
  const [outcome, setOutcome] = useState<{data?: Result; error?: unknown; isError: boolean}>({
    isError: false,
  });
  // Callers pass an inline `toRequest`; reading it from a ref keeps the trigger stable so
  // screens can list it as an effect dependency without re-sending the request each render.
  const toRequestRef = useRef(toRequest);
  toRequestRef.current = toRequest;

  const run = useCallback(
    (arg: Arg): {unwrap: () => Promise<Result>} => {
      const promise = trigger(toRequestRef.current(arg))
        .unwrap()
        .then((result) => {
          setOutcome({data: result as Result, isError: false});
          return result as Result;
        })
        .catch((error: unknown) => {
          setOutcome({error, isError: true});
          throw error;
        });
      // Callers that ignore the result must not surface an unhandled rejection.
      promise.catch(() => undefined);
      return {unwrap: (): Promise<Result> => promise};
    },
    [trigger]
  );

  return [
    run,
    {
      data: outcome.data,
      error: outcome.error,
      isError: outcome.isError,
      isLoading,
    },
  ];
};
