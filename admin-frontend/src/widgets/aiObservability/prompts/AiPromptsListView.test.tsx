import {describe, expect, it, mock} from "bun:test";
import type {DataTableProps} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {AiPromptsListView} from "./AiPromptsListView";
import type {PromptListItem} from "./promptTypes";

const prompts: PromptListItem[] = [
  {
    folder: "examples",
    latestVersion: 1,
    name: "summarize",
    production: 1,
    type: "chat",
  },
];

const idleHandlers = {
  createDescription: "",
  createFolder: "examples",
  createName: "",
  createOpen: false,
  createSystem: "",
  createTemplate: "",
  folder: "All folders",
  onCreate: mock(() => {}),
  onCreateDescriptionChange: mock(() => {}),
  onCreateFolderChange: mock(() => {}),
  onCreateNameChange: mock(() => {}),
  onCreateSystemChange: mock(() => {}),
  onCreateTemplateChange: mock(() => {}),
  onDismissCreate: mock(() => {}),
  onFolderChange: mock(() => {}),
  onOpenCreate: mock(() => {}),
  onOpenPrompt: mock(() => {}),
  onSearchChange: mock(() => {}),
  prompts,
  search: "",
};

describe("AiPromptsListView", () => {
  it("hides the empty-state New prompt action when canCreate is false", () => {
    const view = renderWithTheme(
      <AiPromptsListView {...idleHandlers} canCreate={false} prompts={[]} />
    );
    expect(view.getByText("No prompts yet")).toBeTruthy();
    expect(view.queryByTestId("ai-prompts-empty-action")).toBeNull();
  });

  it("offers New prompt from the empty state for operators", async () => {
    const onOpenCreate = mock(() => {});
    const view = renderWithTheme(
      <AiPromptsListView
        {...idleHandlers}
        canCreate={true}
        onOpenCreate={onOpenCreate}
        prompts={[]}
      />
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompts-empty-action"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(onOpenCreate.mock.calls.length, 1);
  });

  it("tells no matches apart from an empty library", () => {
    const view = renderWithTheme(<AiPromptsListView {...idleHandlers} search="nothing" />);
    expect(view.getByTestId("ai-prompts-no-matches")).toBeTruthy();
    expect(view.getByText("No prompts match")).toBeTruthy();
  });

  it("shows production and staging badges, type badges, and relative last use", () => {
    const view = renderWithTheme(
      <AiPromptsListView
        {...idleHandlers}
        folder=""
        prompts={[
          {
            description: "Short summaries",
            folder: "examples",
            labels: [{label: "staging", version: 3}],
            latestVersion: 3,
            name: "summarize",
            production: 2,
            type: "chat",
            usage7d: {calls: 1234, lastUsed: "2026-01-01T00:00:00.000Z"},
          } as PromptListItem,
        ]}
      />
    );
    expect(view.getByText("examples · Short summaries")).toBeTruthy();
    expect(view.getByText("Chat")).toBeTruthy();
    expect(view.getByText("v2")).toBeTruthy();
    expect(view.getByText("v3")).toBeTruthy();
    expect(view.getByText("Staging")).toBeTruthy();
    expect(view.getByText("1,234")).toBeTruthy();
    expect(view.getByText(/(ago|^in .+)$/)).toBeTruthy();
  });

  it("wires description in the create modal", () => {
    const onCreateDescriptionChange = mock(() => {});
    const view = renderWithTheme(
      <AiPromptsListView
        {...idleHandlers}
        canCreate={true}
        createDescription="Operator summary"
        createOpen={true}
        onCreateDescriptionChange={onCreateDescriptionChange}
      />
    );
    expect(view.getByDisplayValue("Operator summary")).toBeTruthy();
    fireEvent.changeText(view.getByDisplayValue("Operator summary"), "Updated summary");
    assert.isAtLeast(onCreateDescriptionChange.mock.calls.length, 1);
  });

  it("sorts by newest version and filters by type", () => {
    const library: PromptListItem[] = [
      {folder: "examples", latestVersion: 2, name: "alpha", production: 1, type: "chat"},
      {folder: "examples", latestVersion: 12, name: "beta", production: "—", type: "text"},
      {folder: "examples", latestVersion: 7, name: "gamma", production: 7, type: "chat"},
    ];
    const view = renderWithTheme(
      <AiPromptsListView {...idleHandlers} folder="" prompts={library} />
    );
    const tableProps = (): DataTableProps =>
      view.UNSAFE_root.find(
        (node) => node.props.testID === "ai-prompts-table" && "setSortColumn" in node.props
      ).props as DataTableProps;
    const openOrder = (): string[] =>
      view.getAllByTestId(/^ai-prompt-open-/).map((node) => String(node.props.testID));

    const columns = tableProps().columns;
    expect(columns.map((column) => column.title)).toEqual([
      "Prompt",
      "Type",
      "Production",
      "Newest",
      "Calls 7 days",
      "Last used",
    ]);
    expect(columns.every((column) => column.sortable)).toBe(true);
    expect(columns[1]?.filter?.options).toEqual([
      {label: "Chat", value: "chat"},
      {label: "Text", value: "text"},
    ]);

    act(() => {
      tableProps().setSortColumn?.({column: 3, direction: "desc"});
    });
    expect(openOrder()).toEqual([
      "ai-prompt-open-beta",
      "ai-prompt-open-gamma",
      "ai-prompt-open-alpha",
    ]);
    expect(view.getByText("v12")).toBeTruthy();

    act(() => {
      tableProps().onFilterValuesChange?.({type: ["chat"]});
    });
    expect(openOrder()).toEqual(["ai-prompt-open-gamma", "ai-prompt-open-alpha"]);
  });
});
