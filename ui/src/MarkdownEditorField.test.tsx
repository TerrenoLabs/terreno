import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import {Pressable} from "react-native";

import {MarkdownEditorField} from "./MarkdownEditorField";
import {renderWithTheme} from "./test-utils";

// Minimal shape of a test instance returned by UNSAFE_getAllByType that we rely on here.
interface ToolbarPressableInstance {
  props: {
    style: (state: {pressed: boolean}) => {backgroundColor: string};
  };
}

const TOOLBAR_CASES: {label: string; empty: string; existing: string}[] = [
  {empty: "**text**", existing: "Draft**text**", label: "B"},
  {empty: "_text_", existing: "Draft_text_", label: "I"},
  {empty: "~~text~~", existing: "Draft~~text~~", label: "~"},
  {empty: "`code`", existing: "Draft`code`", label: "<>"},
  {empty: "# text", existing: "Draft\n# text", label: "H1"},
  {empty: "## text", existing: "Draft\n## text", label: "H2"},
  {empty: "- item", existing: "Draft\n- item", label: "•"},
  {empty: "> text", existing: "Draft\n> text", label: ">"},
  {empty: "[text](url)", existing: "Draft[text](url)", label: "🔗"},
];

describe("MarkdownEditorField", () => {
  it("renders the title, input and preview placeholder", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <MarkdownEditorField onChange={() => {}} testID="editor" title="Consent body" />
    );

    expect(getByText("Consent body")).toBeTruthy();
    expect(getByTestId("editor-input").props.placeholder).toBe("Enter markdown...");
    expect(getByText("Preview")).toBeTruthy();
  });

  it("hides the preview pane when showPreview is false", () => {
    const {getByTestId, queryByText} = renderWithTheme(
      <MarkdownEditorField onChange={() => {}} showPreview={false} testID="editor" value="" />
    );

    expect(getByTestId("editor-input")).toBeTruthy();
    expect(queryByText("Preview")).toBeNull();
  });

  it("renders the markdown preview instead of the placeholder when a value is set", () => {
    const {queryByText} = renderWithTheme(
      <MarkdownEditorField onChange={() => {}} value="# Heading" />
    );

    expect(queryByText("Preview")).toBeNull();
  });

  it("uses a custom placeholder and omits input testID when no testID is given", () => {
    const {getByPlaceholderText} = renderWithTheme(
      <MarkdownEditorField onChange={() => {}} placeholder="Write notes" />
    );

    expect(getByPlaceholderText("Write notes").props.testID).toBeUndefined();
  });

  it("reports typed text through onChange", () => {
    const onChange = mock((_text: string) => {});
    const {getByTestId} = renderWithTheme(
      <MarkdownEditorField onChange={onChange} testID="editor" />
    );

    fireEvent.changeText(getByTestId("editor-input"), "Hello");

    expect(onChange).toHaveBeenCalledWith("Hello");
  });

  it("renders error and helper text", () => {
    const {getByText} = renderWithTheme(
      <MarkdownEditorField
        errorText="Body is required"
        helperText="Markdown is supported"
        onChange={() => {}}
      />
    );

    expect(getByText("Body is required")).toBeTruthy();
    expect(getByText("Markdown is supported")).toBeTruthy();
  });

  it("disables the input and hides the toolbar when disabled", () => {
    const {getByTestId, queryByText} = renderWithTheme(
      <MarkdownEditorField disabled onChange={() => {}} testID="editor" />
    );

    expect(getByTestId("editor-input").props.editable).toBe(false);
    expect(queryByText("B")).toBeNull();
  });

  it("applies a custom max height to the panes", () => {
    const {getByTestId} = renderWithTheme(
      <MarkdownEditorField maxHeight={320} onChange={() => {}} testID="editor" />
    );

    expect(getByTestId("editor-input").props.style).toMatchObject({minHeight: 166});
  });

  it("highlights a toolbar button while it is pressed", () => {
    const {UNSAFE_getAllByType} = renderWithTheme(<MarkdownEditorField onChange={() => {}} />);
    const [toolbarButton] = UNSAFE_getAllByType(Pressable) as unknown as ToolbarPressableInstance[];

    expect(toolbarButton?.props.style({pressed: false}).backgroundColor).toBe("transparent");
    expect(toolbarButton?.props.style({pressed: true}).backgroundColor).not.toBe("transparent");
  });

  for (const {label, empty, existing} of TOOLBAR_CASES) {
    it(`inserts markdown for the ${label} toolbar button`, () => {
      const onChange = mock((_text: string) => {});
      const {getByText} = renderWithTheme(<MarkdownEditorField onChange={onChange} />);

      fireEvent.press(getByText(label));

      expect(onChange).toHaveBeenCalledWith(empty);
    });

    it(`appends markdown for the ${label} toolbar button when a value exists`, () => {
      const onChange = mock((_text: string) => {});
      const {getByText} = renderWithTheme(
        <MarkdownEditorField onChange={onChange} value="Draft" />
      );

      fireEvent.press(getByText(label));

      expect(onChange).toHaveBeenCalledWith(existing);
    });
  }
});
