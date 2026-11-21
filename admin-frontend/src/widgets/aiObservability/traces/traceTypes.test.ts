import {describe, expect, it} from "bun:test";
import {assert} from "chai";
import {
  durationBarPercent,
  emptyTraceFilters,
  filterValuesToTraceFilters,
  flattenSpans,
  formatCost,
  formatLatency,
  formatTokens,
  promptCountLabel,
  selectedSensitiveCount,
  stringifyIo,
  TRACE_FILTER_FIELDS,
  type TraceListItem,
  type TraceSpanNode,
  traceFiltersToFilterValues,
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
      prompts: [],
      sessionId: "",
      status: "",
      tag: "",
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

  it("maps list filters to DataTable filter values and back", () => {
    assert.deepEqual(traceFiltersToFilterValues(emptyTraceFilters()), {});
    const filters = {
      flaggedForDataset: true,
      from: "2026-09-01T00:00:00.000Z",
      hasScore: false,
      prompts: ["summarize", "title"],
      sensitive: true,
      sessionId: "sess-1",
      status: "error" as const,
      tag: "model:glm-5.3",
      to: "2026-09-02T23:59:59.999Z",
      userId: "user-1",
    };
    const values = traceFiltersToFilterValues(filters);
    assert.deepEqual(values, {
      hasScore: false,
      prompt: ["summarize", "title"],
      sensitive: true,
      sessionId: "sess-1",
      startedAt_gte: "2026-09-01T00:00:00.000Z",
      startedAt_lte: "2026-09-02T23:59:59.999Z",
      status: ["error"],
      tag: "model:glm-5.3",
      userId: "user-1",
    });
    assert.deepEqual(filterValuesToTraceFilters(values, filters), filters);
  });

  it("treats both statuses as no status filter and ignores unknown values", () => {
    const filters = filterValuesToTraceFilters({
      hasScore: "true",
      prompt: "summarize",
      sensitive: "maybe",
      sessionId: "  ",
      status: ["ok", "error"],
      userId: 42,
    });
    assert.deepEqual(filters, {
      from: "",
      hasScore: true,
      prompts: ["summarize"],
      sessionId: "",
      status: "",
      tag: "",
      to: "",
      userId: "",
    });
    assert.equal(filterValuesToTraceFilters({status: ["ok", "bogus"]}).status, "ok");
    assert.equal(filterValuesToTraceFilters({hasScore: "false"}).hasScore, false);
  });

  it("exposes the feedback filter fields", () => {
    expect(TRACE_FILTER_FIELDS.thumbs).toBe("thumbs");
    expect(TRACE_FILTER_FIELDS.signal).toBe("signal");
    expect(TRACE_FILTER_FIELDS.hasComment).toBe("hasComment");
  });

  it("reads thumbs, signal, and hasComment from DataTable filter values", () => {
    const filters = filterValuesToTraceFilters({
      hasComment: true,
      signal: ["dismissed"],
      thumbs: ["down"],
    });
    expect(filters.thumbs).toBe("down");
    expect(filters.signal).toBe("dismissed");
    expect(filters.hasComment).toBe(true);
  });

  it("leaves feedback filters unset for Any and ignores unknown values", () => {
    const any = filterValuesToTraceFilters({signal: [], thumbs: []});
    expect(any.thumbs).toBeUndefined();
    expect(any.signal).toBeUndefined();
    expect(any.hasComment).toBeUndefined();
    expect(filterValuesToTraceFilters({thumbs: ["up"]}).thumbs).toBe("up");
    const bogus = filterValuesToTraceFilters({signal: ["nope"], thumbs: ["sideways"]});
    expect(bogus.thumbs).toBeUndefined();
    expect(bogus.signal).toBeUndefined();
  });

  it("round-trips feedback filters through the DataTable filter values", () => {
    const filters = {
      ...emptyTraceFilters(),
      hasComment: false,
      signal: "copied" as const,
      thumbs: "up" as const,
    };
    const roundTripped = filterValuesToTraceFilters(traceFiltersToFilterValues(filters));
    expect(roundTripped.thumbs).toBe("up");
    expect(roundTripped.signal).toBe("copied");
    expect(roundTripped.hasComment).toBe(false);
  });
});
