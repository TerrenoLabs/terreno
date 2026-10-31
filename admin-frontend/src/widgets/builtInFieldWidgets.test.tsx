// noExplicitAny: test mocks use UNSAFE_root traversal for field widgets
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {describe, expect, it, mock} from "bun:test";
import {act, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  CheckboxListFieldWidget,
  LocaleContentFieldWidget,
  LocaleDefaultFieldWidget,
  MarkdownFieldWidget,
  PromptFieldWidget,
  TextareaFieldWidget,
} from "./builtInFieldWidgets";

const fieldConfig = {description: "Helper copy", required: false, type: "string"};

describe("builtInFieldWidgets", () => {
  it("renders markdown and textarea widgets with labels and values", async () => {
    const onChange = mock((_value: string) => undefined);
    const markdown = renderWithTheme(
      <MarkdownFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="bodyMarkdown"
        onChange={onChange}
        value="## Hello"
      />
    );
    await waitFor(() => {
      expect(markdown.getByTestId("admin-field-bodyMarkdown")).toBeTruthy();
    });
    assert.equal(markdown.getByTestId("admin-field-bodyMarkdown-input").props.value, "## Hello");

    const textarea = renderWithTheme(
      <TextareaFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="notes"
        onChange={onChange}
        value="line one"
      />
    );
    assert.equal(textarea.getByTestId("admin-field-notes").props.value, "line one");
  });

  it("renders the prompt widget without a preview pane", async () => {
    const prompt = renderWithTheme(
      <PromptFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="systemPrompt"
        onChange={() => {}}
        value=""
      />
    );
    await waitFor(() => {
      expect(prompt.getByTestId("admin-field-systemPrompt-input")).toBeTruthy();
    });
    expect(prompt.queryByText("Preview")).toBeNull();

    const markdown = renderWithTheme(
      <MarkdownFieldWidget fieldConfig={fieldConfig} fieldKey="body" onChange={() => {}} value="" />
    );
    expect(markdown.getByText("Preview")).toBeTruthy();
  });

  it("disables markdown and textarea widgets in read-only mode", async () => {
    const markdown = renderWithTheme(
      <MarkdownFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="bodyMarkdown"
        onChange={() => {}}
        readOnly
        value="locked"
      />
    );
    await waitFor(() => {
      expect(markdown.getByTestId("admin-field-bodyMarkdown-input")).toBeTruthy();
    });
    const markdownInput = markdown.getByTestId("admin-field-bodyMarkdown-input");
    assert.equal(markdownInput.props.editable, false);

    const textarea = renderWithTheme(
      <TextareaFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="notes"
        onChange={() => {}}
        readOnly
        value="locked"
      />
    );
    const textareaInput = textarea.getByTestId("admin-field-notes");
    assert.isTrue(textareaInput.props.disabled ?? textareaInput.props.accessibilityState?.disabled);
  });

  it("renders checkbox list editor for editable values and JSON for read-only", () => {
    const onChange = mock((_value: unknown) => undefined);
    const editable = renderWithTheme(
      <CheckboxListFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="checkboxes"
        onChange={onChange}
        value={[{label: "First", required: true}]}
      />
    );
    expect(editable.getByTestId("checkbox-add-button")).toBeTruthy();

    const readOnly = renderWithTheme(
      <CheckboxListFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="checkboxes"
        onChange={onChange}
        readOnly
        value={[{label: "First", required: true}]}
      />
    );
    const field = readOnly.getByTestId("admin-field-checkboxes");
    assert.include(field.props.value as string, "First");
    assert.isTrue(field.props.disabled ?? field.props.accessibilityState?.disabled);
  });

  it("renders locale content editor and read-only JSON fallback", () => {
    const onChange = mock((_value: Record<string, string>) => undefined);
    const editable = renderWithTheme(
      <LocaleContentFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="content"
        onChange={onChange}
        value={{en: "Hello"}}
      />
    );
    expect(editable.getByText(/Editing:/)).toBeTruthy();

    const readOnly = renderWithTheme(
      <LocaleContentFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="content"
        onChange={onChange}
        readOnly
        value={{en: "Hello"}}
      />
    );
    const field = readOnly.getByTestId("admin-field-content");
    assert.include(field.props.value as string, "Hello");
  });

  it("enables locale default select only when parent content has locales", () => {
    const onChange = mock((_value: string) => undefined);
    const {UNSAFE_root, getByText} = renderWithTheme(
      <LocaleDefaultFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="defaultLocale"
        onChange={onChange}
        parentFormState={{content: {}}}
        value=""
      />
    );
    const disabledSelect = UNSAFE_root.findAll(
      (node: ReactTestInstance) => node.props?.title === "Default Locale"
    )[0];
    assert.isTrue(disabledSelect?.props.disabled);
    expect(getByText(/Add at least one locale/)).toBeTruthy();

    const withLocales = renderWithTheme(
      <LocaleDefaultFieldWidget
        fieldConfig={fieldConfig}
        fieldKey="defaultLocale"
        onChange={onChange}
        parentFormState={{content: {en: "Hello", es: "Hola"}}}
        value="en"
      />
    );
    const enabledSelect = withLocales.UNSAFE_root.findAll(
      (node: ReactTestInstance) => node.props?.title === "Default Locale"
    )[0];
    assert.isFalse(enabledSelect?.props.disabled);
    assert.deepEqual(enabledSelect?.props.options as {label: string; value: string}[], [
      {label: "EN", value: "en"},
      {label: "ES", value: "es"},
    ]);

    act(() => {
      enabledSelect?.props.onChange("es");
    });
    expect(onChange).toHaveBeenCalledWith("es");
  });
});
