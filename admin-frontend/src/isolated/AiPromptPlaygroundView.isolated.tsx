import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {
  PlaygroundRunResult,
  PromptDetail,
} from "../widgets/aiObservability/prompts/promptTypes";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

import {AiPromptPlaygroundView} from "../widgets/aiObservability/prompts/AiPromptPlaygroundView";

const detail: PromptDetail = {
  folder: "examples",
  labels: [{label: "latest", version: 1}],
  name: "summarize",
  tags: [],
  versions: [
    {
      config: {},
      sensitive: false,
      system: "sys",
      template: "Hello {{name}}",
      type: "chat",
      variables: [{key: "name", required: true}],
      version: 1,
    },
  ],
};

const result: PlaygroundRunResult = {
  compiledMessages: [{content: "compiled", role: "user"}],
  costUsd: 0.01,
  latencyMs: 10,
  output: "done",
  tokens: {totalTokens: 5},
};

describe("AiPromptPlaygroundView", () => {
  it("runs once and shows compiled messages, output, and metrics", async () => {
    const onRun = mock(async () => undefined);
    const view = renderWithTheme(
      <AiPromptPlaygroundView
        detail={detail}
        isRunning={false}
        onRun={onRun}
        result={result}
        runError={undefined}
        selectedVersion={detail.versions[0]!}
      />
    );
    fireEvent.changeText(view.getByTestId("ai-prompt-var-name"), "Ada");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-run-once"));
      await Promise.resolve();
    });
    assert.equal(onRun.mock.calls.length, 1);
    expect(view.getByTestId("ai-prompt-run-result")).toBeTruthy();
    expect(view.getByTestId("ai-prompt-run-output")).toHaveTextContent("done");
    expect(view.getByText("compiled")).toBeTruthy();
  });

  it("shows blocked guidance and disables run while loading or blocked", async () => {
    const onRun = mock(async () => undefined);
    const blocked = renderWithTheme(
      <AiPromptPlaygroundView
        blockedMessage="Save a Gemini API key on Profile."
        detail={detail}
        isRunning={false}
        onRun={onRun}
        result={undefined}
        runError={undefined}
        selectedVersion={detail.versions[0]!}
      />
    );
    expect(blocked.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
      "Save a Gemini API key on Profile."
    );
    await act(async () => {
      fireEvent.press(blocked.getByTestId("ai-prompt-run-once"));
      await Promise.resolve();
    });
    assert.equal(onRun.mock.calls.length, 0);
    blocked.unmount();

    onRun.mockClear();
    const loading = renderWithTheme(
      <AiPromptPlaygroundView
        detail={detail}
        isApiKeyLoading={true}
        isRunning={false}
        onRun={onRun}
        result={undefined}
        runError={undefined}
        selectedVersion={detail.versions[0]!}
      />
    );
    expect(loading.getByTestId("ai-prompt-run-once")).toHaveTextContent("Loading API key…");
    await act(async () => {
      fireEvent.press(loading.getByTestId("ai-prompt-run-once"));
      await Promise.resolve();
    });
    assert.equal(onRun.mock.calls.length, 0);
  });

  it("shows run errors and empty-variable guidance", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiPromptPlaygroundView
        detail={{
          ...detail,
          versions: [{...detail.versions[0]!, template: "static", variables: []}],
        }}
        isRunning={false}
        onRun={async () => undefined}
        result={undefined}
        runError="Playground failed"
        selectedVersion={{...detail.versions[0]!, template: "static", variables: []}}
      />
    );
    expect(getByText("This version has no template variables.")).toBeTruthy();
    expect(getByTestId("ai-prompt-run-error")).toHaveTextContent("Playground failed");
  });
});
