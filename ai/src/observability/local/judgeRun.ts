import type {EvaluatorDimension, ObsEvaluatorDocument} from "../../types/observability";
import {type EvaluatorAiClient, runLlmJudgeEvaluator} from "../evaluate";
import {
  type AgreementAnswerSet,
  agreementAnswerKey,
  answersAgree,
  computeJudgeAgreement,
  type JudgeAgreement,
  type ScoreValue,
} from "../judgeAgreement";

export const DEFAULT_JUDGE_CONCURRENCY = 5;

/** What a judge sees for one item, and the ids that pair it with the human answer. */
export interface JudgeRunSubject {
  datasetItemId?: string;
  input?: unknown;
  output?: unknown;
  traceId?: string;
}

/** The judge prompt version to run: its output schema and, when pinned, its system text. */
export interface JudgeRunPrompt {
  outputSchema: Record<string, unknown>;
  /** Version body sent as the system prompt; unset sends the judge's prompt name instead. */
  system?: string;
}

export interface JudgeRunItemResult {
  confidence?: number;
  datasetItemId?: string;
  /** True when a human answered a compared question and the judge failed or answered differently. */
  disagrees: boolean;
  error?: string;
  /** Index of the subject in the input list. */
  index: number;
  scores?: Record<string, ScoreValue>;
  traceId?: string;
}

export interface JudgeRunResult {
  agreement: JudgeAgreement;
  results: JudgeRunItemResult[];
}

/** Agreement between human answers and (possibly partial) judge results from this pipeline. */
export const agreementForResults = (params: {
  dimensions: EvaluatorDimension[];
  humanAnswers: AgreementAnswerSet[];
  judge: Pick<ObsEvaluatorDocument, "dimensions">;
  results: JudgeRunItemResult[];
}): JudgeAgreement => {
  return computeJudgeAgreement({
    dimensions: params.dimensions,
    humanAnswers: params.humanAnswers,
    judgeAnswers: params.results.map((result) => {
      return {
        datasetItemId: result.datasetItemId,
        error: result.error,
        scores: result.scores,
        traceId: result.traceId,
      };
    }),
    judgeKeys: params.judge.dimensions.map((dimension) => dimension.key),
  });
};

// Run async work with a fixed number in flight, keeping input order in the result.
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({length: Math.min(Math.max(limit, 1), items.length)}, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
};

/**
 * Run one judge prompt version over every subject and compare its answers with the human
 * answers for the same items. Review-batch judge runs and judge experiments both go through
 * here, so judge errors and disagreements are scored the same way everywhere.
 */
export const runJudgeAgainstHumans = async (params: {
  ai: EvaluatorAiClient;
  concurrency?: number;
  /** Question set dimensions the humans answered. */
  dimensions: EvaluatorDimension[];
  humanAnswers: AgreementAnswerSet[];
  judge: Pick<ObsEvaluatorDocument, "dimensions" | "judgePromptName" | "name" | "type">;
  /** Called once per subject in input order, never concurrently. */
  onResult?: (result: JudgeRunItemResult) => Promise<void> | void;
  prompt: JudgeRunPrompt;
  subjects: JudgeRunSubject[];
}): Promise<JudgeRunResult> => {
  const judgeKeys = params.judge.dimensions.map((dimension) => dimension.key);
  const comparedDimensions = params.dimensions.filter((dimension) => {
    return judgeKeys.includes(dimension.key);
  });
  const humanByKey = new Map(
    params.humanAnswers.map((answer) => {
      return [agreementAnswerKey(answer), answer];
    })
  );

  // Results are reported in input order, so buffer finished ones until their turn comes.
  const finished: Array<JudgeRunItemResult | undefined> = new Array(params.subjects.length);
  let nextToReport = 0;
  let reporting: Promise<void> = Promise.resolve();
  const report = async (): Promise<void> => {
    while (nextToReport < finished.length && finished[nextToReport]) {
      const result = finished[nextToReport] as JudgeRunItemResult;
      nextToReport += 1;
      await params.onResult?.(result);
    }
  };

  const results = await mapWithConcurrency(
    params.subjects,
    params.concurrency ?? DEFAULT_JUDGE_CONCURRENCY,
    async (subject, index) => {
      const run = await runLlmJudgeEvaluator(
        {
          evaluator: {
            dimensions: params.judge.dimensions,
            judgePromptName: params.judge.judgePromptName,
            name: params.judge.name,
            type: params.judge.type,
          },
          input: subject.input,
          output: subject.output,
        },
        params.ai,
        params.prompt.outputSchema,
        params.prompt.system === undefined ? {} : {judgeSystemPrompt: params.prompt.system}
      );
      const ids = {
        ...(subject.datasetItemId ? {datasetItemId: subject.datasetItemId} : {}),
        ...(subject.traceId ? {traceId: subject.traceId} : {}),
      };
      const human = humanByKey.get(agreementAnswerKey(ids));
      // Same rule as computeJudgeAgreement: an errored judge answers nothing.
      const disagrees = comparedDimensions.some((dimension) => {
        const humanValue = human?.scores?.[dimension.key];
        if (humanValue === undefined) {
          return false;
        }
        const judgeValue = run.error ? undefined : run.scores?.[dimension.key];
        return !answersAgree(dimension, humanValue, judgeValue);
      });
      const result: JudgeRunItemResult = {
        ...ids,
        confidence: run.confidence,
        disagrees,
        error: run.error,
        index,
        scores: run.scores,
      };
      finished[index] = result;
      reporting = reporting.then(report);
      await reporting;
      return result;
    }
  );
  await reporting;

  return {
    agreement: agreementForResults({
      dimensions: params.dimensions,
      humanAnswers: params.humanAnswers,
      judge: params.judge,
      results,
    }),
    results,
  };
};
