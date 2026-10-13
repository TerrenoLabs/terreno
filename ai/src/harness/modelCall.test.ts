import {describe, expect, it, mock} from "bun:test";
import {APICallError, type LanguageModel} from "ai";

import {callModelWithFallback, HarnessModelCallError, isRetryableModelError} from "./modelCall";

const httpError = (statusCode?: number, isRetryable = false): APICallError =>
  new APICallError({
    isRetryable,
    message: `HTTP ${statusCode ?? "none"}`,
    requestBodyValues: {},
    statusCode,
    url: "https://mock.invalid",
  });

const fakeModel = (id: string): LanguageModel => id as unknown as LanguageModel;
const resolveModel = ({modelId}: {modelId: string}): LanguageModel => fakeModel(modelId);
const A = {modelId: "a", provider: "p"};
const B = {modelId: "b", provider: "p"};

describe("isRetryableModelError", () => {
  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [404, false],
    // 408 is often retried elsewhere; here every 4xx but 429 means "this request is wrong".
    [408, false],
  ])("HTTP %d -> %p", (status, expected) => {
    expect(isRetryableModelError(httpError(status, true))).toBe(expected);
  });

  it("uses the SDK's retryable flag when there is no status code", () => {
    expect(isRetryableModelError(httpError(undefined, true))).toBe(true);
    expect(isRetryableModelError(httpError(undefined, false))).toBe(false);
  });

  it("retries network failures and nothing else", () => {
    expect(isRetryableModelError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableModelError(Object.assign(new Error("reset"), {code: "ECONNRESET"}))).toBe(
      true
    );
    expect(isRetryableModelError(new Error("wrapped", {cause: {code: "ETIMEDOUT"}}))).toBe(true);
    expect(isRetryableModelError(new Error("bad prompt"))).toBe(false);
    expect(isRetryableModelError("boom")).toBe(false);
  });
});

describe("callModelWithFallback", () => {
  it("returns the first success with every attempt recorded", async () => {
    let tries = 0;
    const call = mock(async (model: LanguageModel) => {
      tries += 1;
      if (tries <= 2) {
        throw httpError(502, true);
      }
      return `answer from ${String(model)}`;
    });
    const result = await callModelWithFallback({
      call,
      models: [A, B],
      resolveModel,
      retry: {backoffMs: 0},
    });
    expect(result.result).toBe("answer from a");
    expect(result.model).toEqual(A);
    expect(result.attempts.map(({attempt, statusCode}) => [attempt, statusCode])).toEqual([
      [1, 502],
      [2, 502],
      [3, undefined],
    ]);
  });

  it("throws HarnessModelCallError once every model is exhausted", async () => {
    const error = await callModelWithFallback({
      call: async () => {
        throw httpError(503, true);
      },
      models: [A, B],
      resolveModel,
      retry: {backoffMs: 0, maxAttempts: 2},
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HarnessModelCallError);
    expect((error as HarnessModelCallError).message).toBe(
      "Model call failed after 4 attempts across p/a, p/b: HTTP 503"
    );
    expect((error as HarnessModelCallError).attempts).toHaveLength(4);
    expect((error as HarnessModelCallError).cause).toBeInstanceOf(APICallError);
  });

  it("stops waiting out a backoff as soon as the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("turn aborted");
    const call = mock(async () => {
      setTimeout(() => controller.abort(reason), 10);
      throw httpError(503, true);
    });
    const error = await callModelWithFallback({
      call,
      models: [A],
      resolveModel,
      retry: {backoffMs: 60_000, maxBackoffMs: 60_000},
      signal: controller.signal,
    }).catch((caught: unknown) => caught);
    expect(error).toBe(reason);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("rethrows the abort reason when the call fails because the signal aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("aborted mid-call");
    const error = await callModelWithFallback({
      call: async () => {
        controller.abort(reason);
        throw new Error("The operation was aborted");
      },
      models: [A],
      resolveModel,
      signal: controller.signal,
    }).catch((caught: unknown) => caught);
    expect(error).toBe(reason);
  });

  it("does not call a model when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already"));
    const call = mock(async () => "never");
    await expect(
      callModelWithFallback({call, models: [A], resolveModel, signal: controller.signal})
    ).rejects.toThrow("already");
    expect(call).toHaveBeenCalledTimes(0);
  });
});
