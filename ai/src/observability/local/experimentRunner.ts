import {APIError, BackgroundTask} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {
  ExperimentAggregates,
  ExperimentEstimate,
  ExperimentGateResult,
  ExperimentKind,
  ExperimentVersionResult,
  ObsEvaluatorDocument,
  ObsExperimentDocument,
  ScoreThreshold,
} from "../../types/observability";
import {compileTemplate} from "../compileTemplate";
import {runEvaluator, runLlmJudgeEvaluator} from "../evaluate";
import {
  type AgreementAnswerSet,
  answersAgree,
  computeJudgeAgreement,
  type JudgeAgreement,
  type JudgeAnswerSet,
} from "../judgeAgreement";
import {questionSetFingerprint} from "../questionFingerprint";
import {SOP_DEFAULT_THRESHOLDS} from "../sopThresholds";
import type {
  ModelPrice,
  ObservabilityAiServiceFactory,
  ObservabilityGenerateClient,
} from "../types";
import type {LocalDatasetStore} from "./datasetStore";
import type {LocalEvaluatorStore} from "./evaluatorStore";
import {loadCurrentHumanAnswers, loadDatasetItemSubjects} from "./humanAnswers";
import {registerObsDataset} from "./models/obsDataset";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsExperiment} from "./models/obsExperiment";
import {registerObsExperimentItem} from "./models/obsExperimentItem";
import type {LocalPromptStore} from "./promptStore";

export interface ExperimentCreateInput {
  datasetId: string;
  evaluatorIds: string[];
  includeUnproofread?: boolean;
  kind?: "prompt";
  modelOverride?: string;
  name: string;
  promptName: string;
  thresholds?: ScoreThreshold[];
  versions: number[];
}

/**
 * Judge calibration: run 2–3 versions of an llm-judge's prompt over dataset items humans already
 * answered with `questionSetId`, and rank versions by agreement with those answers.
 */
export interface JudgeExperimentCreateInput {
  datasetId: string;
  judgeEvaluatorId: string;
  kind: "judge";
  modelOverride?: string;
  name: string;
  questionSetId: string;
  /** Agreement rate (0–1) a version must reach to pass its gate. Defaults to 0.9. */
  targetAgreement?: number;
  /** Versions of the judge evaluator's `judgePromptName`. */
  versions: number[];
}

export const DEFAULT_TARGET_AGREEMENT = 0.9;

export interface ExperimentView {
  backgroundTaskId?: string;
  created: string;
  datasetId: string;
  datasetName?: string;
  estimate?: ExperimentEstimate;
  evaluatorIds: string[];
  id: string;
  includeUnproofread: boolean;
  items: ExperimentItemView[];
  judgeEvaluatorId?: string;
  judgeName?: string;
  kind: ExperimentKind;
  modelOverride?: string;
  name: string;
  promptName: string;
  questionSetId?: string;
  questionSetName?: string;
  questionsFingerprint?: string;
  /** Judge experiments: true when the question set's questions changed since the run. */
  questionsStale?: boolean;
  results?: ExperimentAggregates;
  status: "completed" | "failed" | "pending" | "running";
  targetAgreement?: number;
  thresholds: ScoreThreshold[];
  updated: string;
  versions: number[];
}

export interface ExperimentItemView {
  datasetItemId: string;
  failed: boolean;
  /** Judge experiments: the human answers each judge version is compared with. */
  humanScores?: Record<string, boolean | number | string>;
  id: string;
  versionResults: Record<string, ExperimentVersionResult>;
}

interface ExperimentNames {
  datasetName?: string;
  judgeName?: string;
  questionSetName?: string;
  questionsStale?: boolean;
}

const versionBody = (version: {system?: string; template?: string}): string => {
  return version.system && version.system.length > 0 ? version.system : (version.template ?? "");
};

const toObjectId = (value: unknown, label: string): mongoose.Types.ObjectId => {
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    throw new APIError({status: 400, title: `${label} must be an object id`});
  }
  return new mongoose.Types.ObjectId(value);
};

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
    evaluatorIds?: string[];
    includeUnproofread?: boolean;
    kind?: ExperimentKind;
    modelOverride?: string;
    questionSetId?: string;
    versions: number[];
  }): Promise<ExperimentEstimate> {
    const itemCount =
      input.kind === "judge"
        ? input.questionSetId
          ? (
              await loadCurrentHumanAnswers({
                datasetId: input.datasetId,
                questionSetId: input.questionSetId,
              })
            ).items.length
          : 0
        : (
            await this.deps.datasetStore.listExperimentItems(
              input.datasetId,
              input.includeUnproofread ?? false
            )
          ).length;
    const generations = itemCount * input.versions.length;
    // Judge experiments make one judge call per item and version and no separate generation.
    const evaluatorCount = input.kind === "judge" ? 0 : (input.evaluatorIds?.length ?? 0);
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

  async create(input: ExperimentCreateInput | JudgeExperimentCreateInput): Promise<ExperimentView> {
    const kind: unknown = input.kind ?? "prompt";
    if (kind !== "prompt" && kind !== "judge") {
      throw new APIError({status: 400, title: "kind must be prompt or judge"});
    }
    if (input.kind === "judge") {
      return this.createJudge(input);
    }
    if (!Array.isArray(input.versions) || input.versions.length < 2 || input.versions.length > 3) {
      throw new APIError({status: 400, title: "experiments must compare 2–3 prompt versions"});
    }
    if (input.thresholds?.some((threshold) => threshold.aggregate === "agreement")) {
      throw new APIError({
        status: 400,
        title: "agreement gates belong to judge experiments (kind: judge)",
      });
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
      kind: "prompt",
      modelOverride: input.modelOverride,
      name: input.name,
      promptName: input.promptName,
      status: "pending",
      thresholds: input.thresholds ?? SOP_DEFAULT_THRESHOLDS,
      versions: input.versions,
    });
    return this.startRun(experiment);
  }

  private async createJudge(input: JudgeExperimentCreateInput): Promise<ExperimentView> {
    if (!input.name) {
      throw new APIError({status: 400, title: "name is required"});
    }
    if (
      !Array.isArray(input.versions) ||
      input.versions.length < 2 ||
      input.versions.length > 3 ||
      !input.versions.every((version) => Number.isInteger(version))
    ) {
      throw new APIError({
        status: 400,
        title: "judge experiments must compare 2–3 judge prompt versions",
      });
    }
    if (new Set(input.versions).size !== input.versions.length) {
      throw new APIError({status: 400, title: "judge prompt versions must be different"});
    }
    const targetAgreement = input.targetAgreement ?? DEFAULT_TARGET_AGREEMENT;
    if (typeof targetAgreement !== "number" || targetAgreement <= 0 || targetAgreement > 1) {
      throw new APIError({
        status: 400,
        title: "targetAgreement must be a number above 0 and at most 1",
      });
    }
    const questionSet = await registerObsEvaluator().findOneOrNone({
      _id: toObjectId(input.questionSetId, "questionSetId"),
    });
    if (!questionSet) {
      throw new APIError({status: 404, title: "Unknown question set"});
    }
    if (questionSet.type !== "human") {
      throw new APIError({status: 400, title: "questionSetId must be a human question set"});
    }
    const judge = await registerObsEvaluator().findOneOrNone({
      _id: toObjectId(input.judgeEvaluatorId, "judgeEvaluatorId"),
    });
    if (!judge) {
      throw new APIError({status: 404, title: "Unknown judge evaluator"});
    }
    if (judge.type !== "llm-judge" || !judge.judgePromptName) {
      throw new APIError({
        status: 400,
        title: "judgeEvaluatorId must be an llm-judge evaluator with a judge prompt",
      });
    }
    const questionKeys = new Set(questionSet.dimensions.map((row) => row.key));
    if (!judge.dimensions.some((row) => questionKeys.has(row.key))) {
      throw new APIError({
        detail: `Questions: ${[...questionKeys].join(", ")}. Judge scores: ${judge.dimensions
          .map((row) => row.key)
          .join(", ")}.`,
        status: 400,
        title: "Judge answers none of the question set's questions",
      });
    }
    const dataset = await this.deps.datasetStore.get(
      toObjectId(input.datasetId, "datasetId").toString()
    );
    const current = await loadCurrentHumanAnswers({
      datasetId: dataset.id,
      questionSetId: String(questionSet._id),
    });
    if (current.items.length === 0) {
      throw new APIError({
        detail: `Create a review batch from dataset "${dataset.name}" with "${questionSet.name}" and answer it first.`,
        status: 400,
        title: "Dataset has no current human answers for this question set",
      });
    }
    for (const version of input.versions) {
      const promptVersion = await this.deps.promptStore.getVersionByNumber(
        judge.judgePromptName,
        version
      );
      if (!promptVersion) {
        throw new APIError({
          detail: `Judge prompt "${judge.judgePromptName}" has no version ${version}.`,
          status: 400,
          title: "Unknown judge prompt version",
        });
      }
      if (!promptVersion.outputSchema) {
        throw new APIError({
          detail: `Judge prompt "${judge.judgePromptName}" v${version} has no output schema.`,
          status: 400,
          title: "Judge prompt version has no output schema",
        });
      }
    }
    this.resolveAiClient(input.modelOverride);
    const estimate = await this.estimate({
      datasetId: dataset.id,
      kind: "judge",
      modelOverride: input.modelOverride,
      questionSetId: String(questionSet._id),
      versions: input.versions,
    });
    const experiment = await registerObsExperiment().create({
      datasetId: new mongoose.Types.ObjectId(dataset.id),
      estimate,
      evaluatorIds: [judge._id],
      includeUnproofread: true,
      judgeEvaluatorId: judge._id,
      kind: "judge",
      modelOverride: input.modelOverride,
      name: input.name,
      promptName: judge.judgePromptName,
      questionSetId: questionSet._id,
      questionsFingerprint: current.fingerprint,
      status: "pending",
      targetAgreement,
      thresholds: [],
      versions: input.versions,
    });
    return this.startRun(experiment);
  }

  private async startRun(experiment: ObsExperimentDocument): Promise<ExperimentView> {
    const runner = this.deps.backgroundTaskRunner ?? defaultBackgroundTaskRunner;
    const {taskId} = await runner.enqueue({
      execute: async () => {
        await this.executeExperiment(String(experiment._id));
      },
      taskType: `obs-experiment-${String(experiment._id)}`,
    });
    const ObsExperiment = registerObsExperiment();
    await ObsExperiment.updateOne(
      {_id: experiment._id},
      {$set: {backgroundTaskId: new mongoose.Types.ObjectId(taskId)}}
    );
    // A runner that executes inline has already finished; only a still-pending run is "running".
    await ObsExperiment.updateOne(
      {_id: experiment._id, status: "pending"},
      {$set: {status: "running"}}
    );
    return this.get(String(experiment._id));
  }

  async list(params?: {
    kind?: ExperimentKind;
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
    if (params?.kind === "judge") {
      filter.kind = "judge";
    } else if (params?.kind === "prompt") {
      // Experiments saved before `kind` existed are prompt experiments.
      filter.kind = {$ne: "judge"};
    }
    const ObsExperiment = registerObsExperiment();
    const total = await ObsExperiment.countDocuments(filter);
    const rows = await ObsExperiment.find(filter)
      .sort({created: -1})
      .skip((page - 1) * limit)
      .limit(limit);
    const names = await this.loadNames(rows);
    return {
      data: rows.map((row) => {
        return this.toSummaryView(row, names.get(String(row._id)));
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
    const names = await this.loadNames([experiment]);
    return {
      ...this.toSummaryView(experiment, names.get(String(experiment._id))),
      items: sortedItems.map((row) => {
        return {
          datasetItemId: String(row.datasetItemId),
          failed: row.failed,
          humanScores: row.humanScores,
          id: String(row._id),
          versionResults: row.versionResults,
        };
      }),
    };
  }

  // Dataset, question-set, and judge names for display, plus question-set staleness.
  private async loadNames(
    experiments: ObsExperimentDocument[]
  ): Promise<Map<string, ExperimentNames>> {
    const datasetIds = experiments.map((row) => row.datasetId);
    const evaluatorIds = experiments.flatMap((row) => {
      return [row.questionSetId, row.judgeEvaluatorId].filter((id): id is mongoose.Types.ObjectId =>
        Boolean(id)
      );
    });
    const datasets = datasetIds.length
      ? await registerObsDataset().find({_id: {$in: datasetIds}})
      : [];
    const evaluators = evaluatorIds.length
      ? await registerObsEvaluator().find({_id: {$in: evaluatorIds}})
      : [];
    const datasetNameById = new Map(datasets.map((row) => [String(row._id), row.name]));
    const evaluatorById = new Map<string, ObsEvaluatorDocument>(
      evaluators.map((row) => [String(row._id), row])
    );
    return new Map(
      experiments.map((row) => {
        const questionSet = row.questionSetId
          ? evaluatorById.get(String(row.questionSetId))
          : undefined;
        const judge = row.judgeEvaluatorId
          ? evaluatorById.get(String(row.judgeEvaluatorId))
          : undefined;
        return [
          String(row._id),
          {
            datasetName: datasetNameById.get(String(row.datasetId)),
            judgeName: judge?.name,
            questionSetName: questionSet?.name,
            questionsStale:
              questionSet && row.questionsFingerprint
                ? questionSetFingerprint(questionSet.dimensions) !== row.questionsFingerprint
                : undefined,
          },
        ];
      })
    );
  }

  private toSummaryView(
    experiment: ObsExperimentDocument,
    names?: ExperimentNames
  ): ExperimentView {
    return {
      backgroundTaskId: experiment.backgroundTaskId
        ? String(experiment.backgroundTaskId)
        : undefined,
      created: DateTime.fromJSDate(experiment.created).toUTC().toISO() ?? "",
      datasetId: String(experiment.datasetId),
      datasetName: names?.datasetName,
      estimate: experiment.estimate,
      evaluatorIds: experiment.evaluatorIds.map((value) => String(value)),
      id: String(experiment._id),
      includeUnproofread: experiment.includeUnproofread,
      items: [],
      judgeEvaluatorId: experiment.judgeEvaluatorId
        ? String(experiment.judgeEvaluatorId)
        : undefined,
      judgeName: names?.judgeName,
      kind: experiment.kind ?? "prompt",
      modelOverride: experiment.modelOverride,
      name: experiment.name,
      promptName: experiment.promptName,
      questionSetId: experiment.questionSetId ? String(experiment.questionSetId) : undefined,
      questionSetName: names?.questionSetName,
      questionsFingerprint: experiment.questionsFingerprint,
      questionsStale: names?.questionsStale,
      results: experiment.results,
      status: experiment.status,
      targetAgreement: experiment.targetAgreement,
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
    if (experiment.kind === "judge") {
      await this.executeJudgeExperiment(experiment, aiService);
      return;
    }
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

  private async executeJudgeExperiment(
    experiment: ObsExperimentDocument,
    aiService: ObservabilityGenerateClient
  ): Promise<void> {
    const judge = experiment.judgeEvaluatorId
      ? await registerObsEvaluator().findOneOrNone({_id: experiment.judgeEvaluatorId})
      : undefined;
    if (!judge?.judgePromptName || !experiment.questionSetId) {
      throw new APIError({
        status: 404,
        title: "Judge experiment is missing its judge or question set",
      });
    }
    const judgePromptName = judge.judgePromptName;
    const current = await loadCurrentHumanAnswers({
      datasetId: experiment.datasetId,
      questionSetId: experiment.questionSetId,
    });
    // Judges see exactly what reviewers saw: the source trace, else the item's input and expected output.
    const subjects = await loadDatasetItemSubjects(current.items.map((row) => row.item));
    const versionPrompts = new Map<number, {schema: Record<string, unknown>; system: string}>();
    for (const versionNumber of experiment.versions) {
      const version = await this.deps.promptStore.getVersionByNumber(
        judgePromptName,
        versionNumber
      );
      if (!version?.outputSchema) {
        throw new APIError({
          status: 404,
          title: `Judge prompt "${judgePromptName}" v${versionNumber} is missing or has no output schema`,
        });
      }
      versionPrompts.set(versionNumber, {
        schema: version.outputSchema,
        system: versionBody(version),
      });
    }
    const judgeId = String(judge._id);
    const judgeKeys = judge.dimensions.map((dimension) => dimension.key);
    const comparedDimensions = current.questionSet.dimensions.filter((dimension) => {
      return judgeKeys.includes(dimension.key);
    });
    const humanAnswers: AgreementAnswerSet[] = [];
    const judgeAnswers = new Map<number, JudgeAnswerSet[]>(
      experiment.versions.map((version) => [version, []])
    );
    const lowConfidenceItemIds: string[] = [];
    const outlierItemIds: string[] = [];
    const total = current.items.length;
    const aggregate = (completed: number): ExperimentAggregates => {
      const agreement: Record<string, JudgeAgreement> = {};
      for (const version of experiment.versions) {
        agreement[String(version)] = computeJudgeAgreement({
          dimensions: current.questionSet.dimensions,
          humanAnswers,
          judgeAnswers: judgeAnswers.get(version) ?? [],
          judgeKeys,
        });
      }
      const target = experiment.targetAgreement ?? DEFAULT_TARGET_AGREEMENT;
      return {
        agreement,
        gates: experiment.versions.map((version) => {
          const actual = agreement[String(version)]?.rate;
          return {
            actual,
            aggregate: "agreement" as const,
            dimension: "agreement",
            evaluatorName: judge.name,
            op: "gte" as const,
            passed: actual !== undefined && actual >= target,
            value: target,
            version,
          };
        }),
        lowConfidenceItemIds: [...new Set(lowConfidenceItemIds)],
        outlierItemIds: [...new Set(outlierItemIds)],
        progress: {completed, total},
        totalCostUsd: experiment.estimate?.costUsd,
      };
    };

    let completed = 0;
    for (const {answer, item} of current.items) {
      const datasetItemId = String(item._id);
      const subject = subjects.get(datasetItemId);
      const ids = {datasetItemId, ...(subject?.traceId ? {traceId: subject.traceId} : {})};
      humanAnswers.push({...ids, scores: answer.scores});
      const versionResults: Record<string, ExperimentVersionResult> = {};
      let rowFailed = false;
      for (const versionNumber of experiment.versions) {
        const prompt = versionPrompts.get(versionNumber);
        if (!prompt) {
          continue;
        }
        const result = await runLlmJudgeEvaluator(
          {
            evaluator: {
              dimensions: judge.dimensions,
              judgePromptName,
              name: judge.name,
              type: judge.type,
            },
            input: subject?.input,
            output: subject?.output,
          },
          aiService,
          prompt.schema,
          {judgeSystemPrompt: prompt.system}
        );
        versionResults[String(versionNumber)] = {
          evaluatorScores: {
            [judgeId]: {confidence: result.confidence, error: result.error, scores: result.scores},
          },
        };
        judgeAnswers.get(versionNumber)?.push({...ids, error: result.error, scores: result.scores});
        if (result.error) {
          rowFailed = true;
          outlierItemIds.push(datasetItemId);
        }
        if (result.confidence !== undefined && result.confidence < judge.confidenceAlertBelow) {
          lowConfidenceItemIds.push(datasetItemId);
        }
        // A row fails when any version disagrees with the reviewers on any compared question.
        const disagrees = comparedDimensions.some((dimension) => {
          const human = answer.scores[dimension.key];
          return (
            human !== undefined && !answersAgree(dimension, human, result.scores?.[dimension.key])
          );
        });
        if (disagrees) {
          rowFailed = true;
        }
      }
      await registerObsExperimentItem().create({
        datasetItemId: item._id,
        experimentId: experiment._id,
        failed: rowFailed,
        humanScores: answer.scores,
        versionResults,
      });
      completed += 1;
      experiment.results = aggregate(completed);
      await experiment.save();
    }
    experiment.questionsFingerprint = current.fingerprint;
    experiment.results = aggregate(total);
    experiment.status = "completed";
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
