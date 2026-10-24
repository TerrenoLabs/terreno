import {describe, expect, it} from "bun:test";

import {questionSetFingerprint} from "./questionFingerprint";

const QUESTIONS = [
  {dataType: "boolean" as const, key: "faithful", question: "Is it faithful?", required: true},
  {dataType: "numeric" as const, key: "score", range: "1-5", required: false},
];

describe("questionSetFingerprint", () => {
  it("is a stable sha256 that ignores dimension order and the required flag", () => {
    const fingerprint = questionSetFingerprint(QUESTIONS);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(questionSetFingerprint([...QUESTIONS].reverse())).toBe(fingerprint);
    expect(
      questionSetFingerprint(QUESTIONS.map((row) => ({...row, required: !row.required})))
    ).toBe(fingerprint);
  });

  it("changes when a key, data type, question, or range changes", () => {
    const fingerprint = questionSetFingerprint(QUESTIONS);
    const [first, second] = QUESTIONS;
    const variants = [
      [{...first, key: "grounded"}, second],
      [{...first, dataType: "categorical" as const}, second],
      [{...first, question: "Is every claim backed by the input?"}, second],
      [first, {...second, range: "1-10"}],
    ];
    for (const variant of variants) {
      expect(questionSetFingerprint(variant)).not.toBe(fingerprint);
    }
  });
});
