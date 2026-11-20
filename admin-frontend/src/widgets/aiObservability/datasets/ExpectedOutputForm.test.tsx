import {describe, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {ExpectedOutputForm} from "./ExpectedOutputForm";
import {buildForm, type JsonSchema, prepareFormValue} from "./expectedOutputModel";

const FORM_SCHEMA: JsonSchema = {
  properties: {
    active: {description: "Turn it on", type: "boolean"},
    address: {properties: {city: {type: "string"}}, type: "object"},
    count: {description: "How many", type: "number"},
    empty: {type: "object"},
    route: {description: "Where to send", enum: ["none", "988"], type: "string"},
    summary: {title: "Summary", type: "string"},
    tags: {items: {type: "string"}, type: "array"},
  },
  type: "object",
};

const LONG_SUMMARY = "x".repeat(90);

const changeAt = (
  onChange: {mock: {calls: unknown[][]}},
  index: number
): Record<string, unknown> => {
  const value = onChange.mock.calls[index]?.[0];
  assert.isObject(value);
  return value as Record<string, unknown>;
};

const formValue = (): Record<string, unknown> => {
  return {
    active: false,
    address: {city: "Austin"},
    count: 2,
    empty: {},
    route: "988",
    summary: LONG_SUMMARY,
    tags: ["first"],
  };
};

describe("ExpectedOutputForm", () => {
  it("toggles a boolean field to the opposite value", async () => {
    const onChange = mock((_value: unknown): void => undefined);
    const value = prepareFormValue(FORM_SCHEMA, formValue());
    const view = renderWithTheme(
      <ExpectedOutputForm
        idPrefix="form"
        node={buildForm(FORM_SCHEMA, value)}
        onChange={onChange}
        value={value}
      />
    );

    assert.exists(view.getByText("Turn it on"));
    await act(async () => {
      fireEvent.press(view.getByTestId("form-active-clickable"));
      await Promise.resolve();
    });
    assert.deepEqual(onChange.mock.calls[0], [
      {...(value as Record<string, unknown>), active: true},
    ]);
  });

  it("does not toggle a boolean field while disabled", async () => {
    const onChange = mock((_value: unknown): void => undefined);
    const value = prepareFormValue(FORM_SCHEMA, formValue());
    const view = renderWithTheme(
      <ExpectedOutputForm
        disabled
        idPrefix="form"
        node={buildForm(FORM_SCHEMA, value)}
        onChange={onChange}
        value={value}
      />
    );

    await act(async () => {
      fireEvent.press(view.getByTestId("form-active"));
      await Promise.resolve();
    });
    assert.equal(onChange.mock.calls.length, 0);
    assert.isNull(view.queryByTestId("form-tags-add"));
    assert.isNull(view.queryByTestId("form-empty-add-field"));
  });

  it("commits a numeric field only when the draft is a finished number", async () => {
    const onChange = mock((_value: unknown): void => undefined);
    const value = prepareFormValue(FORM_SCHEMA, formValue());
    const view = renderWithTheme(
      <ExpectedOutputForm
        idPrefix="form"
        node={buildForm(FORM_SCHEMA, value)}
        onChange={onChange}
        value={value}
      />
    );
    const count = view.getByTestId("form-count");

    assert.exists(count);
    fireEvent.changeText(count, "-");
    fireEvent.changeText(count, "1.");
    assert.equal(onChange.mock.calls.length, 0);

    fireEvent.changeText(count, "3.5");
    fireEvent.changeText(count, "");
    assert.deepEqual(
      onChange.mock.calls.map((call) => (call[0] as {count: unknown}).count),
      [3.5, null]
    );
  });

  it("picks a choice from a schema enum", async () => {
    const onChange = mock((_value: unknown): void => undefined);
    const value = prepareFormValue(FORM_SCHEMA, formValue());
    const view = renderWithTheme(
      <ExpectedOutputForm
        idPrefix="form"
        node={buildForm(FORM_SCHEMA, value)}
        onChange={onChange}
        value={value}
      />
    );

    assert.exists(view.getByText("Where to send"));
    await act(async () => {
      fireEvent.press(view.getByTestId("web_picker"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("web_dropdown_option_none"));
      await Promise.resolve();
    });
    assert.equal(changeAt(onChange, 0).route, "none");
  });

  it("edits a long string as a multiline field and a short string as one line", () => {
    const onChange = mock((_value: unknown): void => undefined);
    const value = prepareFormValue(FORM_SCHEMA, formValue());
    const view = renderWithTheme(
      <ExpectedOutputForm
        idPrefix="form"
        node={buildForm(FORM_SCHEMA, value)}
        onChange={onChange}
        value={value}
      />
    );

    assert.exists(view.getByText("Summary"));
    fireEvent.changeText(view.getByTestId("form-summary"), "Short summary.");
    assert.equal(changeAt(onChange, 0).summary, "Short summary.");

    fireEvent.changeText(view.getByTestId("form-address.city"), "Dallas");
    assert.equal((changeAt(onChange, 1).address as {city: string}).city, "Dallas");
  });

  it("adds, edits, and removes list entries", async () => {
    const onChange = mock((_value: unknown): void => undefined);
    const value = prepareFormValue(FORM_SCHEMA, formValue());
    const view = renderWithTheme(
      <ExpectedOutputForm
        idPrefix="form"
        node={buildForm(FORM_SCHEMA, value)}
        onChange={onChange}
        value={value}
      />
    );

    await act(async () => {
      fireEvent.press(view.getByTestId("form-tags-add"));
      await Promise.resolve();
    });
    assert.deepEqual(changeAt(onChange, 0).tags, ["first", ""]);

    fireEvent.changeText(view.getByTestId("form-tags.0"), "edited");
    assert.deepEqual(changeAt(onChange, 1).tags, ["edited"]);

    await act(async () => {
      fireEvent.press(view.getByTestId("form-tags.0-remove"));
      await Promise.resolve();
    });
    assert.deepEqual(changeAt(onChange, 2).tags, []);
  });

  it("adds a named field to an object that has no declared fields", async () => {
    const onChange = mock((_value: unknown): void => undefined);
    const value = prepareFormValue(FORM_SCHEMA, formValue());
    const view = renderWithTheme(
      <ExpectedOutputForm
        idPrefix="form"
        node={buildForm(FORM_SCHEMA, value)}
        onChange={onChange}
        value={value}
      />
    );

    fireEvent.changeText(view.getByTestId("form-empty-add-field-name"), "  ");
    await act(async () => {
      fireEvent.press(view.getByTestId("form-empty-add-field"));
      await Promise.resolve();
    });
    assert.equal(onChange.mock.calls.length, 0);

    fireEvent.changeText(view.getByTestId("form-empty-add-field-name"), " reason ");
    await act(async () => {
      fireEvent.press(view.getByTestId("form-empty-add-field"));
      await Promise.resolve();
    });
    assert.deepEqual(changeAt(onChange, 0).empty, {
      reason: "",
    });
  });

  it("renders a schema-less object and list from the value alone", () => {
    const onChange = mock((_value: unknown): void => undefined);
    const value = {answer: "yes", notes: ["one"], score: 2};
    const view = renderWithTheme(
      <ExpectedOutputForm
        idPrefix="free"
        node={buildForm(undefined, value)}
        onChange={onChange}
        value={value}
      />
    );

    assert.exists(view.getByTestId("free-answer"));
    fireEvent.changeText(view.getByTestId("free-score"), "7");
    assert.equal(changeAt(onChange, 0).score, 7);
    assert.exists(view.getByTestId("free-notes-add"));
  });
});
