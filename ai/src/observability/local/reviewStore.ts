import {APIError} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {EvaluatorDimension} from "../../types/observability";
import {buildReviewPanels, type ReviewPanels} from "../reviewPanels";
import type {ScoreRecord, ScoreSink} from "../types";
import {loadDatasetItemSubjects, writeHumanAnswer} from "./humanAnswers";
import {registerObsDataset} from "./models/obsDataset";
import {registerObsDatasetItem} from "./models/obsDatasetItem";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsPrompt} from "./models/obsPrompt";
import {registerObsPromptLabel} from "./models/obsPromptLabel";
import {registerObsPromptVersion} from "./models/obsPromptVersion";
import {registerObsReviewBatch} from "./models/obsReviewBatch";
import {registerObsReviewItem} from "./models/obsReviewItem";
import {registerObsTrace} from "./models/obsTrace";
import {LocalTraceStore} from "./traceStore";

export type ReviewStatus = "done" | "in_progress" | "pending" | "skipped";

export interface ReviewListItem {
  assigneeId?: string;
  batchId?: string;
  /** Dataset item under review, when the item came from a dataset review batch. */
  datasetItemId?: string;
  enqueuedAt: string;
  evaluatorId: string;
  id: string;
  promptName?: string;
  reason: string;
  status: ReviewStatus;
  /** Unset when the reviewed dataset item has no source trace. */
  traceId?: string;
  traceName: string;
}

const DATASET_ITEM_NAME = "Dataset item";

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
    batchId?: string;
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
        ...(params.batchId ? {batchId: objectId(params.batchId, "batchId")} : {}),
        ...(params.spanId ? {spanId: objectId(params.spanId, "spanId")} : {}),
      });
      created.push(this.toListItem(item, trace.name, trace.prompts[0]?.name));
    }
    return created;
  }

  /** Queue dataset items for a human question set; items with a source trace show that trace. */
  async enqueueDatasetItems(params: {
    batchId: string;
    evaluatorId: string;
    items: Array<{datasetItemId: string; traceId?: string}>;
  }): Promise<ReviewListItem[]> {
    const created: ReviewListItem[] = [];
    for (const entry of params.items) {
      const item = await registerObsReviewItem().create({
        batchId: objectId(params.batchId, "batchId"),
        datasetItemId: objectId(entry.datasetItemId, "datasetItemId"),
        enqueuedAt: DateTime.utc().toJSDate(),
        evaluatorId: objectId(params.evaluatorId, "evaluatorId"),
        reason: "manual",
        status: "pending",
        ...(entry.traceId ? {traceId: objectId(entry.traceId, "traceId")} : {}),
      });
      created.push(this.toListItem(item, DATASET_ITEM_NAME));
    }
    return created;
  }

  async list(
    status?: ReviewStatus,
    options: {batchId?: string} = {}
  ): Promise<{
    counts: Record<ReviewStatus, number>;
    data: ReviewListItem[];
  }> {
    const ObsReviewItem = registerObsReviewItem();
    const scope = options.batchId ? {batchId: objectId(options.batchId, "batchId")} : {};
    const counts = {
      done: await ObsReviewItem.countDocuments({...scope, status: "done"}),
      in_progress: await ObsReviewItem.countDocuments({...scope, status: "in_progress"}),
      pending: await ObsReviewItem.countDocuments({...scope, status: "pending"}),
      skipped: await ObsReviewItem.countDocuments({...scope, status: "skipped"}),
    };
    const filter = status ? {...scope, status} : scope;
    // Batch items keep their batch order (enqueued together, newest trace first).
    const rows = await ObsReviewItem.find(filter).sort({_id: 1, enqueuedAt: 1});
    const data: ReviewListItem[] = [];
    for (const row of rows) {
      if (!row.traceId) {
        data.push(this.toListItem(row, DATASET_ITEM_NAME));
        continue;
      }
      const trace = await registerObsTrace().findOneOrNone({_id: row.traceId});
      data.push(this.toListItem(row, trace?.name ?? "Unknown trace", trace?.prompts[0]?.name));
    }
    return {counts, data};
  }

  async getDetail(id: string): Promise<{
    batchId?: string;
    batchName?: string;
    comment?: string;
    datasetItemId?: string;
    dimensions: EvaluatorDimension[];
    evaluatorId: string;
    id: string;
    instructions?: string;
    panels: ReviewPanels;
    rawInput?: unknown;
    rawOutput?: unknown;
    scores?: Record<string, boolean | number | string>;
    status: ReviewStatus;
    traceId?: string;
  }> {
    const item = await registerObsReviewItem().findOneOrNone({_id: objectId(id, "id")});
    if (!item) {
      throw new APIError({status: 404, title: `Unknown review item "${id}"`});
    }
    const evaluator = await registerObsEvaluator().findOneOrNone({_id: item.evaluatorId});
    if (!evaluator) {
      throw new APIError({status: 404, title: "Unknown evaluator"});
    }
    const trace = item.traceId
      ? await registerObsTrace().findOneOrNone({_id: item.traceId})
      : undefined;
    const batch = item.batchId
      ? await registerObsReviewBatch().findOneOrNone({_id: item.batchId})
      : undefined;
    let input = trace?.input;
    let output = trace?.output;
    let variables:
      | {key: string; label?: string; required: boolean; reviewerNote?: string}[]
      | undefined;
    let outputFieldNotes: Record<string, string> | undefined;
    let outputSchema: Record<string, unknown> | undefined;
    // A dataset item without a (surviving) source trace shows its own input and expected output.
    if (!trace && item.datasetItemId) {
      const datasetItem = await registerObsDatasetItem().findOneOrNone({
        _id: item.datasetItemId,
      });
      if (datasetItem) {
        const subject = (await loadDatasetItemSubjects([datasetItem])).get(String(datasetItem._id));
        input = subject?.input;
        output = subject?.output;
        const dataset = await registerObsDataset().findOneOrNone({_id: datasetItem.datasetId});
        if (dataset?.inputSchemaPromptName) {
          const prompt = await registerObsPrompt().findOneOrNone({
            name: dataset.inputSchemaPromptName,
          });
          const label = prompt
            ? await registerObsPromptLabel().findOneOrNone({
                label: "production",
                promptId: prompt._id,
              })
            : undefined;
          const version = label
            ? await registerObsPromptVersion().findOneOrNone({_id: label.versionId})
            : undefined;
          variables = version?.variables;
          outputFieldNotes = version?.outputFieldNotes;
          outputSchema = version?.outputSchema;
        }
      }
    }
    const promptRef = trace?.prompts[0];
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
      batchId: batch ? String(batch._id) : undefined,
      batchName: batch?.name,
      comment: item.comment,
      datasetItemId: item.datasetItemId ? String(item.datasetItemId) : undefined,
      dimensions: evaluator.dimensions,
      evaluatorId: String(evaluator._id),
      id: String(item._id),
      instructions: evaluator.instructions,
      panels: buildReviewPanels({input, output, outputFieldNotes, outputSchema, variables}),
      rawInput: input,
      rawOutput: output,
      scores: item.scores,
      status: item.status,
      traceId: item.traceId ? String(item.traceId) : undefined,
    };
  }

  async submit(params: {
    comment?: string;
    id: string;
    scores: Record<string, boolean | number | string>;
    sinks: ScoreSink[];
    /** Reviewer, recorded on the dataset item's human answers. */
    userId?: string;
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
    const traceId = item.traceId;
    // Scores attach to traces, so a dataset item without a trace only records human answers.
    for (const dimension of traceId ? evaluator.dimensions : []) {
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
        traceId: String(traceId),
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
    if (item.datasetItemId) {
      await writeHumanAnswer({
        datasetItemId: item.datasetItemId,
        evaluator,
        reviewItemId: String(item._id),
        scores: params.scores,
        userId: params.userId,
      });
    }
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
      batchId?: mongoose.Types.ObjectId;
      datasetItemId?: mongoose.Types.ObjectId;
      enqueuedAt: Date;
      evaluatorId: mongoose.Types.ObjectId;
      reason: string;
      status: ReviewStatus;
      traceId?: mongoose.Types.ObjectId;
    },
    traceName: string,
    promptName?: string
  ): ReviewListItem {
    return {
      assigneeId: row.assigneeId ? String(row.assigneeId) : undefined,
      batchId: row.batchId ? String(row.batchId) : undefined,
      datasetItemId: row.datasetItemId ? String(row.datasetItemId) : undefined,
      enqueuedAt: toIso(row.enqueuedAt),
      evaluatorId: String(row.evaluatorId),
      id: String(row._id),
      promptName,
      reason: row.reason,
      status: row.status,
      traceId: row.traceId ? String(row.traceId) : undefined,
      traceName,
    };
  }
}
