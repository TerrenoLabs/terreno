import type {EvaluatorDimension} from "../types/observability";

export type ScoreValue = boolean | number | string;

/**
 * Answers for one reviewed item. Human and judge answers pair up by `datasetItemId` when set,
 * otherwise by `traceId`.
 */
export interface AgreementAnswerSet {
  datasetItemId?: string;
  scores?: Record<string, ScoreValue>;
  traceId?: string;
}

export interface JudgeAnswerSet extends AgreementAnswerSet {
  error?: string;
}

export interface JudgeQuestionAgreement {
  compared: number;
  /** False when the judge does not answer this question, so it is left out of the totals. */
  covered: boolean;
  key: string;
  matches: number;
  question?: string;
  rate?: number;
}

export interface JudgeDisagreement {
  datasetItemId?: string;
  human: ScoreValue;
  judge?: ScoreValue;
  key: string;
  traceId?: string;
}

export interface JudgeAgreement {
  compared: number;
  disagreements: JudgeDisagreement[];
  errors: number;
  itemsCompared: number;
  matches: number;
  questions: JudgeQuestionAgreement[];
  rate?: number;
}

// Numeric answers agree when they land within this share of the dimension's range.
const NUMERIC_TOLERANCE = 0.1;

const numericSpan = (range?: string): number => {
  const matches = range?.match(/(-?\d+(?:\.\d+)?)\s*(?:-|\.\.)\s*(-?\d+(?:\.\d+)?)/);
  if (!matches) {
    return 1;
  }
  const span = Math.abs(Number(matches[2]) - Number(matches[1]));
  return span > 0 ? span : 1;
};

const toBoolean = (value: ScoreValue): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "yes") {
    return true;
  }
  if (value === "false" || value === "no") {
    return false;
  }
  return undefined;
};

/** True when a judge answer counts as the same answer a human gave for this dimension. */
export const answersAgree = (
  dimension: EvaluatorDimension,
  human: ScoreValue,
  judge: ScoreValue | undefined
): boolean => {
  if (judge === undefined) {
    return false;
  }
  if (dimension.dataType === "boolean") {
    const humanBool = toBoolean(human);
    return humanBool !== undefined && humanBool === toBoolean(judge);
  }
  if (dimension.dataType === "numeric") {
    const humanNumber = Number(human);
    const judgeNumber = Number(judge);
    if (Number.isNaN(humanNumber) || Number.isNaN(judgeNumber)) {
      return false;
    }
    return (
      Math.abs(humanNumber - judgeNumber) <= numericSpan(dimension.range) * NUMERIC_TOLERANCE + 1e-9
    );
  }
  return String(human).trim().toLowerCase() === String(judge).trim().toLowerCase();
};

/** Key that pairs human and judge answers for the same item. */
export const agreementAnswerKey = (answer: AgreementAnswerSet): string => {
  return answer.datasetItemId ? `item:${answer.datasetItemId}` : `trace:${answer.traceId ?? ""}`;
};

const rateOf = (matches: number, compared: number): number | undefined => {
  return compared > 0 ? matches / compared : undefined;
};

/**
 * Compare one judge's answers with human answers for the same traces or dataset items. Only questions the judge
 * answers (judgeKeys) count; a judge error or a missing answer counts as a disagreement.
 */
export const computeJudgeAgreement = (params: {
  dimensions: EvaluatorDimension[];
  humanAnswers: AgreementAnswerSet[];
  judgeAnswers: JudgeAnswerSet[];
  judgeKeys: string[];
}): JudgeAgreement => {
  const judgeKeys = new Set(params.judgeKeys);
  const judgeByKey = new Map(
    params.judgeAnswers.map((answer) => {
      return [agreementAnswerKey(answer), answer];
    })
  );
  const questions: JudgeQuestionAgreement[] = params.dimensions.map((dimension) => {
    return {
      compared: 0,
      covered: judgeKeys.has(dimension.key),
      key: dimension.key,
      matches: 0,
      question: dimension.question,
    };
  });
  const disagreements: JudgeDisagreement[] = [];
  let itemsCompared = 0;
  let errors = 0;

  for (const human of params.humanAnswers) {
    const judge = judgeByKey.get(agreementAnswerKey(human));
    if (!judge || !human.scores) {
      continue;
    }
    let comparedThisItem = false;
    if (judge.error) {
      errors += 1;
    }
    params.dimensions.forEach((dimension, index) => {
      const humanValue = human.scores?.[dimension.key];
      const question = questions[index];
      if (!question?.covered || humanValue === undefined) {
        return;
      }
      comparedThisItem = true;
      question.compared += 1;
      const judgeValue = judge.error ? undefined : judge.scores?.[dimension.key];
      if (answersAgree(dimension, humanValue, judgeValue)) {
        question.matches += 1;
        return;
      }
      disagreements.push({
        ...(human.datasetItemId ? {datasetItemId: human.datasetItemId} : {}),
        human: humanValue,
        judge: judgeValue,
        key: dimension.key,
        ...(human.traceId ? {traceId: human.traceId} : {}),
      });
    });
    if (comparedThisItem) {
      itemsCompared += 1;
    }
  }

  const compared = questions.reduce((total, question) => total + question.compared, 0);
  const matches = questions.reduce((total, question) => total + question.matches, 0);
  return {
    compared,
    disagreements,
    errors,
    itemsCompared,
    matches,
    questions: questions.map((question) => {
      return {...question, rate: rateOf(question.matches, question.compared)};
    }),
    rate: rateOf(matches, compared),
  };
};
