import {APIError} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {EvaluatorDimension} from "../../types/observability";
import {buildReviewPanels, type ReviewPanels} from "../reviewPanels";
import type {ScoreRecord, ScoreSink} from "../types";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsPrompt} from "./models/obsPrompt";
import {registerObsPromptVersion} from "./models/obsPromptVersion";
import {registerObsReviewItem} from "./models/obsReviewItem";
import {registerObsTrace} from "./models/obsTrace";
import {LocalTraceStore} from "./traceStore";

export type ReviewStatus = "done" | "in_progress" | "pending" | "skipped";

export interface ReviewListItem {
  assigneeId?: string;
  enqueuedAt: string;
  evaluatorId: string;
  id: string;
  promptName?: string;
  reason: string;
  status: ReviewStatus;
  traceId: string;
  traceName: string;
}

const objectId = (value: string, label: string): mongoose.Types.ObjectId => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new APIError({status: 400, title: `${label} must be an object id`});
  }
  return new mongoose.Types.ObjectId(value);
};

const toIso = (value: Date): string => {
  return DateTime.fromJSDate(value).toUTC().toISO() ?? "";
};

export class LocalReviewStore {
  async enqueue(params: {
    evaluatorId: string;
    reason?: "dataset_candidate" | "eval" | "feedback" | "manual";
    spanId?: string;
    traceIds: string[];
  }): Promise<ReviewListItem[]> {
    if (params.traceIds.length === 0) {
      throw new APIError({status: 400, title: "traceIds are required"});
    }
    const evaluator = await registerObsEvaluator().findOneOrNone({
      _id: objectId(params.evaluatorId, "evaluatorId"),
    });
    if (!evaluator) {
      throw new APIError({status: 404, title: "Unknown evaluator"});
    }
    if (evaluator.type !== "human") {
      throw new APIError({
        status: 400,
        title: "Human review requires a human evaluator",
      });
    }
    const created: ReviewListItem[] = [];
    for (const traceId of params.traceIds) {
      const trace = await registerObsTrace().findOneOrNone({_id: objectId(traceId, "traceId")});
      if (!trace) {
        throw new APIError({status: 404, title: `Unknown trace "${traceId}"`});
      }
      const item = await registerObsReviewItem().create({
        enqueuedAt: DateTime.utc().toJSDate(),
        evaluatorId: evaluator._id,
        reason: params.reason ?? "manual",
        status: "pending",
        traceId: trace._id,
        ...(params.spanId ? {spanId: objectId(params.spanId, "spanId")} : {}),
      });
      created.push(this.toListItem(item, trace.name, trace.prompts[0]?.name));
    }
    return created;
  }

  async list(status?: ReviewStatus): Promise<{
    counts: Record<ReviewStatus, number>;
    data: ReviewListItem[];
  }> {
    const ObsReviewItem = registerObsReviewItem();
    const counts = {
      done: await ObsReviewItem.countDocuments({status: "done"}),
      in_progress: await ObsReviewItem.countDocuments({status: "in_progress"}),
      pending: await ObsReviewItem.countDocuments({status: "pending"}),
      skipped: await ObsReviewItem.countDocuments({status: "skipped"}),
    };
    const filter = status ? {status} : {};
    const rows = await ObsReviewItem.find(filter).sort({enqueuedAt: 1});
    const data: ReviewListItem[] = [];
    for (const row of rows) {
      const trace = await registerObsTrace().findOneOrNone({_id: row.traceId});
      data.push(this.toListItem(row, trace?.name ?? "Unknown trace", trace?.prompts[0]?.name));
    }
    return {counts, data};
  }

  async getDetail(id: string): Promise<{
    comment?: string;
    dimensions: EvaluatorDimension[];
    evaluatorId: string;
    id: string;
    instructions?: string;
    panels: ReviewPanels;
    rawInput?: unknown;
    rawOutput?: unknown;
    scores?: Record<string, boolean | number | string>;
    status: ReviewStatus;
    traceId: string;
  }> {
    const item = await registerObsReviewItem().findOneOrNone({_id: objectId(id, "id")});
    if (!item) {
      throw new APIError({status: 404, title: `Unknown review item "${id}"`});
    }
    const evaluator = await registerObsEvaluator().findOneOrNone({_id: item.evaluatorId});
    if (!evaluator) {
      throw new APIError({status: 404, title: "Unknown evaluator"});
    }
    const trace = await registerObsTrace().findOneOrNone({_id: item.traceId});
    const promptRef = trace?.prompts[0];
    let variables:
      | {key: string; label?: string; required: boolean; reviewerNote?: string}[]
      | undefined;
    let outputFieldNotes: Record<string, string> | undefined;
    let outputSchema: Record<string, unknown> | undefined;
    if (promptRef) {
      const prompt = await registerObsPrompt().findOneOrNone({name: promptRef.name});
      if (prompt) {
        const version = await registerObsPromptVersion().findOneOrNone({
          promptId: prompt._id,
          version: promptRef.version,
        });
        variables = version?.variables;
        outputFieldNotes = version?.outputFieldNotes;
        outputSchema = version?.outputSchema;
      }
    }
    return {
      comment: item.comment,
      dimensions: evaluator.dimensions,
      evaluatorId: String(evaluator._id),
      id: String(item._id),
      instructions: evaluator.instructions,
      panels: buildReviewPanels({
        input: trace?.input,
        output: trace?.output,
        outputFieldNotes,
        outputSchema,
        variables,
      }),
      rawInput: trace?.input,
      rawOutput: trace?.output,
      scores: item.scores,
      status: item.status,
      traceId: String(item.traceId),
    };
  }

  async submit(params: {
    comment?: string;
    id: string;
    scores: Record<string, boolean | number | string>;
    sinks: ScoreSink[];
  }): Promise<void> {
    const item = await this.requireItem(params.id);
    const evaluator = await registerObsEvaluator().findOneOrNone({_id: item.evaluatorId});
    if (!evaluator) {
      throw new APIError({status: 404, title: "Unknown evaluator"});
    }
    const missing = evaluator.dimensions.find((dimension) => {
      return dimension.required && params.scores[dimension.key] === undefined;
    });
    if (missing) {
      throw new APIError({status: 400, title: `Score "${missing.key}" is required`});
    }
    const records: ScoreRecord[] = [];
    for (const dimension of evaluator.dimensions) {
      const value = params.scores[dimension.key];
      if (value === undefined) {
        continue;
      }
      records.push({
        comment: params.comment,
        dataType: dimension.dataType,
        evaluatorId: String(evaluator._id),
        name: dimension.key,
        source: "human" as const,
        traceId: String(item.traceId),
        value,
      });
    }
    for (const record of records) {
      if (params.sinks.length === 0) {
        await new LocalTraceStore().exportScore(record);
        continue;
      }
      const results = await Promise.allSettled(
        params.sinks.map((sink) => {
          return sink.export(record);
        })
      );
      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason;
        }
      }
    }
    item.comment = params.comment;
    item.scores = params.scores;
    item.status = "done";
    await item.save();
  }

  async skip(id: string): Promise<void> {
    const item = await this.requireItem(id);
    item.status = "skipped";
    await item.save();
  }

  async assign(id: string, assigneeId: string): Promise<void> {
    const item = await this.requireItem(id);
    item.assigneeId = objectId(assigneeId, "assigneeId");
    item.status = "in_progress";
    await item.save();
  }

  private async requireItem(id: string) {
    const item = await registerObsReviewItem().findOneOrNone({_id: objectId(id, "id")});
    if (!item) {
      throw new APIError({status: 404, title: `Unknown review item "${id}"`});
    }
    return item;
  }

  private toListItem(
    row: {
      _id: mongoose.Types.ObjectId;
      assigneeId?: mongoose.Types.ObjectId;
      enqueuedAt: Date;
      evaluatorId: mongoose.Types.ObjectId;
      reason: string;
      status: ReviewStatus;
      traceId: mongoose.Types.ObjectId;
    },
    traceName: string,
    promptName?: string
  ): ReviewListItem {
    return {
      assigneeId: row.assigneeId ? String(row.assigneeId) : undefined,
      enqueuedAt: toIso(row.enqueuedAt),
      evaluatorId: String(row.evaluatorId),
      id: String(row._id),
      promptName,
      reason: row.reason,
      status: row.status,
      traceId: String(row.traceId),
      traceName,
    };
  }
}
