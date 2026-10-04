import type {AnyTerrenoAccess} from "@terreno/api";
import {type AdminContribution, logger, type TerrenoPlugin} from "@terreno/api";
import type express from "express";
import {observabilityAdminScreens} from "./adminScreens";
import {LocalDatasetStore} from "./local/datasetStore";
import {LocalEvaluatorStore} from "./local/evaluatorStore";
import {LocalExperimentRunner} from "./local/experimentRunner";
import {LocalPromptStore} from "./local/promptStore";
import {LocalReviewStore} from "./local/reviewStore";
import {LocalTraceSink} from "./local/traceStore";
import {
  getObservabilityApp,
  registerObservabilityApp,
  resetObservabilityApp,
} from "./observabilityAppRegistry";
import {addObservabilityDatasetRoutes} from "./routes/datasets";
import {addObservabilityEvaluatorRoutes} from "./routes/evaluators";
import {addObservabilityExperimentRoutes} from "./routes/experiments";
import {addObservabilityPromptRoutes} from "./routes/prompts";
import {addObservabilityReviewRoutes} from "./routes/review";
import {addObservabilityStatusRoutes} from "./routes/status";
import {addObservabilityTestMultiStageRoutes} from "./routes/testMultiStage";
import {addObservabilityTraceRoutes} from "./routes/traces";
import {isLocalObservabilityPluginOn} from "./status";
import type {
  ObservabilityAiServiceFactory,
  ObservabilityAppOptions,
  ObservabilityControlConfig,
  ObservabilityGenerateClient,
  ObservabilityPlugin,
  ObservabilityRequestAiServiceFactory,
  PromptRegistry,
  ScoreSink,
  TraceRecord,
  TraceSink,
} from "./types";
import {validateObservabilityConfig} from "./types";

export {getObservabilityApp, resetObservabilityApp};

export class ObservabilityApp implements TerrenoPlugin {
  readonly accessControl?: AnyTerrenoAccess;
  readonly aiService?: ObservabilityGenerateClient;
  readonly aiServiceFactory?: ObservabilityAiServiceFactory;
  readonly control: ObservabilityControlConfig;
  readonly plugins: ReadonlyArray<ObservabilityPlugin>;
  readonly priceMap: ObservabilityAppOptions["priceMap"];
  readonly requestAiServiceFactory?: ObservabilityRequestAiServiceFactory;
  readonly sampleRate: number;

  constructor(options: ObservabilityAppOptions) {
    this.accessControl = options.accessControl;
    this.aiService = options.aiService;
    this.aiServiceFactory = options.aiServiceFactory;
    this.control = validateObservabilityConfig(options);
    this.plugins = options.plugins;
    this.priceMap = options.priceMap;
    this.requestAiServiceFactory = options.requestAiServiceFactory;
    this.sampleRate = options.sampleRate ?? 0;
    registerObservabilityApp(this);
  }

  get promptRegistry(): PromptRegistry | undefined {
    const primary = this.control.prompts;
    return this.plugins.find((plugin) => {
      return plugin.id === primary;
    })?.promptRegistry;
  }

  get scoreSinks(): ScoreSink[] {
    return this.plugins.flatMap((plugin) => {
      return plugin.scoreSink ? [plugin.scoreSink] : [];
    });
  }

  get traceSinks(): TraceSink[] {
    return this.plugins.flatMap((plugin) => {
      return plugin.traceSink ? [plugin.traceSink] : [];
    });
  }

  async exportTrace(trace: TraceRecord): Promise<string | undefined> {
    const results = await Promise.allSettled(
      this.traceSinks.map((sink) => {
        return sink.export(trace);
      })
    );
    let persistedId: string | undefined;
    for (const result of results) {
      if (result.status === "rejected") {
        logger.error("Observability TraceSink.export failed", {error: result.reason});
        continue;
      }
      if (!persistedId && result.value?.id) {
        persistedId = result.value.id;
      }
    }
    return persistedId;
  }

  adminContribution(): AdminContribution {
    return {
      customScreens: observabilityAdminScreens({
        localOn: isLocalObservabilityPluginOn(this.plugins),
      }),
    };
  }

  private configureLocalExperimentRunner(
    localPlugin: ObservabilityPlugin
  ): LocalExperimentRunner | undefined {
    const runner = localPlugin.experimentRunner;
    if (!(runner instanceof LocalExperimentRunner)) {
      return undefined;
    }
    if (this.aiService) {
      runner.configureAi({
        aiService: this.aiService,
        aiServiceFactory: this.aiServiceFactory,
        priceMap: this.priceMap,
      });
    }
    return runner;
  }

  register(app: express.Application, openApi?: unknown): void {
    const routeAccess = {accessControl: this.accessControl, openApi};
    addObservabilityStatusRoutes(app, routeAccess);
    if (this.control.prompts === "local") {
      const store = this.promptRegistry;
      if (store instanceof LocalPromptStore) {
        addObservabilityPromptRoutes(app, {
          ...routeAccess,
          aiService: this.aiService,
          priceMap: this.priceMap,
          requestAiServiceFactory: this.requestAiServiceFactory,
          store,
        });
      }
    }
    const localPlugin = this.plugins.find((plugin) => {
      return plugin.id === "local";
    });
    const promptStore =
      this.promptRegistry instanceof LocalPromptStore ? this.promptRegistry : undefined;
    if (localPlugin) {
      const evaluatorStore = new LocalEvaluatorStore(promptStore ?? new LocalPromptStore());
      addObservabilityEvaluatorRoutes(app, {
        ...routeAccess,
        store: evaluatorStore,
      });
      addObservabilityReviewRoutes(app, {
        ...routeAccess,
        store: new LocalReviewStore(),
      });
      if (localPlugin.datasetStore instanceof LocalDatasetStore) {
        addObservabilityDatasetRoutes(app, {
          ...routeAccess,
          store: localPlugin.datasetStore,
        });
      }
      const experimentRunner = this.configureLocalExperimentRunner(localPlugin);
      if (experimentRunner) {
        addObservabilityExperimentRoutes(app, {
          ...routeAccess,
          runner: experimentRunner,
        });
      }
    }
    if (localPlugin?.traceSink instanceof LocalTraceSink) {
      addObservabilityTraceRoutes(app, {
        ...routeAccess,
        store: localPlugin.traceSink.store,
      });
      addObservabilityTestMultiStageRoutes(app, {
        ...routeAccess,
        aiService: this.aiService,
        exportTrace: (trace) => {
          return this.exportTrace(trace);
        },
        requestAiServiceFactory: this.requestAiServiceFactory,
      });
    }
  }
}
