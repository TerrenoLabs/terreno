import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiPromptsListView} from "../widgets/aiObservability/prompts/AiPromptsListView";
import type {PromptListItem} from "../widgets/aiObservability/prompts/promptTypes";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

const prompts: PromptListItem[] = [
  {
    folder: "examples",
    latestVersion: 2,
    name: "summarize",
    production: 1,
    type: "chat",
    usage7d: {calls: 3, costUsd: 0.2},
  },
];

const idleHandlers = {
  onCreate: () => undefined,
  onCreateFolderChange: () => undefined,
  onCreateNameChange: () => undefined,
  onCreateSystemChange: () => undefined,
  onCreateTemplateChange: () => undefined,
  onDismissCreate: () => undefined,
  onFolderChange: () => undefined,
  onOpenCreate: () => undefined,
  onOpenPrompt: () => undefined,
  onSearchChange: () => undefined,
};

describe("AiPromptsListView", () => {
  it("renders the loading state", () => {
    const {getByTestId} = renderWithTheme(
      <AiPromptsListView
        createFolder="examples"
        createName=""
        createOpen={false}
        createSystem=""
        createTemplate=""
        folder=""
        isLoading
        prompts={[]}
        search=""
        {...idleHandlers}
      />
    );
    expect(getByTestId("ai-prompts-loading")).toBeTruthy();
  });

  it("renders the empty state", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiPromptsListView
        createFolder="examples"
        createName=""
        createOpen={false}
        createSystem=""
        createTemplate=""
        folder=""
        prompts={[]}
        search=""
        {...idleHandlers}
      />
    );
    expect(getByTestId("ai-prompts-empty")).toBeTruthy();
    expect(getByText("No prompts in this folder yet.")).toBeTruthy();
  });

  it("renders a loaded table with folder counts and latest vs production columns", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiPromptsListView
        createFolder="examples"
        createName=""
        createOpen={false}
        createSystem=""
        createTemplate=""
        folder=""
        prompts={prompts}
        search=""
        {...idleHandlers}
      />
    );
    expect(getByTestId("ai-prompts-table")).toBeTruthy();
    expect(getByText("All (1)")).toBeTruthy();
    expect(getByText("examples (1)")).toBeTruthy();
    expect(getByText("examples/summarize")).toBeTruthy();
    expect(getByText("v2")).toBeTruthy();
    expect(getByText("v1")).toBeTruthy();
  });

  it("renders an Open control for each prompt", () => {
    const {getByTestId} = renderWithTheme(
      <AiPromptsListView
        createFolder="examples"
        createName=""
        createOpen={false}
        createSystem=""
        createTemplate=""
        folder=""
        prompts={prompts}
        search=""
        {...idleHandlers}
      />
    );
    expect(getByTestId("ai-prompt-open-summarize")).toBeTruthy();
  });

  it("filters by folder and search and wires create modal fields", async () => {
    const onFolderChange = mock(() => undefined);
    const onSearchChange = mock(() => undefined);
    const onCreate = mock(() => undefined);
    const onRetry = mock(() => undefined);
    const {getByTestId, getByText} = renderWithTheme(
      <AiPromptsListView
        createError="Name required"
        createFolder="examples"
        createName="new-prompt"
        createOpen
        createSystem="You are helpful"
        createTemplate="Hi {{name}}"
        folder=""
        loadError="Failed to load prompts"
        onCreate={onCreate}
        onCreateFolderChange={() => undefined}
        onCreateNameChange={() => undefined}
        onCreateSystemChange={() => undefined}
        onCreateTemplateChange={() => undefined}
        onDismissCreate={() => undefined}
        onFolderChange={onFolderChange}
        onOpenCreate={() => undefined}
        onOpenPrompt={() => undefined}
        onRetry={onRetry}
        onSearchChange={onSearchChange}
        prompts={prompts}
        search="summ"
      />
    );
    fireEvent.changeText(getByTestId("ai-prompts-search"), "note");
    assert.isAtLeast(onSearchChange.mock.calls.length, 1);
    await act(async () => {
      fireEvent.press(getByTestId("ai-prompts-folder-examples"));
      await Promise.resolve();
    });
    assert.isAtLeast(onFolderChange.mock.calls.length, 1);
    await act(async () => {
      fireEvent.press(getByText("Retry"));
      await Promise.resolve();
    });
    assert.equal(onRetry.mock.calls.length, 1);
    expect(getByTestId("ai-prompts-create-form")).toBeTruthy();
  });
});
