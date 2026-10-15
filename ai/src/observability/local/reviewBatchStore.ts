import {APIError} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {EvaluatorDimension, ObsJudgeRunDocument} from "../../types/observability";
import {type EvaluatorAiClient, runLlmJudgeEvaluator} from "../evaluate";
import {computeJudgeAgreement, type JudgeAgreement, type ScoreValue} from "../judgeAgreement";
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
  description?: string;
  evaluatorId: string;
  evaluatorName: string;
  id: string;
  judgeCount: number;
  name: string;
  promptName?: string;
}

export interface ReviewBatchItem {
  input?: unknown;
  judgeAnswers: Record<string, {error?: string; scores?: Record<string, ScoreValue>}>;
  output?: unknown;
  reviewItemId: string;
  scores?: Record<string, ScoreValue>;
  status: ReviewStatus;
  traceId: string;
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
    const Batch = registerObsReviewBatch();
    const existingCount = await Batch.countDocuments({evaluatorId: evaluator._id});
    const name =
      params.name?.trim() || `${params.promptName ?? evaluator.name} — batch ${existingCount + 1}`;
    const batch = await Batch.create({
      description: params.description,
      evaluatorId: evaluator._id,
      name,
      promptName: params.promptName,
      traceIds: traceIds.map((id) => objectId(id, "traceId")),
    });
    await this.reviewStore.enqueue({
      batchId: String(batch._id),
      evaluatorId: String(evaluator._id),
      reason: "manual",
      traceIds,
    });
    return this.get(String(batch._id));
  }

  async list(): Promise<ReviewBatchListItem[]> {
    const batches = await registerObsReviewBatch().find({}).sort({created: -1});
    const rows: ReviewBatchListItem[] = [];
    for (const batch of batches) {
      const detail = await this.get(String(batch._id));
      const {dimensions: _d, instructions: _i, items: _items, judges, ...summary} = detail;
      rows.push(summary);
    }
    return rows;
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
    const traces = await registerObsTrace().find({_id: {$in: batch.traceIds}});
    const traceById = new Map(
      traces.map((trace) => {
        return [String(trace._id), trace];
      })
    );
    const judges = await this.latestJudgeRuns(batch._id);
    const judgeEvaluators = await registerObsEvaluator().find({
      _id: {$in: judges.map((run) => run.evaluatorId)},
    });
    const judgeEvaluatorById = new Map(
      judgeEvaluators.map((judge) => {
        return [String(judge._id), judge];
      })
    );

    const humanAnswers = reviewItems
      .filter((item) => item.status === "done")
      .map((item) => {
        return {scores: item.scores, traceId: String(item.traceId)};
      });
    const judgeSummaries: ReviewBatchJudgeSummary[] = judges.map((run) => {
      const judge = judgeEvaluatorById.get(String(run.evaluatorId));
      return {
        agreement: computeJudgeAgreement({
          dimensions,
          humanAnswers,
          judgeAnswers: run.results.map((result) => {
            return {error: result.error, scores: result.scores, traceId: String(result.traceId)};
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
    judgeSummaries.sort((a, b) => (b.agreement.rate ?? -1) - (a.agreement.rate ?? -1));

    const items: ReviewBatchItem[] = reviewItems.map((item) => {
      const traceId = String(item.traceId);
      const trace = traceById.get(traceId);
      const judgeAnswers: ReviewBatchItem["judgeAnswers"] = {};
      for (const run of judges) {
        const result = run.results.find((entry) => String(entry.traceId) === traceId);
        if (result) {
          judgeAnswers[String(run.evaluatorId)] = {error: result.error, scores: result.scores};
        }
      }
      return {
        input: trace?.input,
        judgeAnswers,
        output: trace?.output,
        reviewItemId: String(item._id),
        scores: item.scores,
        status: item.status,
        traceId,
        traceName: trace?.name ?? "Unknown trace",
      };
    });
    const counts: ReviewBatchCounts = {
      done: items.filter((item) => item.status === "done").length,
      pending: items.filter((item) => item.status === "pending" || item.status === "in_progress")
        .length,
      skipped: items.filter((item) => item.status === "skipped").length,
      total: items.length,
    };
    const best = judgeSummaries[0];
    return {
      bestJudge: best ? {evaluatorName: best.evaluatorName, rate: best.agreement.rate} : undefined,
      counts,
      created: toIso(batch.created),
      description: batch.description,
      dimensions,
      evaluatorId: String(batch.evaluatorId),
      evaluatorName: evaluator?.name ?? "Deleted evaluator",
      id: String(batch._id),
      instructions: evaluator?.instructions,
      items,
      judgeCount: judgeSummaries.length,
      judges: judgeSummaries,
      name: batch.name,
      promptName: batch.promptName,
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
    const traces = await registerObsTrace().find({_id: {$in: batch.traceIds}});
    const results = await mapWithConcurrency(traces, JUDGE_CONCURRENCY, async (trace) => {
      const result = await runLlmJudgeEvaluator(
        {
          evaluator: {
            dimensions: judge.dimensions,
            judgePromptName: judge.judgePromptName,
            name: judge.name,
            type: judge.type,
          },
          input: trace.input,
          output: trace.output,
        },
        params.ai,
        judgeVersion.outputSchema as Record<string, unknown>
      );
      return {
        confidence: result.confidence,
        error: result.error,
        scores: result.scores,
        traceId: trace._id,
      };
    });
    await registerObsJudgeRun().create({
      batchId: batch._id,
      completedAt: DateTime.utc().toJSDate(),
      evaluatorId: judge._id,
      modelId: params.ai.modelId,
      results,
    });
    return this.get(String(batch._id));
  }

  private async latestJudgeRuns(batchId: mongoose.Types.ObjectId): Promise<ObsJudgeRunDocument[]> {
    const runs = await registerObsJudgeRun().find({batchId}).sort({completedAt: -1});
    const latest = new Map<string, ObsJudgeRunDocument>();
    for (const run of runs) {
      const key = String(run.evaluatorId);
      if (!latest.has(key)) {
        latest.set(key, run);
      }
    }
    return [...latest.values()];
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
