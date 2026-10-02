import {describe, expect, it, mock} from "bun:test";
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
  createFolder: "examples",
  createName: "",
  createOpen: false,
  createSystem: "",
  createTemplate: "",
  folder: "All folders",
  onCreate: mock(() => {}),
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
});
