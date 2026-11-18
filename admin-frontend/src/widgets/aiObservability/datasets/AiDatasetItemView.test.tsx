import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {AiDatasetItemView} from "./AiDatasetItemView";
import type {JsonSchema} from "./expectedOutputModel";

const CHAT_SAFETY_SCHEMA: JsonSchema = {
  properties: {
    crisis: {description: "Immediate danger to self", type: "boolean"},
    route: {
      description: "Where to send this message",
      enum: ["none", "988", "care-team"],
      type: "string",
    },
  },
  required: ["crisis", "route"],
  type: "object",
};

const baseProps = {
  expected: "Terreno provides a full-stack framework.",
  input: {text: "What is Terreno?"},
  onExpectedChange: (): void => undefined,
  onInputChange: (): void => undefined,
  onOutcomeChange: (): void => undefined,
  onProofreadChange: (): void => undefined,
  onSave: (): void => undefined,
  outcomeClass: "",
  proofread: true,
  saveLabel: "Save expected output",
};

describe("AiDatasetItemView", () => {
  it("edits a string expected output as one text field", async () => {
    const onExpectedChange = mock((_value: unknown): void => undefined);
    const onSave = mock((): void => undefined);
    const view = renderWithTheme(
      <AiDatasetItemView {...baseProps} onExpectedChange={onExpectedChange} onSave={onSave} />
    );

    expect(view.getByTestId("ai-dataset-item-expected")).toBeTruthy();
    fireEvent.changeText(view.getByTestId("ai-dataset-item-expected-root"), "A golden answer.");
    assert.deepEqual(onExpectedChange.mock.calls[0], ["A golden answer."]);

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    assert.equal(onSave.mock.calls.length, 1);
  });

  it("builds checkboxes and selects from the expected output schema", () => {
    const view = renderWithTheme(
      <AiDatasetItemView
        {...baseProps}
        expected={{crisis: false, route: "988"}}
        expectedSchema={CHAT_SAFETY_SCHEMA}
      />
    );

    expect(view.getByText("Crisis")).toBeTruthy();
    expect(view.getByText("Immediate danger to self")).toBeTruthy();
    expect(view.getByText("Route")).toBeTruthy();
    expect(view.getByText("Where to send this message")).toBeTruthy();
  });

  it("toggles proofread and opens the source trace", async () => {
    const onProofreadChange = mock((_value: boolean): void => undefined);
    const onOpenTrace = mock((): void => undefined);
    const view = renderWithTheme(
      <AiDatasetItemView
        {...baseProps}
        onOpenTrace={onOpenTrace}
        onProofreadChange={onProofreadChange}
        proofread
      />
    );

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-proofread-clickable"));
      fireEvent.press(view.getByTestId("ai-dataset-item-open-trace"));
      await Promise.resolve();
    });
    assert.deepEqual(onProofreadChange.mock.calls, [[false]]);
    assert.equal(onOpenTrace.mock.calls.length, 1);
  });
});
