import {APIError} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {
  EvaluatorDimension,
  ObsEvaluatorDocument,
  ObsJudgeRunDocument,
  ObsReviewBatchDocument,
  ObsReviewItemDocument,
} from "../../types/observability";
import {type EvaluatorAiClient, runLlmJudgeEvaluator} from "../evaluate";
import {
  agreementAnswerKey,
  computeJudgeAgreement,
  type JudgeAgreement,
  type ScoreValue,
} from "../judgeAgreement";
import {questionSetFingerprint} from "../questionFingerprint";
import {loadDatasetItemSubjects} from "./humanAnswers";
import {registerObsDataset} from "./models/obsDataset";
import {registerObsDatasetItem} from "./models/obsDatasetItem";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsJudgeRun} from "./models/obsJudgeRun";
import {registerObsReviewBatch} from "./models/obsReviewBatch";
import {registerObsReviewItem} from "./models/obsReviewItem";
import {registerObsTrace} from "./models/obsTrace";
import {LocalPromptStore} from "./promptStore";
import {LocalReviewStore, type ReviewStatus} from "./reviewStore";

export const DEFAULT_REVIEW_BATCH_SIZE = 10;
export const MAX_REVIEW_BATCH_SIZE = 50;
const JUDGE_CONCURRENCY = 5;

export interface ReviewBatchCounts {
  done: number;
  pending: number;
  skipped: number;
  total: number;
}

export interface ReviewBatchJudgeSummary {
  agreement: JudgeAgreement;
  completedAt: string;
  evaluatorId: string;
  evaluatorName: string;
  judgePromptName?: string;
  modelId?: string;
  runId: string;
}

export interface ReviewBatchListItem {
  bestJudge?: {evaluatorName: string; rate?: number};
  counts: ReviewBatchCounts;
  created: string;
  /** Dataset the batch judges, when it was built from a dataset. */
  datasetId?: string;
  datasetName?: string;
  description?: string;
  evaluatorId: string;
  evaluatorName: string;
  id: string;
  judgeCount: number;
  name: string;
  promptName?: string;
  /** Question-set fingerprint when the batch was created (dataset batches). */
  questionsFingerprint?: string;
  /** True when the question set's questions changed since this dataset batch was created. */
  questionsStale?: boolean;
}

export interface ReviewBatchItem {
  datasetItemId?: string;
  input?: unknown;
  judgeAnswers: Record<string, {error?: string; scores?: Record<string, ScoreValue>}>;
  output?: unknown;
  reviewItemId: string;
  scores?: Record<string, ScoreValue>;
  status: ReviewStatus;
  /** Unset for a dataset item without a source trace. */
  traceId?: string;
  traceName: string;
}

interface ReviewSubject {
  datasetItemId?: string;
  input?: unknown;
  key: string;
  output?: unknown;
  traceId?: string;
  traceName: string;
}

export interface ReviewBatchDetail extends ReviewBatchListItem {
  dimensions: EvaluatorDimension[];
  instructions?: string;
  items: ReviewBatchItem[];
  judges: ReviewBatchJudgeSummary[];
}

const objectId = (value: string, label: string): mongoose.Types.ObjectId => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new APIError({status: 400, title: `${label} must be an object id`});
  }
  return new mongoose.Types.ObjectId(value);
};

const toIso = (value?: Date): string => {
  return value ? (DateTime.fromJSDate(value).toUTC().toISO() ?? "") : "";
};

// Run async work over items with a fixed number in flight, keeping input order in the result.
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
};

/**
 * Review batches pair a fixed set of traces (one input and one output each) with a human question
 * set. Reviewers answer every question per item; operators then run LLM judges over the same
 * traces and compare judge answers with the human answers question by question.
 */
export class LocalReviewBatchStore {
  constructor(
    private readonly promptStore = new LocalPromptStore(),
    private readonly reviewStore = new LocalReviewStore()
  ) {}

  async create(params: {
    datasetId?: string;
    description?: string;
    evaluatorId: string;
    limit?: number;
    name?: string;
    promptName?: string;
    traceIds?: string[];
  }): Promise<ReviewBatchDetail> {
    const evaluator = await registerObsEvaluator().findOneOrNone({
      _id: objectId(params.evaluatorId, "evaluatorId"),
    });
    if (!evaluator) {
      throw new APIError({status: 404, title: "Unknown evaluator"});
    }
    if (evaluator.type !== "human") {
      throw new APIError({status: 400, title: "Review batches require a human evaluator"});
    }
    if (params.datasetId) {
      if (params.traceIds !== undefined || params.limit !== undefined) {
        throw new APIError({
          status: 400,
          title: "datasetId cannot be combined with traceIds or limit",
        });
      }
      return this.createFromDataset({...params, datasetId: params.datasetId, evaluator});
    }
    const limit = params.limit ?? DEFAULT_REVIEW_BATCH_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REVIEW_BATCH_SIZE) {
      throw new APIError({
        status: 400,
        title: `limit must be an integer from 1 to ${MAX_REVIEW_BATCH_SIZE}`,
      });
    }
    const traceIds = params.traceIds?.length
      ? params.traceIds.slice(0, MAX_REVIEW_BATCH_SIZE)
      : await this.recentTraceIds({
          evaluatorId: evaluator._id,
          limit,
          promptName: params.promptName,
        });
    if (traceIds.length === 0) {
      throw new APIError({
        status: 400,
        title: params.promptName
          ? `No recent "${params.promptName}" traces that are not already in a batch for this question set`
          : "No recent traces that are not already in a batch for this question set",
      });
    }
    const traceObjectIds = traceIds.map((id) => objectId(id, "traceId"));
    const found = await registerObsTrace()
      .find({_id: {$in: traceObjectIds}})
      .select({_id: 1});
    const foundIds = new Set(found.map((trace) => String(trace._id)));
    const missing = traceIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new APIError({detail: missing.join(", "), status: 404, title: "Unknown trace ids"});
    }
    const Batch = registerObsReviewBatch();
    const existingCount = await Batch.countDocuments({evaluatorId: evaluator._id});
    const name =
      params.name?.trim() || `${params.promptName ?? evaluator.name} — batch ${existingCount + 1}`;
    const batch = await Batch.create({
      description: params.description,
      evaluatorId: evaluator._id,
      name,
      promptName: params.promptName,
      traceIds: traceObjectIds,
    });
    try {
      await this.reviewStore.enqueue({
        batchId: String(batch._id),
        evaluatorId: String(evaluator._id),
        reason: "manual",
        traceIds,
      });
    } catch (error) {
      // A half-built batch would hide its traces from later "grab recent" batches.
      await registerObsReviewItem().deleteMany({batchId: batch._id});
      await Batch.deleteOne({_id: batch._id});
      throw error;
    }
    return this.get(String(batch._id));
  }

  /**
   * One review item per dataset item that lacks a current answer from this question set and is
   * not already waiting in an open review for it.
   */
  private async createFromDataset(params: {
    datasetId: string;
    description?: string;
    evaluator: ObsEvaluatorDocument;
    name?: string;
  }): Promise<ReviewBatchDetail> {
    const {evaluator} = params;
    const dataset = await registerObsDataset().findOneOrNone({
      _id: objectId(params.datasetId, "datasetId"),
    });
    if (!dataset) {
      throw new APIError({status: 404, title: `Unknown dataset "${params.datasetId}"`});
    }
    const fingerprint = questionSetFingerprint(evaluator.dimensions);
    const evaluatorKey = String(evaluator._id);
    const datasetItems = await registerObsDatasetItem()
      .find({datasetId: dataset._id})
      .sort({_id: 1});
    const unanswered = datasetItems.filter((item) => {
      return item.humanAnswers?.[evaluatorKey]?.fingerprint !== fingerprint;
    });
    if (unanswered.length === 0) {
      throw new APIError({
        detail: datasetItems.length === 0 ? `Dataset "${dataset.name}" has no items.` : undefined,
        status: 400,
        title: "Every item already has current answers",
      });
    }
    const open = await registerObsReviewItem()
      .find({
        datasetItemId: {$in: unanswered.map((item) => item._id)},
        evaluatorId: evaluator._id,
        status: {$in: ["in_progress", "pending"]},
      })
      .select({datasetItemId: 1});
    const openIds = new Set(open.map((item) => String(item.datasetItemId)));
    const toJudge = unanswered.filter((item) => !openIds.has(String(item._id)));
    if (toJudge.length === 0) {
      throw new APIError({
        status: 400,
        title: "Every unanswered item is already waiting in an open review batch",
      });
    }
    const Batch = registerObsReviewBatch();
    const existingCount = await Batch.countDocuments({datasetId: dataset._id});
    const batch = await Batch.create({
      datasetId: dataset._id,
      description: params.description,
      evaluatorId: evaluator._id,
      name: params.name?.trim() || `${dataset.name} — ${evaluator.name} ${existingCount + 1}`,
      questionsFingerprint: fingerprint,
      traceIds: toJudge.flatMap((item) => (item.sourceTraceId ? [item.sourceTraceId] : [])),
    });
    try {
      await this.reviewStore.enqueueDatasetItems({
        batchId: String(batch._id),
        evaluatorId: evaluatorKey,
        items: toJudge.map((item) => {
          return {
            datasetItemId: String(item._id),
            traceId: item.sourceTraceId ? String(item.sourceTraceId) : undefined,
          };
        }),
      });
    } catch (error) {
      await registerObsReviewItem().deleteMany({batchId: batch._id});
      await Batch.deleteOne({_id: batch._id});
      throw error;
    }
    return this.get(String(batch._id));
  }

  async list(): Promise<ReviewBatchListItem[]> {
    const batches = await registerObsReviewBatch().find({}).sort({created: -1});
    if (batches.length === 0) {
      return [];
    }
    const batchIds = batches.map((batch) => batch._id);
    const reviewItems = await registerObsReviewItem()
      .find({batchId: {$in: batchIds}})
      .select({batchId: 1, datasetItemId: 1, scores: 1, status: 1, traceId: 1});
    const runs = await this.latestJudgeRuns(batchIds);
    const evaluators = await registerObsEvaluator().find({
      _id: {
        $in: [...batches.map((batch) => batch.evaluatorId), ...runs.map((run) => run.evaluatorId)],
      },
    });
    const evaluatorById = new Map(
      evaluators.map((evaluator) => {
        return [String(evaluator._id), evaluator];
      })
    );
    const datasetNames = await this.datasetNames(batches);
    return batches.map((batch) => {
      const batchId = String(batch._id);
      const evaluator = evaluatorById.get(String(batch.evaluatorId));
      const items = reviewItems.filter((item) => String(item.batchId) === batchId);
      const judges = this.summarizeJudges({
        dimensions: evaluator?.dimensions ?? [],
        evaluatorById,
        reviewItems: items,
        runs: runs.filter((run) => String(run.batchId) === batchId),
      });
      return this.toListItem({
        batch,
        datasetName: batch.datasetId ? datasetNames.get(String(batch.datasetId)) : undefined,
        evaluator,
        items,
        judges,
      });
    });
  }

  async get(id: string): Promise<ReviewBatchDetail> {
    const batch = await registerObsReviewBatch().findOneOrNone({_id: objectId(id, "id")});
    if (!batch) {
      throw new APIError({status: 404, title: `Unknown review batch "${id}"`});
    }
    const evaluator = await registerObsEvaluator().findOneOrNone({_id: batch.evaluatorId});
    const dimensions = evaluator?.dimensions ?? [];
    const reviewItems = await registerObsReviewItem()
      .find({batchId: batch._id})
      .sort({_id: 1, enqueuedAt: 1});
    const subjects = await this.loadSubjects(reviewItems);
    const runs = await this.latestJudgeRuns([batch._id]);
    const judgeEvaluators = await registerObsEvaluator().find({
      _id: {$in: runs.map((run) => run.evaluatorId)},
    });
    const judges = this.summarizeJudges({
      dimensions,
      evaluatorById: new Map(
        judgeEvaluators.map((judge) => {
          return [String(judge._id), judge];
        })
      ),
      reviewItems,
      runs,
    });

    const items: ReviewBatchItem[] = reviewItems.map((item) => {
      const subject = subjects.get(String(item._id));
      const key = subject?.key ?? agreementAnswerKey(this.answerIds(item));
      const judgeAnswers: ReviewBatchItem["judgeAnswers"] = {};
      for (const run of runs) {
        const result = run.results.find((entry) => {
          return agreementAnswerKey(this.answerIds(entry)) === key;
        });
        if (result) {
          judgeAnswers[String(run.evaluatorId)] = {error: result.error, scores: result.scores};
        }
      }
      return {
        datasetItemId: item.datasetItemId ? String(item.datasetItemId) : undefined,
        input: subject?.input,
        judgeAnswers,
        output: subject?.output,
        reviewItemId: String(item._id),
        scores: item.scores,
        status: item.status,
        traceId: subject?.traceId ?? (item.traceId ? String(item.traceId) : undefined),
        traceName: subject?.traceName ?? "Unknown trace",
      };
    });
    const datasetNames = await this.datasetNames([batch]);
    return {
      ...this.toListItem({
        batch,
        datasetName: batch.datasetId ? datasetNames.get(String(batch.datasetId)) : undefined,
        evaluator: evaluator ?? undefined,
        items: reviewItems,
        judges,
      }),
      dimensions,
      instructions: evaluator?.instructions,
      items,
      judges,
    };
  }

  /** Run an LLM judge over every batch trace and store its answers for comparison. */
  async runJudge(params: {
    ai: EvaluatorAiClient & {modelId?: string};
    batchId: string;
    evaluatorId: string;
  }): Promise<ReviewBatchDetail> {
    const batch = await registerObsReviewBatch().findOneOrNone({
      _id: objectId(params.batchId, "batchId"),
    });
    if (!batch) {
      throw new APIError({status: 404, title: `Unknown review batch "${params.batchId}"`});
    }
    const judge = await registerObsEvaluator().findOneOrNone({
      _id: objectId(params.evaluatorId, "evaluatorId"),
    });
    if (!judge) {
      throw new APIError({status: 404, title: "Unknown evaluator"});
    }
    if (judge.type !== "llm-judge" || !judge.judgePromptName) {
      throw new APIError({status: 400, title: "Only llm-judge evaluators can be compared"});
    }
    const questionSet = await registerObsEvaluator().findOneOrNone({_id: batch.evaluatorId});
    const questionKeys = new Set((questionSet?.dimensions ?? []).map((row) => row.key));
    const sharedKeys = judge.dimensions.filter((row) => questionKeys.has(row.key));
    if (sharedKeys.length === 0) {
      throw new APIError({
        detail: `Batch questions: ${[...questionKeys].join(", ")}. Judge scores: ${judge.dimensions
          .map((row) => row.key)
          .join(", ")}.`,
        status: 400,
        title: `Judge "${judge.name}" answers none of this batch's questions`,
      });
    }
    const judgeVersion = await this.promptStore.getVersionByLabel(judge.judgePromptName);
    if (!judgeVersion?.outputSchema) {
      throw new APIError({
        status: 400,
        title: `Judge prompt "${judge.judgePromptName}" has no production output schema`,
      });
    }
    const reviewItems = await registerObsReviewItem()
      .find({batchId: batch._id})
      .sort({_id: 1, enqueuedAt: 1});
    const subjectByKey = new Map<string, ReviewSubject>();
    for (const subject of (await this.loadSubjects(reviewItems)).values()) {
      subjectByKey.set(subject.key, subject);
    }
    const results = await mapWithConcurrency(
      [...subjectByKey.values()],
      JUDGE_CONCURRENCY,
      async (subject) => {
        const result = await runLlmJudgeEvaluator(
          {
            evaluator: {
              dimensions: judge.dimensions,
              judgePromptName: judge.judgePromptName,
              name: judge.name,
              type: judge.type,
            },
            input: subject.input,
            output: subject.output,
          },
          params.ai,
          judgeVersion.outputSchema as Record<string, unknown>
        );
        return {
          confidence: result.confidence,
          error: result.error,
          scores: result.scores,
          ...(subject.datasetItemId
            ? {datasetItemId: new mongoose.Types.ObjectId(subject.datasetItemId)}
            : {}),
          ...(subject.traceId ? {traceId: new mongoose.Types.ObjectId(subject.traceId)} : {}),
        };
      }
    );
    await registerObsJudgeRun().create({
      batchId: batch._id,
      completedAt: DateTime.utc().toJSDate(),
      evaluatorId: judge._id,
      modelId: params.ai.modelId,
      results,
    });
    return this.get(String(batch._id));
  }

  private answerIds(row: {
    datasetItemId?: mongoose.Types.ObjectId;
    traceId?: mongoose.Types.ObjectId;
  }): {datasetItemId?: string; traceId?: string} {
    return {
      datasetItemId: row.datasetItemId ? String(row.datasetItemId) : undefined,
      traceId: row.traceId ? String(row.traceId) : undefined,
    };
  }

  // What reviewers saw for each review item: its trace, or the dataset item when it has none.
  private async loadSubjects(
    reviewItems: Pick<ObsReviewItemDocument, "_id" | "datasetItemId" | "traceId">[]
  ): Promise<Map<string, ReviewSubject>> {
    const traceIds = reviewItems.flatMap((item) => (item.traceId ? [item.traceId] : []));
    const traces = traceIds.length ? await registerObsTrace().find({_id: {$in: traceIds}}) : [];
    const traceById = new Map(
      traces.map((trace) => {
        return [String(trace._id), trace];
      })
    );
    const datasetItemIds = reviewItems.flatMap((item) => {
      const hasTrace = item.traceId && traceById.has(String(item.traceId));
      return !hasTrace && item.datasetItemId ? [item.datasetItemId] : [];
    });
    const datasetSubjects = datasetItemIds.length
      ? await loadDatasetItemSubjects(
          await registerObsDatasetItem().find({_id: {$in: datasetItemIds}})
        )
      : new Map();
    const subjects = new Map<string, ReviewSubject>();
    for (const item of reviewItems) {
      const ids = this.answerIds(item);
      const key = agreementAnswerKey(ids);
      const trace = item.traceId ? traceById.get(String(item.traceId)) : undefined;
      if (trace) {
        subjects.set(String(item._id), {
          ...ids,
          input: trace.input,
          key,
          output: trace.output,
          traceName: trace.name,
        });
        continue;
      }
      const datasetSubject = ids.datasetItemId ? datasetSubjects.get(ids.datasetItemId) : undefined;
      subjects.set(String(item._id), {
        ...ids,
        input: datasetSubject?.input,
        key,
        output: datasetSubject?.output,
        traceName: datasetSubject ? "Dataset item" : "Unknown trace",
      });
    }
    return subjects;
  }

  private async datasetNames(
    batches: Pick<ObsReviewBatchDocument, "datasetId">[]
  ): Promise<Map<string, string>> {
    const ids = batches.flatMap((batch) => (batch.datasetId ? [batch.datasetId] : []));
    if (ids.length === 0) {
      return new Map();
    }
    const datasets = await registerObsDataset().find({_id: {$in: ids}});
    return new Map(
      datasets.map((dataset) => {
        return [String(dataset._id), dataset.name];
      })
    );
  }

  private async latestJudgeRuns(
    batchIds: mongoose.Types.ObjectId[]
  ): Promise<ObsJudgeRunDocument[]> {
    const runs = await registerObsJudgeRun()
      .find({batchId: {$in: batchIds}})
      .sort({completedAt: -1});
    const latest = new Map<string, ObsJudgeRunDocument>();
    for (const run of runs) {
      const key = `${String(run.batchId)}:${String(run.evaluatorId)}`;
      if (!latest.has(key)) {
        latest.set(key, run);
      }
    }
    return [...latest.values()];
  }

  // Agreement for each judge's latest run against the done human answers, best match first.
  private summarizeJudges(params: {
    dimensions: EvaluatorDimension[];
    evaluatorById: Map<string, ObsEvaluatorDocument>;
    reviewItems: Pick<ObsReviewItemDocument, "datasetItemId" | "scores" | "status" | "traceId">[];
    runs: ObsJudgeRunDocument[];
  }): ReviewBatchJudgeSummary[] {
    const humanAnswers = params.reviewItems
      .filter((item) => item.status === "done")
      .map((item) => {
        return {...this.answerIds(item), scores: item.scores};
      });
    const summaries = params.runs.map((run) => {
      const judge = params.evaluatorById.get(String(run.evaluatorId));
      return {
        agreement: computeJudgeAgreement({
          dimensions: params.dimensions,
          humanAnswers,
          judgeAnswers: run.results.map((result) => {
            return {...this.answerIds(result), error: result.error, scores: result.scores};
          }),
          judgeKeys: (judge?.dimensions ?? []).map((dimension) => dimension.key),
        }),
        completedAt: toIso(run.completedAt),
        evaluatorId: String(run.evaluatorId),
        evaluatorName: judge?.name ?? "Deleted judge",
        judgePromptName: judge?.judgePromptName,
        modelId: run.modelId,
        runId: String(run._id),
      };
    });
    summaries.sort((a, b) => (b.agreement.rate ?? -1) - (a.agreement.rate ?? -1));
    return summaries;
  }

  private toListItem(params: {
    batch: ObsReviewBatchDocument;
    datasetName?: string;
    evaluator?: Pick<ObsEvaluatorDocument, "dimensions" | "name">;
    items: Pick<ObsReviewItemDocument, "status">[];
    judges: ReviewBatchJudgeSummary[];
  }): ReviewBatchListItem {
    const {batch, evaluator, items, judges} = params;
    const questionsStale =
      batch.questionsFingerprint && evaluator
        ? questionSetFingerprint(evaluator.dimensions) !== batch.questionsFingerprint
        : undefined;
    const best = judges[0];
    return {
      bestJudge: best ? {evaluatorName: best.evaluatorName, rate: best.agreement.rate} : undefined,
      counts: {
        done: items.filter((item) => item.status === "done").length,
        pending: items.filter((item) => item.status === "pending" || item.status === "in_progress")
          .length,
        skipped: items.filter((item) => item.status === "skipped").length,
        total: items.length,
      },
      created: toIso(batch.created),
      datasetId: batch.datasetId ? String(batch.datasetId) : undefined,
      datasetName: params.datasetName,
      description: batch.description,
      evaluatorId: String(batch.evaluatorId),
      evaluatorName: evaluator?.name ?? "Deleted evaluator",
      id: String(batch._id),
      judgeCount: judges.length,
      name: batch.name,
      promptName: batch.promptName,
      questionsFingerprint: batch.questionsFingerprint,
      questionsStale,
    };
  }

  // Newest successful traces with an output, skipping traces already batched for this question set.
  private async recentTraceIds(params: {
    evaluatorId: mongoose.Types.ObjectId;
    limit: number;
    promptName?: string;
  }): Promise<string[]> {
    const batched = await registerObsReviewBatch().find({evaluatorId: params.evaluatorId});
    const excluded = batched.flatMap((batch) => batch.traceIds);
    const filter: Record<string, unknown> = {
      _id: {$nin: excluded},
      output: {$exists: true, $ne: null},
      status: "ok",
    };
    if (params.promptName) {
      filter["prompts.name"] = params.promptName;
    }
    const traces = await registerObsTrace()
      .find(filter)
      .sort({startedAt: -1})
      .limit(params.limit)
      .select({_id: 1});
    return traces.map((trace) => String(trace._id));
  }
}
