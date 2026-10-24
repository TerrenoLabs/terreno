import {describe, expect, it} from "bun:test";

import type {EvaluatorDimension} from "../types/observability";
import {answersAgree, computeJudgeAgreement} from "./judgeAgreement";

const QUESTIONS: EvaluatorDimension[] = [
  {dataType: "boolean", key: "faithful", question: "Is it faithful?", required: true},
  {dataType: "boolean", key: "complete", question: "Is it complete?", required: true},
  {dataType: "numeric", key: "tone", range: "0-10", required: false},
];

describe("answersAgree", () => {
  it("matches booleans, including yes/no strings", () => {
    expect(answersAgree(QUESTIONS[0] as EvaluatorDimension, true, true)).toBe(true);
    expect(answersAgree(QUESTIONS[0] as EvaluatorDimension, true, "yes")).toBe(true);
    expect(answersAgree(QUESTIONS[0] as EvaluatorDimension, false, true)).toBe(false);
    expect(answersAgree(QUESTIONS[0] as EvaluatorDimension, true, undefined)).toBe(false);
  });

  it("allows numeric answers within 10% of the range", () => {
    const tone = QUESTIONS[2] as EvaluatorDimension;
    expect(answersAgree(tone, 7, 8)).toBe(true);
    expect(answersAgree(tone, 7, 8.5)).toBe(false);
    expect(answersAgree({...tone, range: undefined}, 0.5, 0.55)).toBe(true);
  });

  it("matches categorical answers case-insensitively", () => {
    const dimension: EvaluatorDimension = {dataType: "categorical", key: "c", required: true};
    expect(answersAgree(dimension, "Warm", " warm ")).toBe(true);
    expect(answersAgree(dimension, "warm", "cold")).toBe(false);
  });
});

describe("computeJudgeAgreement", () => {
  it("pairs answers by dataset item before trace", () => {
    const agreement = computeJudgeAgreement({
      dimensions: QUESTIONS,
      humanAnswers: [
        {datasetItemId: "item-1", scores: {faithful: false}, traceId: "shared-trace"},
        {datasetItemId: "item-2", scores: {faithful: true}},
      ],
      judgeAnswers: [
        {datasetItemId: "item-2", scores: {faithful: true}},
        {datasetItemId: "item-1", scores: {faithful: true}, traceId: "shared-trace"},
        {scores: {faithful: false}, traceId: "shared-trace"},
      ],
      judgeKeys: ["faithful"],
    });
    expect(agreement.rate).toBe(0.5);
    expect(agreement.disagreements).toEqual([
      {
        datasetItemId: "item-1",
        human: false,
        judge: true,
        key: "faithful",
        traceId: "shared-trace",
      },
    ]);
  });

  it("scores only covered questions and lists disagreements", () => {
    const agreement = computeJudgeAgreement({
      dimensions: QUESTIONS,
      humanAnswers: [
        {scores: {complete: true, faithful: true, tone: 5}, traceId: "a"},
        {scores: {complete: false, faithful: true}, traceId: "b"},
        {scores: {complete: true, faithful: false}, traceId: "unjudged"},
      ],
      judgeAnswers: [
        {scores: {complete: true, faithful: true}, traceId: "a"},
        {scores: {complete: true, faithful: true}, traceId: "b"},
      ],
      judgeKeys: ["faithful", "complete"],
    });
    expect(agreement.compared).toBe(4);
    expect(agreement.matches).toBe(3);
    expect(agreement.rate).toBe(0.75);
    expect(agreement.itemsCompared).toBe(2);
    expect(agreement.questions.map((row) => [row.key, row.covered, row.rate])).toEqual([
      ["faithful", true, 1],
      ["complete", true, 0.5],
      ["tone", false, undefined],
    ]);
    expect(agreement.disagreements).toEqual([
      {human: false, judge: true, key: "complete", traceId: "b"},
    ]);
  });

  it("counts judge errors as disagreements", () => {
    const agreement = computeJudgeAgreement({
      dimensions: QUESTIONS.slice(0, 1),
      humanAnswers: [{scores: {faithful: true}, traceId: "a"}],
      judgeAnswers: [{error: "timeout", traceId: "a"}],
      judgeKeys: ["faithful"],
    });
    expect(agreement.errors).toBe(1);
    expect(agreement.rate).toBe(0);
    expect(agreement.disagreements[0]?.judge).toBeUndefined();
  });

  it("has no rate before any human answers", () => {
    const agreement = computeJudgeAgreement({
      dimensions: QUESTIONS,
      humanAnswers: [],
      judgeAnswers: [{scores: {faithful: true}, traceId: "a"}],
      judgeKeys: ["faithful"],
    });
    expect(agreement.rate).toBeUndefined();
    expect(agreement.compared).toBe(0);
  });
});
