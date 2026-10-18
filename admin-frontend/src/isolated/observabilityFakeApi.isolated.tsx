/**
 * Screen-test double for the AI observability data hooks.
 *
 * Screen tests describe server state as a bag of RTK-style hook functions
 * (`useAiObservabilityDatasetsQuery`, `useCreateAiObservabilityPromptMutation`, …)
 * returned from `injectEndpoints()`. {@link installFakeObservabilityHooks} replaces
 * the hook modules so each screen reads that bag from the nearest
 * {@link withFakeObservabilityApi} wrapper instead of calling the network.
 *
 * Only isolated test files call `installFakeObservabilityHooks`, because
 * `mock.module` leaks across files that share a Bun process.
 */
import {mock} from "bun:test";
import React, {createContext, useContext} from "react";

type HookBag = Record<string, unknown>;

/** Screen-test stand-in for server state: `injectEndpoints()` returns the hook bag. */
export interface FakeObservabilityApi {
  enhanceEndpoints?: (...args: unknown[]) => unknown;
  injectEndpoints: (...args: unknown[]) => HookBag;
}

const FakeObservabilityApiContext = createContext<FakeObservabilityApi | null>(null);

const bagCache = new WeakMap<FakeObservabilityApi, HookBag>();

const readBag = (api: FakeObservabilityApi | null): HookBag => {
  if (!api) {
    return {};
  }
  const cached = bagCache.get(api);
  if (cached) {
    return cached;
  }
  const bag = api.injectEndpoints({endpoints: () => ({}), overrideExisting: true});
  bagCache.set(api, bag);
  return bag;
};

const emptyQuery = (): Record<string, unknown> => ({
  data: undefined,
  error: null,
  isError: false,
  isFetching: false,
  isLoading: false,
  refetch: async (): Promise<{isError: boolean}> => ({isError: false}),
});

const emptyMutation = (): unknown[] => [
  (): {unwrap: () => Promise<unknown>} => ({unwrap: async (): Promise<unknown> => ({})}),
  {isError: false, isLoading: false},
];

const useFakeBag = (): HookBag => readBag(useContext(FakeObservabilityApiContext));

/** Maps each module's hook names to the RTK hook names screen tests provide. */
const adaptBag = (names: Record<string, string>): (() => HookBag) => {
  return (): HookBag => {
    const bag = useFakeBag();
    const adapted: HookBag = {};
    for (const [hookName, rtkName] of Object.entries(names)) {
      const fallback = hookName.endsWith("Mutation") ? emptyMutation : emptyQuery;
      adapted[hookName] = bag[rtkName] ?? fallback;
    }
    return adapted;
  };
};

const STATUS_HOOK = "useAiObservabilityStatusQuery";

/** Swap the observability hook modules for the context-driven double. */
export const installFakeObservabilityHooks = (): void => {
  mock.module("../widgets/aiObservability/datasets/useAiObservabilityDatasetsApi", () => ({
    useAiObservabilityDatasetsApi: adaptBag({
      useAddTracesMutation: "useAddTracesToAiObservabilityDatasetMutation",
      useCreateItemMutation: "useCreateAiObservabilityDatasetItemMutation",
      useCreateMutation: "useCreateAiObservabilityDatasetMutation",
      useDetailQuery: "useAiObservabilityDatasetQuery",
      useImportMutation: "useImportAiObservabilityDatasetMutation",
      useItemsQuery: "useAiObservabilityDatasetItemsQuery",
      useListQuery: "useAiObservabilityDatasetsQuery",
    }),
  }));
  mock.module("../widgets/aiObservability/evaluators/useAiObservabilityEvaluatorsApi", () => ({
    useAiObservabilityEvaluatorsApi: adaptBag({
      useCreateMutation: "useCreateAiObservabilityEvaluatorMutation",
      useDetailQuery: "useAiObservabilityEvaluatorQuery",
      useListQuery: "useAiObservabilityEvaluatorsQuery",
    }),
  }));
  mock.module("../widgets/aiObservability/experiments/useAiObservabilityExperimentsApi", () => ({
    useAiObservabilityExperimentsApi: adaptBag({
      useCreateMutation: "useCreateAiObservabilityExperimentMutation",
      useDetailQuery: "useAiObservabilityExperimentQuery",
      useEstimateMutation: "useEstimateAiObservabilityExperimentMutation",
      useListQuery: "useAiObservabilityExperimentsQuery",
      usePromoteMutation: "usePromoteAiObservabilityExperimentMutation",
    }),
  }));
  mock.module("../widgets/aiObservability/prompts/useAiObservabilityPromptsApi", () => ({
    useAiObservabilityPromptsApi: adaptBag({
      useCreateMutation: "useCreateAiObservabilityPromptMutation",
      useCreateVersionMutation: "useCreateAiObservabilityPromptVersionMutation",
      useDetailQuery: "useAiObservabilityPromptQuery",
      useListQuery: "useAiObservabilityPromptsQuery",
      usePlaygroundMutation: "useRunAiObservabilityPlaygroundMutation",
      useSetLabelMutation: "useMoveAiObservabilityPromptLabelMutation",
      useStatusQuery: STATUS_HOOK,
    }),
  }));
  mock.module("../widgets/aiObservability/review/useAiObservabilityReviewApi", () => ({
    useAiObservabilityReviewApi: adaptBag({
      useActionMutation: "useUpdateAiObservabilityReviewItemMutation",
      useCurrentUserQuery: "useAiObservabilityCurrentUserQuery",
      useDetailQuery: "useAiObservabilityReviewItemQuery",
      useListQuery: "useAiObservabilityReviewQuery",
      useStatusQuery: STATUS_HOOK,
    }),
  }));
  mock.module("../widgets/aiObservability/traces/useAiObservabilityTracesApi", () => ({
    useAiObservabilityTracesApi: adaptBag({
      useDetailQuery: "useAiObservabilityTraceQuery",
      useEnqueueReviewMutation: "useEnqueueAiObservabilityReviewMutation",
      useEvaluatorsQuery: "useAiObservabilityEvaluatorsQuery",
      useListQuery: "useAiObservabilityTracesQuery",
      useStatusQuery: STATUS_HOOK,
      useTestMultiStageMutation: "useRunAiObservabilityTestMultiStageMutation",
    }),
  }));
  // The status chip reads `/ai/observability/status` itself when a screen passes no status.
  mock.module("../widgets/aiObservability/shell/observabilityRequest", () => ({
    OBSERVABILITY_STATUS_URL: "/ai/observability/status",
    useObservabilityMutation: emptyMutation,
    useObservabilityQuery: (): unknown => {
      const bag = useFakeBag();
      const statusHook = bag[STATUS_HOOK] as (() => unknown) | undefined;
      return statusHook ? statusHook() : emptyQuery();
    },
  }));
};

/** Wrap a widget so tests can keep passing the fake server state as an `api` prop. */
export const withFakeObservabilityApi = <P extends object>(
  Widget: React.ComponentType<P>
): React.FC<P & {api?: FakeObservabilityApi}> => {
  const Wrapped: React.FC<P & {api?: FakeObservabilityApi}> = ({api, ...props}) => {
    return (
      <FakeObservabilityApiContext.Provider value={api ?? null}>
        <Widget {...(props as P)} />
      </FakeObservabilityApiContext.Provider>
    );
  };
  return Wrapped;
};
