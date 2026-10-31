// noExplicitAny: test mocks use type-erased mock.calls access for assertion
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import {CheckboxListEditor} from "./CheckboxListEditor";

type CheckboxItem = React.ComponentProps<typeof CheckboxListEditor>["value"][number];

const press = async (el: ReactTestInstance): Promise<void> => {
  await act(async () => {
    fireEvent.press(el);
    await new Promise((r) => setTimeout(r, 150));
  });
};

describe("CheckboxListEditor", () => {
  it("renders title, helper, and checkbox items", () => {
    const {toJSON, getByTestId} = renderWithTheme(
      <CheckboxListEditor
        errorText="err"
        helperText="help"
        onChange={() => {}}
        title="Checkboxes"
        value={[
          {confirmationPrompt: "Confirm?", label: "First", required: true},
          {label: "Second", required: false},
        ]}
      />
    );
    expect(toJSON()).toBeDefined();
    expect(getByTestId("checkbox-add-button")).toBeDefined();
    expect(getByTestId("checkbox-remove-0")).toBeDefined();
  });

  it("handles non-array values gracefully", () => {
    const {toJSON} = renderWithTheme(
      <CheckboxListEditor onChange={() => {}} value={undefined as unknown as CheckboxItem[]} />
    );
    expect(toJSON()).toBeDefined();
  });

  it("adds a new item when Add is clicked", async () => {
    const onChange = mock((_: CheckboxItem[]) => undefined);
    const {getByTestId} = renderWithTheme(<CheckboxListEditor onChange={onChange} value={[]} />);
    await press(getByTestId("checkbox-add-button"));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next).toEqual([{label: "", required: false}]);
  });

  it("removes an item when the remove icon is clicked", async () => {
    const onChange = mock((_: CheckboxItem[]) => undefined);
    const {getByTestId} = renderWithTheme(
      <CheckboxListEditor
        onChange={onChange}
        value={[
          {label: "a", required: false},
          {label: "b", required: false},
        ]}
      />
    );
    await press(getByTestId("checkbox-remove-0"));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next[0].label).toBe("b");
  });

  it("updates a field when label/prompt changes", () => {
    const onChange = mock((_: CheckboxItem[]) => undefined);
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <CheckboxListEditor onChange={onChange} value={[{label: "a", required: false}]} />
    );
    fireEvent.changeText(getByTestId("checkbox-label-0"), "new-label");
    const first = onChange.mock.calls[0][0];
    expect(first[0].label).toBe("new-label");

    fireEvent.changeText(getByTestId("checkbox-prompt-0"), "prompt?");
    const second = onChange.mock.calls[1][0];
    expect(second[0].confirmationPrompt).toBe("prompt?");

    const requiredField = UNSAFE_root.find(
      (node: ReactTestInstance) => node.props?.title === "Required"
    );
    requiredField.props.onChange(true);
    const third = onChange.mock.calls[2][0];
    expect(third[0].required).toBe(true);
  });
});
