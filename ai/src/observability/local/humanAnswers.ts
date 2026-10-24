import {APIError} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {
  ObsDatasetHumanAnswer,
  ObsDatasetItemDocument,
  ObsEvaluatorDocument,
} from "../../types/observability";
import {questionSetFingerprint} from "../questionFingerprint";
import {registerObsDatasetItem} from "./models/obsDatasetItem";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsReviewBatch} from "./models/obsReviewBatch";
import {registerObsTrace} from "./models/obsTrace";

/** How far one question set has judged a dataset. */
export interface DatasetJudgmentSummary {
  /** Items with any answer from this question set. */
  answered: number;
  /** Answers whose fingerprint matches the question set's questions now. */
  current: number;
  evaluatorId: string;
  evaluatorName: string;
  /** Answers given to an older version of the questions. */
  stale: number;
  total: number;
}

export interface DatasetHumanAnswerView {
  answeredAt: string;
  fingerprint: string;
  reviewItemId: string;
  scores: Record<string, boolean | number | string>;
  userId?: string;
}

/** What reviewers (and judges) see for a dataset item: the source trace when it has one. */
export interface DatasetItemSubject {
  input?: unknown;
  output?: unknown;
  traceId?: string;
  traceName?: string;
}

export interface CurrentHumanAnswers {
  fingerprint: string;
  items: Array<{answer: ObsDatasetHumanAnswer; item: ObsDatasetItemDocument}>;
  questionSet: ObsEvaluatorDocument;
}

const toObjectId = (value: string | mongoose.Types.ObjectId, label: string) => {
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    throw new APIError({status: 400, title: `${label} must be an object id`});
  }
  return new mongoose.Types.ObjectId(String(value));
};

export const toHumanAnswerViews = (
  answers?: Record<string, ObsDatasetHumanAnswer>
): Record<string, DatasetHumanAnswerView> | undefined => {
  if (!answers) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(answers).map(([evaluatorId, answer]) => {
      return [
        evaluatorId,
        {
          answeredAt: DateTime.fromJSDate(new Date(answer.answeredAt)).toUTC().toISO() ?? "",
          fingerprint: answer.fingerprint,
          reviewItemId: answer.reviewItemId,
          scores: answer.scores,
          userId: answer.userId,
        },
      ];
    })
  );
};

/** Record (or replace) one question set's answers on a dataset item. */
export const writeHumanAnswer = async (params: {
  datasetItemId: mongoose.Types.ObjectId;
  evaluator: Pick<ObsEvaluatorDocument, "_id" | "dimensions">;
  reviewItemId: string;
  scores: Record<string, boolean | number | string>;
  userId?: string;
}): Promise<void> => {
  const item = await registerObsDatasetItem().findOneOrNone({_id: params.datasetItemId});
  if (!item) {
    return;
  }
  const entry: ObsDatasetHumanAnswer = {
    answeredAt: DateTime.utc().toJSDate(),
    fingerprint: questionSetFingerprint(params.evaluator.dimensions),
    reviewItemId: params.reviewItemId,
    scores: params.scores,
    ...(params.userId ? {userId: params.userId} : {}),
  };
  item.humanAnswers = {...(item.humanAnswers ?? {}), [String(params.evaluator._id)]: entry};
  item.markModified("humanAnswers");
  await item.save();
};

/** Subjects for dataset items, keyed by item id: the source trace when it still exists. */
export const loadDatasetItemSubjects = async (
  items: Pick<ObsDatasetItemDocument, "_id" | "expectedOutput" | "input" | "sourceTraceId">[]
): Promise<Map<string, DatasetItemSubject>> => {
  const traceIds = items.flatMap((item) => (item.sourceTraceId ? [item.sourceTraceId] : []));
  const traces = traceIds.length > 0 ? await registerObsTrace().find({_id: {$in: traceIds}}) : [];
  const traceById = new Map(
    traces.map((trace) => {
      return [String(trace._id), trace];
    })
  );
  return new Map(
    items.map((item) => {
      const trace = item.sourceTraceId ? traceById.get(String(item.sourceTraceId)) : undefined;
      const subject: DatasetItemSubject = trace
        ? {
            input: trace.input,
            output: trace.output,
            traceId: String(trace._id),
            traceName: trace.name,
          }
        : {input: item.input, output: item.expectedOutput};
      return [String(item._id), subject];
    })
  );
};

/** Dataset items whose answers from this question set match its current questions. */
export const loadCurrentHumanAnswers = async (params: {
  datasetId: string | mongoose.Types.ObjectId;
  questionSetId: string | mongoose.Types.ObjectId;
}): Promise<CurrentHumanAnswers> => {
  const questionSet = await registerObsEvaluator().findOneOrNone({
    _id: toObjectId(params.questionSetId, "questionSetId"),
  });
  if (!questionSet) {
    throw new APIError({status: 404, title: "Unknown question set"});
  }
  const fingerprint = questionSetFingerprint(questionSet.dimensions);
  const key = String(questionSet._id);
  const rows = await registerObsDatasetItem()
    .find({datasetId: toObjectId(params.datasetId, "datasetId")})
    .sort({_id: 1});
  const items = rows.flatMap((item) => {
    const answer = item.humanAnswers?.[key];
    return answer && answer.fingerprint === fingerprint ? [{answer, item}] : [];
  });
  return {fingerprint, items, questionSet};
};

/**
 * Per-dataset judgment summaries: one row per question set that answered any item or has a
 * review batch built from the dataset.
 */
export const summarizeDatasetJudgments = async (
  datasetIds: mongoose.Types.ObjectId[]
): Promise<Map<string, DatasetJudgmentSummary[]>> => {
  const result = new Map<string, DatasetJudgmentSummary[]>();
  if (datasetIds.length === 0) {
    return result;
  }
  const items = await registerObsDatasetItem()
    .find({datasetId: {$in: datasetIds}})
    .select({datasetId: 1, humanAnswers: 1});
  const batches = await registerObsReviewBatch()
    .find({datasetId: {$in: datasetIds}})
    .select({datasetId: 1, evaluatorId: 1});
  const evaluatorIdsByDataset = new Map<string, Set<string>>();
  const addEvaluator = (datasetId: string, evaluatorId: string): void => {
    const ids = evaluatorIdsByDataset.get(datasetId) ?? new Set<string>();
    ids.add(evaluatorId);
    evaluatorIdsByDataset.set(datasetId, ids);
  };
  for (const item of items) {
    for (const evaluatorId of Object.keys(item.humanAnswers ?? {})) {
      addEvaluator(String(item.datasetId), evaluatorId);
    }
  }
  for (const batch of batches) {
    addEvaluator(String(batch.datasetId), String(batch.evaluatorId));
  }
  const allEvaluatorIds = [
    ...new Set([...evaluatorIdsByDataset.values()].flatMap((ids) => [...ids])),
  ]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const evaluators = await registerObsEvaluator().find({_id: {$in: allEvaluatorIds}});
  const evaluatorById = new Map(
    evaluators.map((evaluator) => {
      return [
        String(evaluator._id),
        {fingerprint: questionSetFingerprint(evaluator.dimensions), name: evaluator.name},
      ];
    })
  );
  for (const datasetId of datasetIds) {
    const key = String(datasetId);
    const datasetItems = items.filter((item) => String(item.datasetId) === key);
    const summaries: DatasetJudgmentSummary[] = [];
    for (const evaluatorId of evaluatorIdsByDataset.get(key) ?? []) {
      const evaluator = evaluatorById.get(evaluatorId);
      if (!evaluator) {
        continue;
      }
      let answered = 0;
      let current = 0;
      for (const item of datasetItems) {
        const answer = item.humanAnswers?.[evaluatorId];
        if (!answer) {
          continue;
        }
        answered += 1;
        if (answer.fingerprint === evaluator.fingerprint) {
          current += 1;
        }
      }
      summaries.push({
        answered,
        current,
        evaluatorId,
        evaluatorName: evaluator.name,
        stale: answered - current,
        total: datasetItems.length,
      });
    }
    summaries.sort((left, right) => left.evaluatorName.localeCompare(right.evaluatorName));
    result.set(key, summaries);
  }
  return result;
};
