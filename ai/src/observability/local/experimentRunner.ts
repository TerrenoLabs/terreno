import {APIError, BackgroundTask} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {
  ExperimentAggregates,
  ExperimentEstimate,
  ExperimentGateResult,
  ExperimentVersionResult,
  ObsExperimentDocument,
  ScoreThreshold,
} from "../../types/observability";
import {compileTemplate} from "../compileTemplate";
import {runEvaluator} from "../evaluate";
import {SOP_DEFAULT_THRESHOLDS} from "../sopThresholds";
import type {
  ModelPrice,
  ObservabilityAiServiceFactory,
  ObservabilityGenerateClient,
} from "../types";
import type {LocalDatasetStore} from "./datasetStore";
import type {LocalEvaluatorStore} from "./evaluatorStore";
import {registerObsExperiment} from "./models/obsExperiment";
import {registerObsExperimentItem} from "./models/obsExperimentItem";
import type {LocalPromptStore} from "./promptStore";

export interface ExperimentCreateInput {
  datasetId: string;
  evaluatorIds: string[];
  includeUnproofread?: boolean;
  modelOverride?: string;
  name: string;
  promptName: string;
  thresholds?: ScoreThreshold[];
  versions: number[];
}

export interface ExperimentView {
  backgroundTaskId?: string;
  created: string;
  datasetId: string;
  estimate?: ExperimentEstimate;
  evaluatorIds: string[];
  id: string;
  includeUnproofread: boolean;
  items: ExperimentItemView[];
  modelOverride?: string;
  name: string;
  promptName: string;
  results?: ExperimentAggregates;
  status: "completed" | "failed" | "pending" | "running";
  thresholds: ScoreThreshold[];
  updated: string;
  versions: number[];
}

export interface ExperimentItemView {
  datasetItemId: string;
  failed: boolean;
  id: string;
  versionResults: Record<string, ExperimentVersionResult>;
}

export const EXPERIMENT_LIST_DEFAULT_LIMIT = 50;
const EXPERIMENT_LIST_MAX_LIMIT = 100;

export interface ExperimentListResult {
  data: ExperimentView[];
  meta: {limit: number; page: number; total: number};
}

export interface BackgroundTaskRunner {
  enqueue: (params: {execute: () => Promise<void>; taskType: string}) => Promise<{taskId: string}>;
}

export interface ExperimentAiDependencies {
  aiService: ObservabilityGenerateClient;
  aiServiceFactory?: ObservabilityAiServiceFactory;
  priceMap?: Record<string, ModelPrice>;
}

const defaultBackgroundTaskRunner: BackgroundTaskRunner = {
  enqueue: async ({execute, taskType}) => {
    const task = await BackgroundTask.create({
      status: "pending",
      taskType,
    });
    const taskId = String(task._id);
    setImmediate(async () => {
      task.status = "running";
      task.startedAt = DateTime.now().toJSDate();
      await task.save();
      try {
        await execute();
        task.status = "completed";
        task.completedAt = DateTime.now().toJSDate();
      } catch (error) {
        task.status = "failed";
        task.error = error instanceof Error ? error.message : "experiment failed";
        task.completedAt = DateTime.now().toJSDate();
      }
      await task.save();
    });
    return {taskId};
  },
};

const compareGate = (actual: number, op: ScoreThreshold["op"], expected: number): boolean => {
  if (op === "eq") {
    return actual === expected;
  }
  if (op === "gte") {
    return actual >= expected;
  }
  return actual <= expected;
};

const computeGateValue = (
  values: Array<boolean | number | undefined>,
  aggregate: ScoreThreshold["aggregate"]
): number | undefined => {
  const filtered = values.filter((value) => {
    return value !== undefined;
  }) as Array<boolean | number>;
  if (filtered.length === 0) {
    return undefined;
  }
  if (aggregate === "trueRate") {
    const trueCount = filtered.filter((value) => {
      return value === true || value === 1;
    }).length;
    return trueCount / filtered.length;
  }
  const numeric = filtered.map((value) => {
    return Number(value);
  });
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
};

const parseGenerationOutput = (output: string): unknown => {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
};

const gateBucketKey = (version: number, threshold: ScoreThreshold): string => {
  return `${version}:${threshold.evaluatorName}:${threshold.dimension}:${threshold.aggregate}`;
};

export class LocalExperimentRunner {
  private aiDeps?: ExperimentAiDependencies;

  constructor(
    private readonly deps: {
      backgroundTaskRunner?: BackgroundTaskRunner;
      datasetStore: LocalDatasetStore;
      evaluatorStore: LocalEvaluatorStore;
      promptStore: LocalPromptStore;
    }
  ) {}

  configureAi(aiDeps: ExperimentAiDependencies): void {
    this.aiDeps = aiDeps;
  }

  private requireAiDeps(): ExperimentAiDependencies {
    if (!this.aiDeps?.aiService) {
      throw new APIError({status: 400, title: "experiments require an AI service"});
    }
    return this.aiDeps;
  }

  private resolveAiClient(modelOverride?: string): ObservabilityGenerateClient {
    const aiDeps = this.requireAiDeps();
    if (!modelOverride) {
      return aiDeps.aiService;
    }
    if (!aiDeps.aiServiceFactory) {
      throw new APIError({
        status: 400,
        title: `modelOverride "${modelOverride}" requires aiServiceFactory on ObservabilityApp`,
      });
    }
    const client = aiDeps.aiServiceFactory(modelOverride);
    if (!client) {
      throw new APIError({
        status: 400,
        title: `Unsupported modelOverride "${modelOverride}"`,
      });
    }
    return client;
  }

  async estimate(input: {
    datasetId: string;
    evaluatorIds: string[];
    includeUnproofread?: boolean;
    modelOverride?: string;
    versions: number[];
  }): Promise<ExperimentEstimate> {
    const items = await this.deps.datasetStore.listExperimentItems(
      input.datasetId,
      input.includeUnproofread ?? false
    );
    const generations = items.length * input.versions.length;
    const evaluatorCount = input.evaluatorIds.length;
    const secondsPerGeneration = 2;
    const judgeSeconds = generations * evaluatorCount * 0.5;
    const modelId =
      (input.modelOverride
        ? this.resolveAiClient(input.modelOverride).modelId
        : this.aiDeps?.aiService.modelId) ?? "unknown";
    const price = this.aiDeps?.priceMap?.[modelId];
    const tokensPerGeneration = 1000;
    const costUsd =
      price && generations > 0
        ? (price.inputPerMTok * tokensPerGeneration * generations) / 1_000_000
        : undefined;
    return {
      costUsd,
      generations,
      wallClockSeconds: generations * secondsPerGeneration + judgeSeconds,
    };
  }

  private async assertAutomaticEvaluators(evaluatorIds: string[]): Promise<void> {
    for (const id of evaluatorIds) {
      const evaluator = await this.deps.evaluatorStore.get(id);
      if (evaluator.type !== "llm-judge" && evaluator.type !== "json-assert") {
        throw new APIError({
          status: 400,
          title: "Experiments only accept llm-judge and json-assert evaluators",
        });
      }
    }
  }

  async create(input: ExperimentCreateInput): Promise<ExperimentView> {
    if (input.versions.length < 2 || input.versions.length > 3) {
      throw new APIError({status: 400, title: "experiments must compare 2–3 prompt versions"});
    }
    await this.assertAutomaticEvaluators(input.evaluatorIds);
    this.resolveAiClient(input.modelOverride);
    await this.deps.datasetStore.get(input.datasetId);
    const estimate = await this.estimate({
      datasetId: input.datasetId,
      evaluatorIds: input.evaluatorIds,
      includeUnproofread: input.includeUnproofread,
      modelOverride: input.modelOverride,
      versions: input.versions,
    });
    const experiment = await registerObsExperiment().create({
      datasetId: new mongoose.Types.ObjectId(input.datasetId),
      estimate,
      evaluatorIds: input.evaluatorIds.map((id) => {
        return new mongoose.Types.ObjectId(id);
      }),
      includeUnproofread: input.includeUnproofread ?? false,
      modelOverride: input.modelOverride,
      name: input.name,
      promptName: input.promptName,
      status: "pending",
      thresholds: input.thresholds ?? SOP_DEFAULT_THRESHOLDS,
      versions: input.versions,
    });
    const runner = this.deps.backgroundTaskRunner ?? defaultBackgroundTaskRunner;
    const {taskId} = await runner.enqueue({
      execute: async () => {
        await this.executeExperiment(String(experiment._id));
      },
      taskType: `obs-experiment-${String(experiment._id)}`,
    });
    experiment.backgroundTaskId = new mongoose.Types.ObjectId(taskId);
    experiment.status = "running";
    await experiment.save();
    return this.get(String(experiment._id));
  }

  async list(params?: {
    limit?: number;
    page?: number;
    promptName?: string;
  }): Promise<ExperimentListResult> {
    const page = params?.page && params.page > 0 ? params.page : 1;
    const limit =
      params?.limit && params.limit > 0
        ? Math.min(params.limit, EXPERIMENT_LIST_MAX_LIMIT)
        : EXPERIMENT_LIST_DEFAULT_LIMIT;
    const filter: Record<string, unknown> = {};
    if (params?.promptName) {
      filter.promptName = params.promptName;
    }
    const ObsExperiment = registerObsExperiment();
    const total = await ObsExperiment.countDocuments(filter);
    const rows = await ObsExperiment.find(filter)
      .sort({created: -1})
      .skip((page - 1) * limit)
      .limit(limit);
    return {
      data: rows.map((row) => {
        return this.toSummaryView(row);
      }),
      meta: {limit, page, total},
    };
  }

  async get(id: string): Promise<ExperimentView> {
    const experiment = await registerObsExperiment().findOneOrNone({_id: id});
    if (!experiment) {
      throw new APIError({status: 404, title: `Unknown experiment "${id}"`});
    }
    const items = await registerObsExperimentItem().find({experimentId: experiment._id});
    const sortedItems = items.sort((left, right) => {
      if (left.failed !== right.failed) {
        return left.failed ? -1 : 1;
      }
      return left.created.getTime() - right.created.getTime();
    });
    return {
      ...this.toSummaryView(experiment),
      items: sortedItems.map((row) => {
        return {
          datasetItemId: String(row.datasetItemId),
          failed: row.failed,
          id: String(row._id),
          versionResults: row.versionResults,
        };
      }),
    };
  }

  private toSummaryView(experiment: ObsExperimentDocument): ExperimentView {
    return {
      backgroundTaskId: experiment.backgroundTaskId
        ? String(experiment.backgroundTaskId)
        : undefined,
      created: DateTime.fromJSDate(experiment.created).toUTC().toISO() ?? "",
      datasetId: String(experiment.datasetId),
      estimate: experiment.estimate,
      evaluatorIds: experiment.evaluatorIds.map((value) => String(value)),
      id: String(experiment._id),
      includeUnproofread: experiment.includeUnproofread,
      items: [],
      modelOverride: experiment.modelOverride,
      name: experiment.name,
      promptName: experiment.promptName,
      results: experiment.results,
      status: experiment.status,
      thresholds: experiment.thresholds,
      updated: DateTime.fromJSDate(experiment.updated).toUTC().toISO() ?? "",
      versions: experiment.versions,
    };
  }

  async promote(id: string, version: number): Promise<{label: string; outgoingVersion?: number}> {
    const experiment = await this.get(id);
    if (!experiment.results) {
      throw new APIError({status: 409, title: "Experiment has not finished running"});
    }
    if (!experiment.versions.includes(version)) {
      throw new APIError({
        status: 400,
        title: `Version ${version} was not part of experiment ${id}`,
      });
    }
    const failingGate = experiment.results.gates.find((gate) => {
      return gate.version === version && !gate.passed;
    });
    if (failingGate) {
      throw new APIError({
        status: 409,
        title: `Promote blocked: gate failed for v${version} ${failingGate.evaluatorName}.${failingGate.dimension}`,
      });
    }
    return this.deps.promptStore.moveLabel(experiment.promptName, {
      label: "production",
      version,
    });
  }

  async executeExperiment(id: string): Promise<void> {
    const experiment = await registerObsExperiment().findOneOrNone({_id: id});
    if (!experiment) {
      throw new APIError({status: 404, title: `Unknown experiment "${id}"`});
    }
    const aiService = this.resolveAiClient(experiment.modelOverride);
    const datasetItems = await this.deps.datasetStore.listExperimentItems(
      String(experiment.datasetId),
      experiment.includeUnproofread
    );
    const evaluators = await Promise.all(
      experiment.evaluatorIds.map((evaluatorId) => {
        return this.deps.evaluatorStore.get(String(evaluatorId));
      })
    );
    const evaluatorById = new Map(
      evaluators.map((evaluator) => {
        return [evaluator.id, evaluator];
      })
    );
    const judgeSchemas = new Map<string, Record<string, unknown> | undefined>();
    for (const evaluator of evaluators) {
      if (evaluator.type === "llm-judge" && evaluator.judgePromptName) {
        const version = await this.deps.promptStore.getVersionByLabel(evaluator.judgePromptName);
        judgeSchemas.set(evaluator.id, version?.outputSchema);
      }
    }

    let completed = 0;
    const gateBuckets = new Map<string, Array<boolean | number | undefined>>();
    const lowConfidenceItemIds: string[] = [];
    const outlierItemIds: string[] = [];

    for (const datasetItem of datasetItems) {
      const versionResults: Record<string, ExperimentVersionResult> = {};
      let rowFailed = false;

      for (const versionNumber of experiment.versions) {
        const promptVersion = await this.deps.promptStore.getVersionByNumber(
          experiment.promptName,
          versionNumber
        );
        if (!promptVersion) {
          throw new APIError({
            status: 404,
            title: `Unknown version ${versionNumber} for prompt "${experiment.promptName}"`,
          });
        }
        const variables =
          promptVersion.variables.length > 0 &&
          datasetItem.input &&
          typeof datasetItem.input === "object" &&
          !Array.isArray(datasetItem.input)
            ? (datasetItem.input as Record<string, string>)
            : {input: JSON.stringify(datasetItem.input)};
        const compiled = compileTemplate(promptVersion.template ?? "", variables);
        const outputText = await aiService.generateText({
          prompt: compiled,
          skipTrace: true,
          systemPrompt: promptVersion.system,
        });
        const parsedOutput = parseGenerationOutput(outputText);
        const evaluatorScores: ExperimentVersionResult["evaluatorScores"] = {};
        for (const evaluatorId of experiment.evaluatorIds) {
          const evaluator = evaluatorById.get(String(evaluatorId));
          if (!evaluator) {
            continue;
          }
          const result = await runEvaluator(
            {
              evaluator,
              expectedOutput: datasetItem.expectedOutput,
              input: datasetItem.input,
              output: parsedOutput,
              outputSchema: promptVersion.outputSchema,
            },
            {
              ai: aiService,
              judgeOutputSchema: judgeSchemas.get(evaluator.id),
            }
          );
          evaluatorScores[evaluator.id] = {
            confidence: result.confidence,
            error: result.error,
            scores: result.scores,
          };
          if (result.error) {
            rowFailed = true;
            outlierItemIds.push(datasetItem.id);
          }
          if (
            result.confidence !== undefined &&
            result.confidence < evaluator.confidenceAlertBelow
          ) {
            lowConfidenceItemIds.push(datasetItem.id);
            outlierItemIds.push(datasetItem.id);
          }
          for (const threshold of experiment.thresholds) {
            if (threshold.evaluatorName !== evaluator.name || !result.scores) {
              continue;
            }
            const bucketKey = gateBucketKey(versionNumber, threshold);
            const raw = result.scores?.[threshold.dimension];
            const bucket = gateBuckets.get(bucketKey) ?? [];
            if (typeof raw === "boolean" || typeof raw === "number") {
              bucket.push(raw);
            }
            gateBuckets.set(bucketKey, bucket);
          }
        }
        versionResults[String(versionNumber)] = {
          evaluatorScores,
          output: parsedOutput,
        };
      }

      await registerObsExperimentItem().create({
        datasetItemId: new mongoose.Types.ObjectId(datasetItem.id),
        experimentId: experiment._id,
        failed: rowFailed,
        versionResults,
      });
      completed += 1;
      experiment.results = {
        gates: this.computeGates(experiment.versions, experiment.thresholds, gateBuckets),
        lowConfidenceItemIds: [...new Set(lowConfidenceItemIds)],
        outlierItemIds: [...new Set(outlierItemIds)],
        progress: {completed, total: datasetItems.length},
        totalCostUsd: experiment.estimate?.costUsd,
      };
      await experiment.save();
    }

    experiment.status = "completed";
    experiment.results = {
      ...experiment.results,
      gates: this.computeGates(experiment.versions, experiment.thresholds, gateBuckets),
      lowConfidenceItemIds: [...new Set(lowConfidenceItemIds)],
      outlierItemIds: [...new Set(outlierItemIds)],
      progress: {completed: datasetItems.length, total: datasetItems.length},
      totalCostUsd: experiment.estimate?.costUsd,
    };
    await experiment.save();
  }

  private computeGates(
    versions: number[],
    thresholds: ScoreThreshold[],
    gateBuckets: Map<string, Array<boolean | number | undefined>>
  ): ExperimentGateResult[] {
    return versions.flatMap((version) => {
      return thresholds.map((threshold) => {
        const bucketKey = gateBucketKey(version, threshold);
        const actual = computeGateValue(gateBuckets.get(bucketKey) ?? [], threshold.aggregate);
        const passed =
          actual === undefined ? false : compareGate(actual, threshold.op, threshold.value);
        return {
          ...threshold,
          actual,
          passed,
          version,
        };
      });
    });
  }
}
