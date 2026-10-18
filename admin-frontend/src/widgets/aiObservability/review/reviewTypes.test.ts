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
});
