import {describe, expect, it, mock} from "bun:test";
import {freezeTime} from "../time/freezeTime";
import {waitForCalls, waitUntil} from "./waitUntil";

describe("waitUntil", () => {
  it("resolves once an async predicate turns true", async () => {
    let attempts = 0;
    await waitUntil(async () => {
      attempts += 1;
      return attempts >= 3;
    });
    expect(attempts).toBe(3);
  });

  it("throws with the label and elapsed time on timeout", async () => {
    await expect(
      waitUntil(() => false, {intervalMs: 5, label: "the socket", timeoutMs: 30})
    ).rejects.toThrow(/waitUntil timed out after \d+ms waiting for: the socket/);
  });

  it("omits the label suffix when no label is given", async () => {
    await expect(waitUntil(() => false, {intervalMs: 5, timeoutMs: 10})).rejects.toThrow(
      /timed out after \d+ms$/
    );
  });

  it("keeps polling while the clock is frozen", async () => {
    freezeTime("2024-06-01T10:30:00Z");
    let isReady = false;
    setTimeout(() => {
      isReady = true;
    }, 20);
    await waitUntil(() => isReady, {timeoutMs: 500});
    expect(isReady).toBe(true);
  });
});

describe("waitForCalls", () => {
  it("resolves after the mock reaches the call count", async () => {
    const fn = mock(() => undefined);
    setTimeout(() => {
      fn();
      fn();
    }, 10);
    await waitForCalls(fn, 2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("names the current call count when it times out", async () => {
    const fn = mock(() => undefined);
    fn();
    await expect(waitForCalls(fn, 3, {intervalMs: 5, timeoutMs: 20})).rejects.toThrow(
      "mock to be called 3 time(s) (called 1)"
    );
  });
});
