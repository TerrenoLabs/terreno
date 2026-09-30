import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiTraceDetailView} from "../widgets/aiObservability/traces/AiTraceDetailView";
import type {TraceDetail} from "../widgets/aiObservability/traces/traceTypes";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

const detail: TraceDetail = {
  flaggedForDataset: false,
  id: "trace-phi",
  name: "clinical-note",
  prompts: [{name: "note", version: 1}],
  scoreCount: 1,
  scores: [{dataType: "boolean", name: "correct", source: "human", value: true}],
  sensitive: true,
  spanCount: 2,
  spans: [
    {
      children: [
        {
          children: [],
          durationMs: 40,
          id: "span-llm",
          input: "patient SSN 123-45-6789",
          kind: "LLM",
          name: "generate",
          output: "draft note",
          sensitive: true,
          startedAt: "2026-09-01T12:00:00.000Z",
          status: "ok",
        },
      ],
      durationMs: 80,
      id: "span-chain",
      input: "patient SSN 123-45-6789",
      kind: "CHAIN",
      name: "pipeline",
      output: "draft note",
      startedAt: "2026-09-01T12:00:00.000Z",
      status: "ok",
    },
  ],
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "ok",
};

describe("AiTraceDetailView", () => {
  it("renders span kinds, indent, scores, and collapsed sensitive I/O", () => {
    const {getByTestId, getByText, queryByText} = renderWithTheme(
      <AiTraceDetailView detail={detail} onBack={() => undefined} />
    );
    expect(getByTestId("ai-trace-span-span-chain-clickable")).toBeTruthy();
    expect(getByTestId("ai-trace-span-span-llm-clickable")).toBeTruthy();
    expect(getByText("CHAIN")).toBeTruthy();
    expect(getByText("LLM")).toBeTruthy();
    expect(getByText("correct")).toBeTruthy();
    expect(getByText("true")).toBeTruthy();
    expect(getByText("human")).toBeTruthy();
    expect(getByTestId("ai-trace-span-input")).toBeTruthy();
    expect(getByText("Input (sensitive)")).toBeTruthy();
    expect(queryByText("patient SSN 123-45-6789")).toBeNull();
  });

  it("keeps the span list and detail side by side regardless of span content width", () => {
    const wide = JSON.stringify({outputSchema: {properties: {phrase: {type: "string"}}}});
    const {getByTestId} = renderWithTheme(
      <AiTraceDetailView
        detail={{
          ...detail,
          sensitive: false,
          spans: [
            {
              children: [],
              durationMs: 40,
              id: "span-wide",
              input: wide.repeat(20),
              kind: "LLM",
              name: "call-1",
              output: wide.repeat(20),
              startedAt: "2026-09-01T12:00:00.000Z",
              status: "ok",
            },
          ],
        }}
        onBack={() => undefined}
      />
    );

    const columns = getByTestId("ai-trace-span-columns").props.style;
    assert.equal(columns.flexDirection, "row");
    assert.equal(columns.flexWrap, "nowrap");

    // flexBasis 0 keeps the wide span value from pushing the detail onto its own line.
    const list = getByTestId("ai-trace-span-list").props.style;
    const spanDetail = getByTestId("ai-trace-span-detail").props.style;
    assert.equal(list.flexBasis, 0);
    assert.equal(spanDetail.flexBasis, 0);
    assert.equal(list.minWidth, 0);
    assert.equal(spanDetail.minWidth, 0);
    assert.isAbove(spanDetail.flexGrow, list.flexGrow);
  });

  it("selects spans and navigates back", async () => {
    const onBack = mock(() => undefined);
    const {getByTestId, getByText} = renderWithTheme(
      <AiTraceDetailView detail={detail} onBack={onBack} />
    );
    await act(async () => {
      fireEvent.press(getByTestId("ai-trace-span-span-llm-clickable"));
      await Promise.resolve();
    });
    expect(getByText("LLM · generate")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText("Back to traces"));
      await Promise.resolve();
    });
    assert.equal(onBack.mock.calls.length, 1);
  });
});
