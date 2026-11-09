import type {
  ObservabilityAppOptions,
  ObservabilityControlConfig,
  ObservabilityGenerateClient,
  ObservabilityPlugin,
  ObservabilityRequestAiServiceFactory,
  PromptRegistry,
  ScoreSink,
  TraceSink,
} from "./types";

export interface RegisteredObservabilityApp {
  aiService?: ObservabilityGenerateClient;
  control: ObservabilityControlConfig;
  plugins: ReadonlyArray<ObservabilityPlugin>;
  priceMap?: ObservabilityAppOptions["priceMap"];
  promptRegistry?: PromptRegistry;
  requestAiServiceFactory?: ObservabilityRequestAiServiceFactory;
  scoreSinks: ScoreSink[];
  traceSinks: TraceSink[];
}

let registeredObservabilityApp: RegisteredObservabilityApp | undefined;

export const registerObservabilityApp = (app: RegisteredObservabilityApp): void => {
  registeredObservabilityApp = app;
};

export const getObservabilityApp = (): RegisteredObservabilityApp | undefined => {
  return registeredObservabilityApp;
};

export const resetObservabilityApp = (): void => {
  registeredObservabilityApp = undefined;
};
