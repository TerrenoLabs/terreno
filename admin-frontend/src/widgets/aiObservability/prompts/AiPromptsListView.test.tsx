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
  it("hides Create prompt when canCreate is false", () => {
    const view = renderWithTheme(<AiPromptsListView {...idleHandlers} canCreate={false} />);
    expect(view.queryByTestId("ai-prompts-create")).toBeNull();
  });

  it("shows Create prompt for operators", () => {
    const view = renderWithTheme(<AiPromptsListView {...idleHandlers} canCreate={true} />);
    expect(view.getByTestId("ai-prompts-create")).toBeTruthy();
    expect(view.getByText("Create prompt")).toBeTruthy();
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

  it("sorts by version and filters by type, keeping header tooltips", () => {
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
    expect(columns.map((column) => column.sortable)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(columns[2]?.infoModalText).toContain("highest immutable version");
    expect(columns[3]?.infoModalText).toContain("production label");
    expect(columns[2]?.width).toBeGreaterThanOrEqual(150);
    expect(columns[3]?.width).toBeGreaterThanOrEqual(180);
    expect(columns[1]?.filter?.options).toEqual([
      {label: "chat", value: "chat"},
      {label: "text", value: "text"},
    ]);

    act(() => {
      tableProps().setSortColumn?.({column: 2, direction: "desc"});
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
