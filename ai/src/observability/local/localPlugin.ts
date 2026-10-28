import type {ModelPrice, ObservabilityPlugin} from "../types";
import {LocalDatasetStore} from "./datasetStore";
import {LocalEvaluatorStore} from "./evaluatorStore";
import {type BackgroundTaskRunner, LocalExperimentRunner} from "./experimentRunner";
import {registerObsDataset} from "./models/obsDataset";
import {registerObsDatasetItem} from "./models/obsDatasetItem";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsExperiment} from "./models/obsExperiment";
import {registerObsExperimentItem} from "./models/obsExperimentItem";
import {registerObsPrompt} from "./models/obsPrompt";
import {registerObsPromptLabel} from "./models/obsPromptLabel";
import {registerObsPromptVersion} from "./models/obsPromptVersion";
import {registerObsReviewItem} from "./models/obsReviewItem";
import {registerObsScore} from "./models/obsScore";
import {registerObsSpan} from "./models/obsSpan";
import {registerObsTrace} from "./models/obsTrace";
import {LocalPromptStore} from "./promptStore";
import {LocalScoreSink, LocalTraceSink, LocalTraceStore} from "./traceStore";

export interface LocalObservabilityPluginBundle {
  datasetStore: LocalDatasetStore;
  evaluatorStore: LocalEvaluatorStore;
  experimentRunner: LocalExperimentRunner;
  plugin: ObservabilityPlugin;
  promptStore: LocalPromptStore;
  traceStore: LocalTraceStore;
}

const registerLocalObservabilityModels = (): void => {
  registerObsPrompt();
  registerObsPromptVersion();
  registerObsPromptLabel();
  registerObsTrace();
  registerObsSpan();
  registerObsScore();
  registerObsEvaluator();
  registerObsReviewItem();
  registerObsDataset();
  registerObsDatasetItem();
  registerObsExperiment();
  registerObsExperimentItem();
};

export const createLocalObservabilityBundle = (
  options: {backgroundTaskRunner?: BackgroundTaskRunner; priceMap?: Record<string, ModelPrice>} = {}
): LocalObservabilityPluginBundle => {
  registerLocalObservabilityModels();
  const promptStore = new LocalPromptStore();
  const traces = new LocalTraceStore();
  const datasetStore = new LocalDatasetStore(promptStore);
  const evaluatorStore = new LocalEvaluatorStore(promptStore);
  const experimentRunner = new LocalExperimentRunner({
    backgroundTaskRunner: options.backgroundTaskRunner,
    datasetStore,
    evaluatorStore,
    promptStore,
  });
  return {
    datasetStore,
    evaluatorStore,
    experimentRunner,
    plugin: {
      capabilities: new Set([
        "datasets",
        "experiments",
        "prompts",
        "reviewQueue",
        "scores",
        "traces",
      ]),
      datasetStore,
      experimentRunner,
      id: "local",
      promptRegistry: promptStore,
      reviewQueue: {},
      scoreSink: new LocalScoreSink(traces),
      traceSink: new LocalTraceSink(traces),
    },
    promptStore,
    traceStore: traces,
  };
};

export const createLocalObservabilityPlugin = (
  options: {backgroundTaskRunner?: BackgroundTaskRunner; priceMap?: Record<string, ModelPrice>} = {}
): ObservabilityPlugin => {
  return createLocalObservabilityBundle(options).plugin;
};
