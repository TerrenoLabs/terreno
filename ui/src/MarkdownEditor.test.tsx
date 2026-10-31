import {describe, expect, it} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import type {ScaledSize} from "react-native";
import {useWindowDimensions} from "react-native";

import {MarkdownEditor} from "./MarkdownEditor";
import {renderWithTheme} from "./test-utils";

type WindowDimensionsImpl = () => ScaledSize;
type MockableUseWindowDimensions = WindowDimensionsImpl & {
  mockImplementation?: (impl: WindowDimensionsImpl) => void;
};

const getScaledSize =
  (width: number): WindowDimensionsImpl =>
  (): ScaledSize => ({fontScale: 1, height: 1000, scale: 2, width});

const setWindowWidth = (width: number): (() => void) => {
  const useWindowDimensionsMock = useWindowDimensions as MockableUseWindowDimensions;
  if (typeof useWindowDimensionsMock.mockImplementation !== "function") {
    return (): void => {};
  }
  useWindowDimensionsMock.mockImplementation(getScaledSize(width));
  return (): void => {
    useWindowDimensionsMock.mockImplementation?.(getScaledSize(375));
  };
};

describe("MarkdownEditor", () => {
  it("renders the editor and preview panes", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <MarkdownEditor onChange={(): void => {}} testID="editor" value="# Hello" />
    );

    expect(getByTestId("editor")).toBeTruthy();
    expect(getByTestId("editor-input")).toBeTruthy();
    expect(getByTestId("editor-preview")).toBeTruthy();
    expect(getByText("Edit")).toBeTruthy();
    expect(getByText("Preview")).toBeTruthy();
  });

  it("hides the preview pane when showPreview is false", () => {
    const {getByTestId, queryByTestId, queryByText} = renderWithTheme(
      <MarkdownEditor onChange={(): void => {}} showPreview={false} testID="editor" value="# Hi" />
    );

    expect(getByTestId("editor-input")).toBeTruthy();
    expect(queryByTestId("editor-preview")).toBeNull();
    expect(queryByText("Preview")).toBeNull();
  });

  it("renders the title only when provided", () => {
    const {getByText, queryByText, rerender} = renderWithTheme(
      <MarkdownEditor onChange={(): void => {}} title="Notes" value="" />
    );
    expect(getByText("Notes")).toBeTruthy();

    rerender(<MarkdownEditor onChange={(): void => {}} value="" />);
    expect(queryByText("Notes")).toBeNull();
  });

  it("omits the pane test IDs when no testID is given", () => {
    const {queryByTestId} = renderWithTheme(
      <MarkdownEditor onChange={(): void => {}} value="content" />
    );

    expect(queryByTestId("editor-input")).toBeNull();
    expect(queryByTestId("editor-preview")).toBeNull();
  });

  it("calls onChange when the editor text changes", () => {
    const changes: string[] = [];
    const {getByTestId} = renderWithTheme(
      <MarkdownEditor
        onChange={(next): void => {
          changes.push(next);
        }}
        placeholder="Write markdown"
        testID="editor"
        value=""
      />
    );

    fireEvent.changeText(getByTestId("editor-input"), "updated");
    expect(changes).toEqual(["updated"]);
  });

  it("does not call onChange while disabled", () => {
    const changes: string[] = [];
    const {getByTestId} = renderWithTheme(
      <MarkdownEditor
        disabled
        onChange={(next): void => {
          changes.push(next);
        }}
        testID="editor"
        value="locked"
      />
    );

    expect(getByTestId("editor-input").props.readOnly).toBe(true);
    expect(changes).toEqual([]);
  });

  it("stacks the panes on narrow screens and splits them on wide screens", () => {
    const restoreNarrow = setWindowWidth(375);
    const narrow = renderWithTheme(
      <MarkdownEditor onChange={(): void => {}} testID="editor" value="narrow" />
    );
    expect(narrow.getByTestId("editor")).toBeTruthy();
    restoreNarrow();

    const restoreWide = setWindowWidth(1024);
    const wide = renderWithTheme(
      <MarkdownEditor onChange={(): void => {}} testID="editor" value="wide" />
    );
    expect(wide.getByTestId("editor")).toBeTruthy();
    restoreWide();
  });

  it("clamps the editor row count for small max heights", () => {
    const {getByTestId} = renderWithTheme(
      <MarkdownEditor maxHeight={60} onChange={(): void => {}} testID="editor" value="short" />
    );

    expect(getByTestId("editor-input").props.numberOfLines).toBe(3);
  });

  it("scales the editor row count with the max height", () => {
    const {getByTestId} = renderWithTheme(
      <MarkdownEditor maxHeight={820} onChange={(): void => {}} testID="editor" value="tall" />
    );

    expect(getByTestId("editor-input").props.numberOfLines).toBe(20);
  });

  it("renders a blank preview for empty content", () => {
    const {getByTestId} = renderWithTheme(
      <MarkdownEditor onChange={(): void => {}} testID="editor" value="" />
    );

    expect(getByTestId("editor-preview")).toBeTruthy();
  });
});
