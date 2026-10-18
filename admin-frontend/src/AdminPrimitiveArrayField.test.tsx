// noExplicitAny: test mocks use loosely typed hook doubles and mock.calls access
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {Pressable} from "react-native";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminPrimitiveArrayField} from "./AdminPrimitiveArrayField";

const press = async (el: ReactTestInstance): Promise<void> => {
  await act(async () => {
    fireEvent.press(el);
    await new Promise((r) => setTimeout(r, 150));
  });
};

describe("AdminPrimitiveArrayField", () => {
  it("renders empty state when no items", () => {
    const {getByText, getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="string"
        onChange={() => {}}
        title="Tags"
        value={[]}
      />
    );
    expect(getByText(/No items/i)).toBeDefined();
    expect(getByTestId("admin-array-add-Tags")).toBeDefined();
  });

  it("renders existing string items as TextFields", () => {
    const {getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="string"
        onChange={() => {}}
        title="Tags"
        value={["foo", "bar"]}
      />
    );
    expect(getByTestId("admin-array-item-0")).toBeDefined();
    expect(getByTestId("admin-array-item-1")).toBeDefined();
    expect(getByTestId("admin-array-remove-0")).toBeDefined();
    expect(getByTestId("admin-array-remove-1")).toBeDefined();
  });

  it("adds a new item with the type's default", async () => {
    const onChange = mock((_: unknown) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="string"
        onChange={onChange}
        title="Tags"
        value={["foo"]}
      />
    );
    await press(getByTestId("admin-array-add-Tags"));
    expect(onChange).toHaveBeenCalled();
    const next = (onChange.mock.calls[0] as unknown[])[0];
    expect(next).toEqual(["foo", ""]);
  });

  it("removes an item when the remove button is pressed", async () => {
    const onChange = mock((_: unknown) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="string"
        onChange={onChange}
        title="Tags"
        value={["a", "b", "c"]}
      />
    );
    await press(getByTestId("admin-array-remove-1"));
    expect(onChange).toHaveBeenCalled();
    const next = (onChange.mock.calls[0] as unknown[])[0];
    expect(next).toEqual(["a", "c"]);
  });

  it("updates a string item when its TextField changes", () => {
    const onChange = mock((_: unknown) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="string"
        onChange={onChange}
        title="Tags"
        value={["old"]}
      />
    );
    fireEvent.changeText(getByTestId("admin-array-item-0"), "new");
    expect(onChange).toHaveBeenCalled();
    const next = (onChange.mock.calls[0] as unknown[])[0];
    expect(next).toEqual(["new"]);
  });

  it("coerces number input via Number()", () => {
    const onChange = mock((_: unknown) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="number"
        onChange={onChange}
        title="Scores"
        value={[1, 2]}
      />
    );
    fireEvent.changeText(getByTestId("admin-array-item-0"), "42");
    const next = (onChange.mock.calls[0] as unknown[])[0];
    expect(next).toEqual([42, 2]);
  });

  it("uses the boolean default when adding to a [Boolean] field", async () => {
    const onChange = mock((_: unknown) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="boolean"
        onChange={onChange}
        title="Flags"
        value={[]}
      />
    );
    await press(getByTestId("admin-array-add-Flags"));
    const next = (onChange.mock.calls[0] as unknown[])[0];
    expect(next).toEqual([false]);
  });

  it("uses the number default when adding to a [Number] field", async () => {
    const onChange = mock((_: unknown) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="number"
        onChange={onChange}
        title="Scores"
        value={[]}
      />
    );
    await press(getByTestId("admin-array-add-Scores"));
    const next = (onChange.mock.calls[0] as unknown[])[0];
    expect(next).toEqual([0]);
  });

  it("renders enum items as a SelectField", () => {
    const {toJSON} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemEnum={["low", "medium", "high"]}
        itemType="string"
        onChange={() => {}}
        title="Levels"
        value={["low"]}
      />
    );
    // SelectField has no testID prop here, so just sanity-check the tree renders
    expect(toJSON()).toBeDefined();
  });

  it("toggles boolean items via BooleanField", async () => {
    const onChange = mock((_: unknown) => undefined);
    const {UNSAFE_getAllByType} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="boolean"
        onChange={onChange}
        title="Flags"
        value={[false]}
      />
    );
    const pressables = UNSAFE_getAllByType(Pressable);
    await act(async () => {
      fireEvent.press(pressables[0]);
    });
    expect(onChange).toHaveBeenCalled();
    const next = (onChange.mock.calls[0] as unknown[])[0];
    expect(next).toEqual([true]);
  });

  it("updates enum items when SelectField changes", async () => {
    const onChange = mock((_: unknown) => undefined);
    const {UNSAFE_root} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemEnum={["low", "medium", "high"]}
        itemType="string"
        onChange={onChange}
        title="Levels"
        value={["low"]}
      />
    );
    const inputs = UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        typeof node.props.testID === "string" && node.props.testID.includes("input")
    );
    expect(inputs.length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent(inputs[0], "valueChange", "high");
    });
    expect(onChange).toHaveBeenCalled();
    const next = (onChange.mock.calls[0] as unknown[])[0];
    expect(next).toEqual(["high"]);
  });

  it("renders custom ref renderers for objectId items", async () => {
    const onChange = mock((_: unknown) => undefined);
    const CustomRef: React.FC<{onChange: (value: string) => void; value: string}> = ({
      onChange: onRefChange,
      value,
    }) => (
      <Pressable onPress={() => onRefChange("user-2")} testID="custom-ref-field">
        <React.Fragment>{value}</React.Fragment>
      </Pressable>
    );
    const {getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemRef="User"
        itemType="objectid"
        onChange={onChange}
        refRenderers={{User: CustomRef as never}}
        title="Members"
        value={["user-1"]}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("custom-ref-field"));
    });
    expect(onChange).toHaveBeenCalled();
    const next = (onChange.mock.calls[0] as unknown[])[0];
    expect(next).toEqual(["user-2"]);
  });

  it("shows helper and error text and hides add controls in read-only mode", () => {
    const {getByText, queryByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        errorText="Invalid tags"
        helperText="Comma-separated labels"
        itemType="string"
        onChange={() => {}}
        readOnly
        title="Tags"
        value={[]}
      />
    );
    expect(getByText("Comma-separated labels")).toBeDefined();
    expect(getByText("Invalid tags")).toBeDefined();
    expect(queryByTestId("admin-array-add-Tags")).toBeNull();
    expect(getByText("No items.")).toBeDefined();
  });

  it("handles non-array values gracefully", () => {
    const {toJSON} = renderWithTheme(
      <AdminPrimitiveArrayField
        baseUrl="/admin"
        itemType="string"
        onChange={() => {}}
        title="Tags"
        value={undefined as unknown as string[]}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("updates boolean and enum items", () => {
    const booleanChange = mock((_: unknown) => undefined);
    const boolean = renderWithTheme(
      <AdminPrimitiveArrayField
        itemType="boolean"
        onChange={booleanChange}
        title="Flags"
        value={[false]}
      />
    );
    const booleanField = boolean.UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        node.props?.title === "" && typeof node.props?.onChange === "function"
    )[0];
    act(() => {
      booleanField.props.onChange(true);
    });
    expect(booleanChange).toHaveBeenCalledWith([true]);

    const enumChange = mock((_: unknown) => undefined);
    const enumField = renderWithTheme(
      <AdminPrimitiveArrayField
        itemEnum={["low", "high"]}
        itemType="string"
        onChange={enumChange}
        title="Levels"
        value={["low"]}
      />
    ).UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        Array.isArray(node.props?.options) && typeof node.props?.onChange === "function"
    )[0];
    act(() => {
      enumField.props.onChange("high");
    });
    expect(enumChange).toHaveBeenCalledWith(["high"]);
  });

  it("keeps non-numeric number input as text", () => {
    const onChange = mock((_: unknown) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminPrimitiveArrayField itemType="number" onChange={onChange} title="Scores" value={[1]} />
    );
    fireEvent.changeText(getByTestId("admin-array-item-0"), "invalid");
    expect(onChange).toHaveBeenCalledWith(["invalid"]);
  });

  it("uses custom reference renderers with resolved routes", () => {
    const CustomRenderer: React.FC<Record<string, unknown>> = (props) =>
      React.createElement("CustomRenderer", props);
    const {UNSAFE_root} = renderWithTheme(
      <AdminPrimitiveArrayField
        apiBase="/admin"
        autocomplete
        itemRef="User"
        itemType="objectid"
        modelConfigs={[{name: "User", routePath: "/admin/users"}]}
        onChange={() => {}}
        readOnly
        refRenderers={{User: CustomRenderer}}
        routeBase="/console"
        title="Users"
        value={["user-1"]}
      />
    );
    const custom = UNSAFE_root.findAll((node) => node.type === "CustomRenderer")[0];
    expect(custom.props.routePath).toBe("/admin/users");
    expect(custom.props.autocomplete).toBe(true);
    expect(custom.props.readOnly).toBe(true);
  });
});
