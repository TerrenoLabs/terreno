import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {AiTraceDetailView} from "./AiTraceDetailView";
import type {TraceDetail, TraceScore} from "./traceTypes";

const buildDetail = (scores: TraceScore[], sensitive = false): TraceDetail => ({
  flaggedForDataset: false,
  id: "trace-1",
  name: "summarize",
  prompts: [],
  scoreCount: scores.length,
  scores,
  sensitive,
  spanCount: 0,
  spans: [],
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "ok",
});

const thumbsDown: TraceScore = {
  comment: "Too long",
  dataType: "boolean",
  name: "thumbs_up",
  source: "user-feedback",
  value: false,
};

const copiedSignal: TraceScore = {
  dataType: "boolean",
  name: "copied",
  source: "user-signal",
  value: true,
};

const renderDetail = (detail: TraceDetail): ReturnType<typeof renderWithTheme> =>
  renderWithTheme(<AiTraceDetailView detail={detail} onBack={mock(() => undefined)} />);

describe("AiTraceDetailView scores", () => {
  it("shows the User badge and the comment under a user-feedback score", () => {
    const {getByTestId, getByText} = renderDetail(buildDetail([thumbsDown]));
    expect(getByText("User")).toBeTruthy();
    expect(getByTestId("ai-trace-score-comment-0")).toBeTruthy();
    expect(getByText("Too long")).toBeTruthy();
  });

  it("shows the Signal badge and no comment row for a user-signal score", () => {
    const {getByText, queryByTestId} = renderDetail(buildDetail([copiedSignal]));
    expect(getByText("Signal")).toBeTruthy();
    expect(queryByTestId("ai-trace-score-comment-0")).toBeNull();
  });

  it("labels every score source with its badge text", () => {
    const sources: Array<[string, string]> = [
      ["user-feedback", "User"],
      ["user-signal", "Signal"],
      ["human", "Human"],
      ["llm-judge", "Judge"],
      ["code", "Code"],
    ];
    const scores = sources.map(([source], index) => ({
      dataType: "boolean" as const,
      name: `score_${index}`,
      source,
      value: true,
    }));
    const {getByText, queryByText} = renderDetail(buildDetail(scores));
    for (const [source, label] of sources) {
      expect(getByText(label)).toBeTruthy();
      // The raw source string is replaced by the badge label.
      expect(queryByText(source)).toBeNull();
    }
  });

  it("keeps the empty message when there are no scores", () => {
    const {getByText} = renderDetail(buildDetail([]));
    expect(getByText("No scores on this trace.")).toBeTruthy();
  });

  it("indexes comment rows by score position", () => {
    const {getByTestId, queryByTestId, getByText} = renderDetail(
      buildDetail([copiedSignal, {...thumbsDown, comment: "Missed the point"}])
    );
    expect(queryByTestId("ai-trace-score-comment-0")).toBeNull();
    expect(getByTestId("ai-trace-score-comment-1")).toBeTruthy();
    expect(getByText("Missed the point")).toBeTruthy();
  });

  it("hides the comment on a sensitive trace until the disclosure is opened", () => {
    const {getByTestId, queryByTestId, queryByText, getByText} = renderDetail(
      buildDetail([thumbsDown], true)
    );
    expect(queryByText("Too long")).toBeNull();

    // The disclosure may be an Accordion (toggle child) or a plain button; accept either.
    const id = "ai-trace-score-comment-toggle-0";
    fireEvent.press(queryByTestId(`${id}.toggle`) ?? getByTestId(id));
    expect(getByText("Too long")).toBeTruthy();
  });

  it("shows a non-sensitive comment without any disclosure", () => {
    const {queryByTestId, getByText} = renderDetail(buildDetail([thumbsDown], false));
    expect(getByText("Too long")).toBeTruthy();
    expect(queryByTestId("ai-trace-score-comment-toggle-0")).toBeNull();
  });
});

describe("AiTraceDetailView tags", () => {
  it("shows the trace tags in the header", () => {
    const detail = {...buildDetail([]), tags: ["model:glm-5.3", "key:shade-general"]};
    const {getByText} = renderDetail(detail);
    expect(getByText("tags model:glm-5.3, key:shade-general")).toBeTruthy();
  });

  it("omits the tags line when there are none", () => {
    const {queryByTestId} = renderDetail({...buildDetail([]), tags: []});
    expect(queryByTestId("ai-trace-tags")).toBeNull();
  });
});
