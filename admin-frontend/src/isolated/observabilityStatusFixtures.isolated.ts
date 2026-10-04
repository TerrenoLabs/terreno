import type {ObservabilityStatusPayload} from "../widgets/aiObservability/shell/aiObservabilityNav";

const observabilityPrimaries = {
  datasets: "local",
  experiments: "local",
  prompts: "local",
  reviewQueue: "local",
};

const grantAll = (actions: readonly string[]): Record<string, boolean> => {
  return Object.fromEntries(actions.map((action) => [action, true]));
};

const operatorObservabilityPermissions = (): NonNullable<
  ObservabilityStatusPayload["permissions"]
> => ({
  aiDataset: grantAll(["create", "delete", "list", "read", "update"]),
  aiEvaluator: grantAll(["create", "delete", "list", "read", "update"]),
  aiExperiment: grantAll(["create", "list", "promote", "read"]),
  aiPrompt: grantAll(["create", "list", "playground", "promote", "read", "update"]),
  aiReview: grantAll(["assign", "list", "read", "score"]),
  aiTrace: grantAll(["list", "read"]),
});

export const readOnlyPromptObservabilityStatus = (
  overrides: Partial<ObservabilityStatusPayload> = {}
): ObservabilityStatusPayload => ({
  localOn: true,
  permissions: {
    ...operatorObservabilityPermissions(),
    aiPrompt: grantAll(["list", "read"]),
  },
  plugins: [],
  primaries: observabilityPrimaries,
  ...overrides,
});

export const operatorObservabilityStatus = (
  overrides: Partial<ObservabilityStatusPayload> = {}
): ObservabilityStatusPayload => ({
  localOn: true,
  permissions: operatorObservabilityPermissions(),
  plugins: [],
  primaries: observabilityPrimaries,
  ...overrides,
});
