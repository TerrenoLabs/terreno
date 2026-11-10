import {describe, it} from "bun:test";
import {assert} from "chai";
import type {ReviewDetail} from "./reviewTypes";
import {
  categoricalOptions,
  displayReviewValue,
  numericRange,
  reviewStatusLabel,
  unwrapCurrentUserId,
  unwrapReviewCounts,
  unwrapReviewDetail,
  unwrapReviewList,
  waitingLabel,
  wordCount,
} from "./reviewTypes";

const detail: ReviewDetail = {
  dimensions: [{dataType: "boolean", key: "correct", required: true}],
  evaluatorId: "eval-1",
  id: "rev-1",
  panels: {given: [], wrote: []},
  status: "pending",
  traceId: "trace-1",
};

describe("reviewTypes helpers", () => {
  it("unwraps review list payloads", () => {
    const row = {
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      evaluatorId: "eval-1",
      id: "rev-1",
      reason: "manual",
      status: "pending" as const,
      traceId: "trace-1",
      traceName: "summarize",
    };
    assert.deepEqual(unwrapReviewList([row]), [row]);
    assert.deepEqual(unwrapReviewList({data: [row]}), [row]);
    assert.deepEqual(unwrapReviewList(undefined), []);
  });

  it("unwraps review counts with defaults", () => {
    assert.deepEqual(unwrapReviewCounts({counts: {done: 1, pending: 2}}), {
      done: 1,
      in_progress: 0,
      pending: 2,
      skipped: 0,
    });
    assert.deepEqual(unwrapReviewCounts(undefined), {
      done: 0,
      in_progress: 0,
      pending: 0,
      skipped: 0,
    });
  });

  it("unwraps review detail and current user id", () => {
    assert.deepEqual(unwrapReviewDetail(detail)?.id, "rev-1");
    assert.deepEqual(unwrapReviewDetail({data: detail})?.id, "rev-1");
    assert.equal(unwrapCurrentUserId({id: "user-1"}), "user-1");
    assert.equal(unwrapCurrentUserId({data: {user: {id: "nested"}}}), "nested");
  });

  it("formats review status labels and waiting durations", () => {
    assert.equal(reviewStatusLabel("in_progress"), "In progress");
    assert.equal(reviewStatusLabel("done"), "Done");
    assert.match(waitingLabel("2026-01-01T00:00:00.000Z"), /\d+[mhd]/);
    assert.equal(waitingLabel("not-a-date"), "—");
  });

  it("counts words and displays review values", () => {
    assert.equal(wordCount("one two three"), 3);
    assert.equal(wordCount(undefined), 0);
    assert.equal(displayReviewValue(undefined), "—");
    assert.equal(displayReviewValue("plain"), "plain");
    assert.include(displayReviewValue({a: 1}), "a");
  });

  it("parses numeric ranges and categorical options", () => {
    assert.deepEqual(numericRange("0-1"), {max: 1, min: 0, step: 0.1});
    assert.deepEqual(categoricalOptions("safe|unsafe, unclear"), ["safe", "unsafe", "unclear"]);
    assert.deepEqual(categoricalOptions(undefined), []);
  });

  it("parses the first range in the same shapes the old regex accepted", () => {
    assert.deepEqual(numericRange("1..5"), {max: 5, min: 1, step: 1});
    assert.deepEqual(numericRange("Score -2.5 - 3.5 overall"), {max: 3.5, min: -2.5, step: 1});
    assert.deepEqual(numericRange("1 -5-6"), {max: 5, min: 1, step: 1});
    assert.deepEqual(numericRange("12 x 3-4"), {max: 4, min: 3, step: 0.1});
    assert.deepEqual(numericRange("1.2.3..4"), {max: 4, min: 2.3, step: 1});
    assert.deepEqual(numericRange("no range"), {max: 1, min: 0, step: 0.1});
    assert.deepEqual(numericRange("7-"), {max: 1, min: 0, step: 0.1});
    assert.deepEqual(numericRange(undefined), {max: 1, min: 0, step: 0.1});
  });

  it("matches the old regex on generated inputs", () => {
    const oldNumericRange = (range: string): {max: number; min: number} => {
      const matches = range.match(/(-?\d+(?:\.\d+)?)\s*(?:-|\.\.)\s*(-?\d+(?:\.\d+)?)/);
      return {
        max: matches?.[2] ? Number(matches[2]) : 1,
        min: matches?.[1] ? Number(matches[1]) : 0,
      };
    };
    const alphabet = ["0", "1", "9", "-", ".", " ", "a"];
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let run = 0; run < 20_000; run += 1) {
      const length = next() % 14;
      let input = "";
      for (let index = 0; index < length; index += 1) {
        input += alphabet[next() % alphabet.length];
      }
      const {max, min} = numericRange(input);
      assert.deepEqual({max, min}, oldNumericRange(input), input);
    }
  });

  it("stays fast on a long run of digits with no separator", () => {
    const start = performance.now();
    assert.deepEqual(numericRange("0".repeat(100_000)), {max: 1, min: 0, step: 0.1});
    assert.deepEqual(numericRange("0.".repeat(50_000)), {max: 1, min: 0, step: 0.1});
    assert.isBelow(performance.now() - start, 100);
  });
});
