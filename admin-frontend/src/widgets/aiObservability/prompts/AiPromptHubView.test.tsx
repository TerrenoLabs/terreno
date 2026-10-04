import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {AiPromptHubView} from "./AiPromptHubView";
import type {PromptDetail} from "./promptTypes";

const detail: PromptDetail = {
  description: "Operator-facing summary",
  folder: "examples",
  labels: [
    {label: "latest", version: 2},
    {label: "production", version: 1},
  ],
  name: "summarize",
  relationships: {
    experiments: {
      items: [
        {
          created: "2026-01-02T12:00:00.000Z",
          id: "exp-1",
          name: "summarize-rollout",
          promptName: "summarize",
          status: "completed",
          versions: [1, 2],
        },
      ],
      limit: 20,
      total: 1,
    },
    traces: {
      items: [
        {
          id: "trace-1",
          name: "summarize-call",
          promptName: "summarize",
          promptVersion: 2,
          sensitive: false,
          startedAt: "2026-01-01T12:00:00.000Z",
          status: "ok",
        },
      ],
      limit: 20,
      total: 1,
    },
  },
  tags: ["gold"],
  versions: [
    {
      sensitive: false,
      template: "Hello {{name}}",
      type: "chat",
      variables: [{key: "name", required: true}],
      version: 1,
    },
    {
      sensitive: false,
      system: "Be brief",
      template: "Hello {{name}} v2",
      type: "chat",
      variables: [{key: "name", required: true}],
      version: 2,
    },
  ],
};

const baseProps = {
  detail,
  isRunningPlayground: false,
  isSaving: false,
  isSettingProduction: false,
  onRunPlayground: mock(async () => {}),
  onSaveVersion: mock(async () => {}),
  onSelectVersion: mock(() => {}),
  onSetProduction: mock(async () => {}),
  permissions: {
    canCreate: true,
    canPlayground: true,
    canPromote: true,
    canUpdate: true,
  },
  selectedVersion: 2,
};

describe("AiPromptHubView", () => {
  it("shows overview metadata and relationship tables without write controls for read-only callers", () => {
    const view = renderWithTheme(
      <AiPromptHubView
        {...baseProps}
        permissions={{
          canCreate: false,
          canPlayground: false,
          canPromote: false,
          canUpdate: false,
        }}
      />
    );

    expect(view.getByTestId("ai-prompt-description")).toHaveTextContent("Operator-facing summary");
    expect(view.getByTestId("ai-prompt-folder")).toBeTruthy();

    fireEvent.press(view.getByText("Versions"));
    expect(view.queryByTestId("ai-prompt-save-next")).toBeNull();
    expect(view.queryByTestId("ai-prompt-set-production")).toBeNull();
    expect(view.queryByTestId("ai-prompt-playground")).toBeNull();

    fireEvent.press(view.getByText("Traces"));
    expect(view.getByTestId("ai-prompt-traces")).toBeTruthy();
    expect(view.getByText("summarize-call")).toBeTruthy();

    fireEvent.press(view.getByText("Experiments"));
    expect(view.getByTestId("ai-prompt-experiments")).toBeTruthy();
    expect(view.getByText("summarize-rollout")).toBeTruthy();
  });

  it("shows version write controls for operators", () => {
    const view = renderWithTheme(<AiPromptHubView {...baseProps} />);
    fireEvent.press(view.getByText("Versions"));
    expect(view.getByTestId("ai-prompt-save-next")).toBeTruthy();
    expect(view.getByTestId("ai-prompt-set-production")).toBeTruthy();
    fireEvent.press(view.getByText("Playground"));
    expect(view.getByTestId("ai-prompt-playground")).toBeTruthy();
  });

  it("shows save without promote or playground when only update is granted", () => {
    const view = renderWithTheme(
      <AiPromptHubView
        {...baseProps}
        permissions={{
          canCreate: false,
          canPlayground: false,
          canPromote: false,
          canUpdate: true,
        }}
      />
    );
    fireEvent.press(view.getByText("Versions"));
    expect(view.getByTestId("ai-prompt-save-next")).toBeTruthy();
    expect(view.queryByTestId("ai-prompt-set-production")).toBeNull();
    expect(view.queryByText("Playground")).toBeNull();
  });

  it("shows promote and playground without save when only those actions are granted", () => {
    const view = renderWithTheme(
      <AiPromptHubView
        {...baseProps}
        permissions={{
          canCreate: false,
          canPlayground: true,
          canPromote: true,
          canUpdate: false,
        }}
      />
    );
    fireEvent.press(view.getByText("Versions"));
    expect(view.queryByTestId("ai-prompt-save-next")).toBeNull();
    expect(view.getByTestId("ai-prompt-set-production")).toBeTruthy();
    fireEvent.press(view.getByText("Playground"));
    expect(view.getByTestId("ai-prompt-playground")).toBeTruthy();
  });

  it("renders empty relationship states", () => {
    const emptyDetail: PromptDetail = {
      ...detail,
      relationships: {
        experiments: {items: [], limit: 20, total: 0},
        traces: {items: [], limit: 20, total: 0},
      },
    };
    const view = renderWithTheme(
      <AiPromptHubView {...baseProps} detail={emptyDetail} permissions={baseProps.permissions} />
    );
    fireEvent.press(view.getByText("Traces"));
    expect(view.getByTestId("ai-prompt-traces-empty")).toBeTruthy();
    fireEvent.press(view.getByText("Experiments"));
    expect(view.getByTestId("ai-prompt-experiments-empty")).toBeTruthy();
  });

  it("renders relationship loading and error states", () => {
    const loading = renderWithTheme(
      <AiPromptHubView {...baseProps} isRelationshipsLoading relationshipsError={undefined} />
    );
    fireEvent.press(loading.getByText("Traces"));
    expect(loading.getByTestId("ai-prompt-traces-loading")).toBeTruthy();

    const errored = renderWithTheme(
      <AiPromptHubView
        {...baseProps}
        isRelationshipsLoading={false}
        relationshipsError="Could not load relationships."
      />
    );
    fireEvent.press(errored.getByText("Experiments"));
    expect(errored.getByTestId("ai-prompt-experiments-error")).toHaveTextContent(
      "Could not load relationships."
    );
  });
});
