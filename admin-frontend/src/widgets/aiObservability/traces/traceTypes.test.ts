import {describe, expect, it} from "bun:test";
import {assert} from "chai";
import {
  durationBarPercent,
  emptyTraceFilters,
  flattenSpans,
  formatCost,
  formatLatency,
  formatTokens,
  promptCountLabel,
  selectedSensitiveCount,
  stringifyIo,
  type TraceListItem,
  type TraceSpanNode,
  unwrapEvaluators,
  unwrapTraceDetail,
  unwrapTraceList,
} from "./traceTypes";

const span = (id: string, children: TraceSpanNode[] = []): TraceSpanNode => ({
  children,
  id,
  kind: "CHAIN",
  name: id,
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "ok",
});

describe("traceTypes helpers", () => {
  it("unwraps a paginated list without losing more and total", () => {
    const listed = unwrapTraceList({
      data: [{id: "a"} as TraceListItem],
      limit: 20,
      more: true,
      page: 1,
      total: 40,
    });
    expect(listed.more).toBe(true);
    expect(listed.total).toBe(40);
    expect(listed.data[0].id).toBe("a");
  });

  it("counts selected sensitive traces", () => {
    const traces = [
      {id: "a", sensitive: true},
      {id: "b", sensitive: false},
    ] as TraceListItem[];
    expect(selectedSensitiveCount(traces, ["a", "b"])).toBe(1);
  });

  it("flattens nested spans with depth", () => {
    const rows = flattenSpans([span("root", [span("child")])]);
    expect(rows.map((row) => [row.span.id, row.depth])).toEqual([
      ["root", 0],
      ["child", 1],
    ]);
  });

  it("keeps a visible duration bar for short spans", () => {
    expect(durationBarPercent(1, 100)).toBe(4);
    expect(durationBarPercent(50, 100)).toBe(50);
    expect(durationBarPercent(undefined, 100)).toBe(0);
  });

  it("unwraps trace detail and evaluator options", () => {
    const detail = {
      flaggedForDataset: false,
      id: "trace-1",
      name: "summarize",
      prompts: [],
      scoreCount: 0,
      scores: [],
      sensitive: false,
      spanCount: 0,
      spans: [],
      startedAt: "2026-09-01T12:00:00.000Z",
      status: "ok" as const,
    };
    assert.equal(unwrapTraceDetail(detail)?.id, "trace-1");
    assert.equal(unwrapTraceDetail({data: detail})?.id, "trace-1");
    assert.deepEqual(unwrapEvaluators([{id: "e-1", name: "quality", type: "human"}]), [
      {id: "e-1", name: "quality", type: "human"},
    ]);
    assert.deepEqual(unwrapEvaluators({data: [{id: "e-1", name: "quality", type: "human"}]}), [
      {id: "e-1", name: "quality", type: "human"},
    ]);
    assert.deepEqual(unwrapEvaluators([{id: "e-2", name: "automatic", type: "llm-judge"}]), []);
  });

  it("formats trace list labels and usage", () => {
    assert.equal(promptCountLabel([{name: "a", version: 1}]), "1 prompt");
    assert.equal(promptCountLabel([]), "0 prompts");
    assert.equal(formatTokens({inputTokens: 3, outputTokens: 4}), "7");
    assert.equal(formatTokens(undefined), "—");
    assert.equal(formatCost({costUsd: 0.0123}), "$0.0123");
    assert.equal(
      formatLatency({
        endedAt: "2026-09-01T12:00:01.000Z",
        startedAt: "2026-09-01T12:00:00.000Z",
      }),
      "1000 ms"
    );
    assert.equal(formatLatency({startedAt: "2026-09-01T12:00:00.000Z"}), "—");
  });

  it("stringifies IO and provides empty filters", () => {
    assert.equal(stringifyIo("plain"), "plain");
    assert.include(stringifyIo({a: 1}), "a");
    assert.deepEqual(emptyTraceFilters(), {
      from: "",
      prompt: "",
      sessionId: "",
      status: "",
      to: "",
      userId: "",
    });
  });

  it("unwraps bare arrays as trace lists", () => {
    const rows = [{id: "a"} as TraceListItem];
    const listed = unwrapTraceList(rows);
    assert.equal(listed.total, 1);
    assert.equal(listed.data[0]?.id, "a");
  });
});
