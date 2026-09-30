import {describe, expect, it, mock} from "bun:test";
import {SelectField} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import {DateTime} from "luxon";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiPromptEditorView} from "../widgets/aiObservability/prompts/AiPromptEditorView";
import type {PromptDetail} from "../widgets/aiObservability/prompts/promptTypes";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

const idleHandlers = {
  isRunningPlayground: false,
  isSaving: false,
  isSettingProduction: false,
  onRunPlayground: async () => undefined,
  onSaveVersion: async () => undefined,
  onSelectVersion: () => undefined,
  onSetProduction: async () => undefined,
};

const detail: PromptDetail = {
  folder: "examples",
  labels: [
    {label: "latest", version: 2},
    {label: "production", version: 1},
    {label: "staging", version: 1},
  ],
  name: "summarize",
  tags: [],
  versions: [
    {
      config: {temperature: 0.3},
      created: "2026-01-02T03:04:00.000Z",
      sensitive: false,
      system: "You summarize.",
      template: "Summarize {{text}}",
      type: "chat",
      variables: [{key: "text", required: true}],
      version: 1,
    },
    {
      config: {temperature: 0.5},
      created: "2026-02-03T04:05:00.000Z",
      sensitive: false,
      system: "You summarize briefly.",
      template: "Brief {{text}}",
      type: "text",
      variables: [{key: "text", required: true}],
      version: 2,
    },
  ],
};

const detailNoProduction: PromptDetail = {
  ...detail,
  labels: [{label: "latest", version: 2}],
};

const expectedV1Created = DateTime.fromISO("2026-01-02T03:04:00.000Z")
  .toLocal()
  .toLocaleString(DateTime.DATETIME_MED);
const expectedV2Created = DateTime.fromISO("2026-02-03T04:05:00.000Z")
  .toLocal()
  .toLocaleString(DateTime.DATETIME_MED);

describe("AiPromptEditorView", () => {
  it("saves only as the next immutable version and has no in-place save control", () => {
    const {getByTestId, queryByTestId, queryByText} = renderWithTheme(
      <AiPromptEditorView detail={detail} selectedVersion={1} {...idleHandlers} />
    );
    expect(getByTestId("ai-prompt-save-next")).toBeTruthy();
    expect(queryByTestId("ai-prompt-save-in-place")).toBeNull();
    expect(queryByText("Save")).toBeNull();
  });

  it("names the outgoing production version in the confirm copy", async () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiPromptEditorView detail={detail} selectedVersion={1} {...idleHandlers} />
    );
    expect(getByText(/outgoing production version is v1/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("ai-prompt-set-production"));
      await Promise.resolve();
    });
    expect(getByTestId("ai-prompt-production-modal-copy")).toBeTruthy();
  });

  it("keeps Save this run to dataset disabled until phase 2", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiPromptEditorView detail={detail} selectedVersion={1} {...idleHandlers} />
    );
    fireEvent.press(getByText("Playground"));
    const dataset = getByTestId("ai-prompt-save-run-dataset");
    expect(dataset.props.accessibilityState?.disabled ?? dataset.props.disabled).toBeTruthy();
  });

  it("switches versions, text type hides system, and wires save/production callbacks", async () => {
    const onSaveVersion = mock(async () => undefined);
    const onSetProduction = mock(async () => undefined);
    const onSelectVersion = mock(() => undefined);
    const v1 = renderWithTheme(
      <AiPromptEditorView
        detail={detail}
        isRunningPlayground={false}
        isSaving={false}
        isSettingProduction={false}
        onRunPlayground={async () => undefined}
        onSaveVersion={onSaveVersion}
        onSelectVersion={onSelectVersion}
        onSetProduction={onSetProduction}
        selectedVersion={1}
      />
    );
    await act(async () => {
      fireEvent.press(v1.getByTestId("ai-prompt-version-2"));
      await Promise.resolve();
    });
    expect(onSelectVersion).toHaveBeenCalledWith(2);
    expect(v1.getByTestId("ai-prompt-label-production-1")).toBeTruthy();
    expect(v1.getByTestId("ai-prompt-label-staging-1")).toBeTruthy();
    assert.equal(v1.getByTestId("ai-prompt-version-created-1").props.children, expectedV1Created);

    const v2 = renderWithTheme(
      <AiPromptEditorView
        detail={detail}
        isRunningPlayground={false}
        isSaving={false}
        isSettingProduction={false}
        onRunPlayground={async () => undefined}
        onSaveVersion={onSaveVersion}
        onSelectVersion={onSelectVersion}
        onSetProduction={onSetProduction}
        selectedVersion={2}
      />
    );
    expect(v2.queryByTestId("ai-prompt-system")).toBeNull();
    expect(v2.getByTestId("ai-prompt-label-latest-2")).toBeTruthy();
    assert.equal(v2.getByTestId("ai-prompt-version-created-2").props.children, expectedV2Created);
    fireEvent.changeText(v2.getByTestId("ai-prompt-template"), "Brief {{text}} updated");
    await act(async () => {
      fireEvent.press(v2.getByTestId("ai-prompt-save-next"));
      await Promise.resolve();
    });
    assert.isAtLeast(onSaveVersion.mock.calls.length, 1);

    await act(async () => {
      fireEvent.press(v2.getByTestId("ai-prompt-set-production"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(v2.getByText("Set production"));
      await Promise.resolve();
    });
    assert.isAtLeast(onSetProduction.mock.calls.length, 1);
  });

  it("shows version-not-found, no-production badge, and inline errors", () => {
    const missing = renderWithTheme(
      <AiPromptEditorView detail={detail} selectedVersion={99} {...idleHandlers} />
    );
    expect(missing.getByText(/Version 99 was not found/)).toBeTruthy();

    const noProd = renderWithTheme(
      <AiPromptEditorView detail={detailNoProduction} selectedVersion={2} {...idleHandlers} />
    );
    expect(noProd.getByText("no production")).toBeTruthy();

    const errors = renderWithTheme(
      <AiPromptEditorView
        detail={detail}
        playgroundError="Playground failed"
        productionError="Could not set production."
        saveError="Could not save a new version."
        selectedVersion={1}
        {...idleHandlers}
      />
    );
    expect(errors.getByText("Could not save a new version.")).toBeTruthy();
    expect(errors.getByText("Could not set production.")).toBeTruthy();
    fireEvent.press(errors.getByText("Playground"));
    expect(errors.getByText("Playground failed")).toBeTruthy();
  });

  it("switches prompt type, saves text versions, and dismisses the production modal", async () => {
    const onSaveVersion = mock(async () => undefined);
    const onSetProduction = mock(async () => undefined);
    const {getByTestId, getByText, UNSAFE_root} = renderWithTheme(
      <AiPromptEditorView
        detail={detail}
        isRunningPlayground={false}
        isSaving={false}
        isSettingProduction={false}
        onRunPlayground={async () => undefined}
        onSaveVersion={onSaveVersion}
        onSelectVersion={() => undefined}
        onSetProduction={onSetProduction}
        selectedVersion={1}
      />
    );
    const typeSelect = UNSAFE_root.findAllByType(SelectField).find(
      (field) => field.props.title === "Type"
    );
    fireEvent(typeSelect!, "onChange", "text");
    fireEvent.changeText(getByTestId("ai-prompt-template"), "Plain text body");
    await act(async () => {
      fireEvent.press(getByTestId("ai-prompt-save-next"));
      await Promise.resolve();
    });
    assert.isAtLeast(onSaveVersion.mock.calls.length, 1);

    await act(async () => {
      fireEvent.press(getByTestId("ai-prompt-set-production"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(getByText("Cancel"));
      await Promise.resolve();
    });
    fireEvent.press(getByText("Editor"));
    expect(getByTestId("ai-prompt-template")).toBeTruthy();
  });
});
