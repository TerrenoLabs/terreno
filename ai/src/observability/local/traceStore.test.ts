import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import type {ScoreRecord, TraceRecord} from "../types";
import {createLocalObservabilityPlugin} from "./localPlugin";
import {registerObsScore} from "./models/obsScore";
import {registerObsSpan} from "./models/obsSpan";
import {registerObsTrace} from "./models/obsTrace";
import {LocalTraceSink, LocalTraceStore, MemoryScoreSink, MemoryTraceSink} from "./traceStore";

const iso = (msAgo: number): string => {
  return DateTime.utc().minus({milliseconds: msAgo}).toISO() ?? "";
};

const baseTrace = (overrides: Partial<TraceRecord> = {}): TraceRecord => {
  return {
    endedAt: iso(0),
    id: "trace-root",
    name: "generate",
    prompts: [{name: "summarize", version: 1}],
    sensitive: false,
    spans: [
      {
        durationMs: 12,
        endedAt: iso(0),
        id: "span-root",
        kind: "LLM",
        name: "generate",
        startedAt: iso(12),
        status: "ok",
        usage: {inputTokens: 5, model: "mock-model", outputTokens: 10},
      },
    ],
    startedAt: iso(12),
    status: "ok",
    ...overrides,
  };
};

describe("LocalTraceStore", () => {
  let store: LocalTraceStore;

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    new ObservabilityApp({plugins: [createLocalObservabilityPlugin()]});
    store = new LocalTraceStore();
    await registerObsTrace().deleteMany({});
    await registerObsSpan().deleteMany({});
    await registerObsScore().deleteMany({});
  });

  it("round-trips nested spans and derives errorSummary from the first error span", async () => {
    const exported = await store.exportTrace(
      baseTrace({
        prompts: [
          {label: "production", name: "summarize", version: 1},
          {name: "title", version: 2},
        ],
        spans: [
          {
            durationMs: 40,
            id: "parent",
            kind: "CHAIN",
            name: "agent",
            startedAt: iso(40),
            status: "ok",
          },
          {
            durationMs: 10,
            error: "tool timed out",
            id: "child",
            kind: "TOOL",
            name: "search",
            parentSpanId: "parent",
            startedAt: iso(20),
            startOffsetMs: 8,
            status: "error",
          },
        ],
        status: "error",
      })
    );

    const detail = await store.getDetail(exported.id);
    expect(detail.prompts).toHaveLength(2);
    expect(detail.errorSummary).toBe("tool timed out");
    expect(detail.spans).toEqual([
      expect.objectContaining({
        children: [
          expect.objectContaining({
            error: "tool timed out",
            kind: "TOOL",
            name: "search",
            startOffsetMs: 8,
            status: "error",
          }),
        ],
        kind: "CHAIN",
        name: "agent",
      }),
    ]);
  });

  it("omits costUsd when the exported usage has no price", async () => {
    const exported = await store.exportTrace(
      baseTrace({
        usage: {inputTokens: 5, model: "unpriced", outputTokens: 10},
      })
    );
    const detail = await store.getDetail(exported.id);
    expect(detail.usage).toEqual({inputTokens: 5, model: "unpriced", outputTokens: 10});
    expect("costUsd" in (detail.usage ?? {})).toBe(false);
  });

  it("applies list filters, pagination, and hasScore", async () => {
    const userId = new mongoose.Types.ObjectId();
    const older = await store.exportTrace(
      baseTrace({
        flaggedForDataset: true,
        name: "old",
        sessionId: "sess-a",
        startedAt: iso(86_400_000),
        userId: userId.toString(),
      })
    );
    const newer = await store.exportTrace(
      baseTrace({
        name: "new",
        prompts: [{name: "other", version: 1}],
        sensitive: true,
        sessionId: "sess-b",
        startedAt: iso(1_000),
        status: "error",
        userId: new mongoose.Types.ObjectId().toString(),
      })
    );
    await store.exportScore({
      dataType: "boolean",
      name: "correct",
      source: "human",
      traceId: older.id,
      value: true,
    });

    const byPrompt = await store.list({prompt: "summarize"});
    expect(byPrompt.data.map((row) => row.id)).toEqual([older.id]);

    const byStatus = await store.list({status: "error"});
    expect(byStatus.data.map((row) => row.id)).toEqual([newer.id]);

    const byUser = await store.list({userId: userId.toString()});
    expect(byUser.data.map((row) => row.id)).toEqual([older.id]);

    const bySession = await store.list({sessionId: "sess-b"});
    expect(bySession.data.map((row) => row.id)).toEqual([newer.id]);

    const bySensitive = await store.list({sensitive: true});
    expect(bySensitive.data.map((row) => row.id)).toEqual([newer.id]);

    const byFlag = await store.list({flaggedForDataset: true});
    expect(byFlag.data.map((row) => row.id)).toEqual([older.id]);

    const scored = await store.list({hasScore: true});
    expect(scored.data.map((row) => row.id)).toEqual([older.id]);
    expect(scored.data[0]?.spanCount).toBe(1);
    expect(scored.data[0]?.scoreCount).toBe(1);

    const unscored = await store.list({hasScore: false});
    expect(unscored.data.map((row) => row.id)).toEqual([newer.id]);

    const since = DateTime.utc().minus({hours: 1}).toISO() ?? "";
    const recent = await store.list({from: since});
    expect(recent.data.map((row) => row.id)).toEqual([newer.id]);

    const until = DateTime.utc().minus({hours: 12}).toISO() ?? "";
    const olderWindow = await store.list({to: until});
    expect(olderWindow.data.map((row) => row.id)).toEqual([older.id]);

    const page = await store.list({limit: 1, page: 2});
    expect(page.meta).toEqual({limit: 1, page: 2, total: 2});
    expect(page.data).toHaveLength(1);

    const byPromptVersion = await store.list({prompt: "summarize", promptVersion: 2});
    expect(byPromptVersion.data).toHaveLength(0);
    await store.exportTrace(
      baseTrace({
        name: "summarize-v2",
        prompts: [{name: "summarize", version: 2}],
        startedAt: iso(500),
      })
    );
    const v2Only = await store.list({prompt: "summarize", promptVersion: 2});
    expect(v2Only.data.map((row) => row.name)).toEqual(["summarize-v2"]);
    const v1Only = await store.list({prompt: "summarize", promptVersion: 1});
    expect(v1Only.data.map((row) => row.id)).toEqual([older.id]);
  });

  it("returns score metadata on trace detail and exports through the sink wrapper", async () => {
    const exported = await store.exportTrace(baseTrace());
    await store.exportScore({
      comment: "looks good",
      confidence: 0.9,
      dataType: "numeric",
      evaluatorId: new mongoose.Types.ObjectId().toString(),
      name: "quality",
      source: "human",
      spanId: "span-root",
      traceId: exported.id,
      value: 5,
    });

    const detail = await store.getDetail(exported.id);
    expect(detail.scores).toEqual([
      expect.objectContaining({
        comment: "looks good",
        confidence: 0.9,
        dataType: "numeric",
        name: "quality",
        source: "human",
        traceId: exported.id,
        value: 5,
      }),
    ]);

    const sink = new LocalTraceSink(store);
    await sink.export(baseTrace({name: "sink"}));
    expect(sink.store).toBe(store);
    const listed = await store.list({limit: 10});
    const sinkRow = listed.data.find((row) => row.name === "sink");
    expect(sinkRow).toBeDefined();
    const sinkDetail = await store.getDetail(sinkRow!.id);
    expect(sinkDetail.name).toBe("sink");
  });

  it("throws when loading an unknown trace", async () => {
    await expect(store.getDetail(new mongoose.Types.ObjectId().toString())).rejects.toThrow(
      /Unknown trace/
    );
  });

  it("buffers exported traces and scores in memory sinks", async () => {
    const trace = baseTrace({id: "memory-trace"});
    const score: ScoreRecord = {
      dataType: "boolean",
      name: "correct",
      source: "human",
      traceId: "memory-trace",
      value: true,
    };
    const traceSink = new MemoryTraceSink();
    const scoreSink = new MemoryScoreSink();

    await traceSink.export(trace);
    await scoreSink.export(score);

    expect(traceSink.traces).toEqual([trace]);
    expect(scoreSink.scores).toEqual([score]);
  });
});
