// noExplicitAny: test mocks use type-erased UI component stubs and mock field renderers
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminFieldConfig} from "../types";

mock.module("../AdminFieldRendererCore", () => ({
  AdminFieldRendererCore: ({
    fieldKey,
    onChange,
  }: {
    fieldKey: string;
    onChange: (v: unknown) => void;
  }) =>
    React.createElement("AdminFieldRendererCore", {
      fieldKey,
      onChange,
      testID: `admin-field-${fieldKey}`,
    }),
}));

mock.module("@terreno/ui", () => {
  const RN = require("react-native");
  const ReactMod = require("react");
  const DraggableList = ({
    dataIDs,
    renderItem,
    callbackNewDataIds,
  }: {
    dataIDs: string[];
    renderItem: (arg: {item: string}) => React.ReactElement;
    callbackNewDataIds: (ids: string[]) => void;
  }) => {
    return ReactMod.createElement(RN.View, {testID: "mock-draggable-list"}, [
      ...dataIDs.map((id) => ReactMod.cloneElement(renderItem({item: id}), {key: id})),
      ReactMod.createElement(RN.Pressable, {
        key: "__reorder",
        onPress: () => callbackNewDataIds([...dataIDs].reverse()),
        testID: "mock-reorder",
      }),
    ]);
  };
  const Box = ({children, ...rest}: Record<string, unknown>) =>
    ReactMod.createElement(RN.View, rest, children);
  const Button = ({text, onClick, iconName}: Record<string, unknown>) =>
    ReactMod.createElement(
      RN.Pressable,
      {onPress: onClick, testID: `btn-${iconName ?? text}`},
      ReactMod.createElement(RN.Text, {}, text)
    );
  const Card = ({children}: Record<string, unknown>) =>
    ReactMod.createElement(RN.View, {testID: "card"}, children);
  const Heading = ({children}: Record<string, unknown>) =>
    ReactMod.createElement(RN.Text, {}, children);
  const Text = ({children, ...rest}: Record<string, unknown>) =>
    ReactMod.createElement(RN.Text, rest, children);
  const IconButton = ({onClick, accessibilityLabel}: Record<string, unknown>) =>
    ReactMod.createElement(RN.Pressable, {
      onPress: onClick,
      testID: `icon-${accessibilityLabel}`,
    });
  return {Box, Button, Card, DraggableList, Heading, IconButton, Text};
});

import {AdminNestedArrayField} from "../AdminNestedArrayField";

const baseItems = {
  active: {default: true, required: false, type: "boolean"},
  count: {required: false, type: "number"},
  name: {required: false, type: "string"},
  tags: {required: false, type: "array"},
};

describe("AdminNestedArrayField", () => {
  it("renders empty state when no items", () => {
    const {toJSON, getByText} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        helperText="help"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={() => {}}
        title="Items"
        value={[]}
      />
    );
    expect(toJSON()).toBeDefined();
    expect(getByText(/No items/)).toBeDefined();
  });

  it("renders items with error text", () => {
    const {toJSON} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        errorText="oops"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={() => {}}
        title="Items"
        value={[
          {active: true, count: 1, name: "a", tags: []},
          {active: false, count: 2, name: "b", tags: []},
        ]}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("handles non-array incoming value gracefully", () => {
    const {toJSON} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={() => {}}
        title="Items"
        value={null as unknown as Record<string, unknown>[]}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("adds a new item using buildDefaultItem for all supported types", () => {
    const onChange = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={onChange}
        title="Items"
        value={[]}
      />
    );
    fireEvent.press(getByTestId("btn-plus"));
    expect(onChange).toHaveBeenCalled();
    const added = onChange.mock.calls[0][0];
    expect(added.length).toBe(1);
    expect(added[0].active).toBe(true);
    expect(added[0].count).toBe(0);
    expect(added[0].name).toBe("");
    expect(Array.isArray(added[0].tags)).toBe(true);
  });

  it("builds default item for string type without default value", () => {
    const onChange = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={
          {description: {required: false, type: "string"}} as unknown as Record<
            string,
            AdminFieldConfig
          >
        }
        onChange={onChange}
        title="Items"
        value={[]}
      />
    );
    fireEvent.press(getByTestId("btn-plus"));
    expect(onChange.mock.calls[0][0][0].description).toBe("");
  });

  it("builds default item for boolean/number/array types without default values", () => {
    const onChange = mock(() => {});
    const items = {
      enabled: {required: false, type: "boolean"},
      qty: {required: false, type: "number"},
      tags: {required: false, type: "array"},
    };
    const {getByTestId} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={items as unknown as Record<string, AdminFieldConfig>}
        onChange={onChange}
        title="Items"
        value={[]}
      />
    );
    fireEvent.press(getByTestId("btn-plus"));
    const added = onChange.mock.calls[0][0][0];
    expect(added.enabled).toBe(false);
    expect(added.qty).toBe(0);
    expect(Array.isArray(added.tags)).toBe(true);
    expect(added.tags.length).toBe(0);
  });

  it("removes an item via IconButton", () => {
    const onChange = mock(() => {});
    const {getAllByTestId} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={onChange}
        title="Items"
        value={[
          {active: true, count: 1, name: "a", tags: []},
          {active: false, count: 2, name: "b", tags: []},
        ]}
      />
    );
    const removeButtons = getAllByTestId("icon-Remove item");
    fireEvent.press(removeButtons[0]);
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.length).toBe(1);
    expect(next[0].name).toBe("b");
  });

  it("updates a sub-field value via AdminFieldRenderer onChange", () => {
    const onChange = mock(() => {});
    const {getAllByTestId} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={onChange}
        title="Items"
        value={[
          {active: true, count: 1, name: "a", tags: []},
          {active: false, count: 2, name: "b", tags: []},
        ]}
      />
    );
    const nameFields = getAllByTestId("admin-field-name");
    (nameFields[1] as ReactTestInstance).props.onChange("new name");
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next[1].name).toBe("new name");
    expect(next[0].name).toBe("a");
  });

  it("reorders items via DraggableList callback", () => {
    const onChange = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={onChange}
        title="Items"
        value={[
          {active: true, count: 1, name: "a", tags: []},
          {active: false, count: 2, name: "b", tags: []},
          {active: true, count: 3, name: "c", tags: []},
        ]}
      />
    );
    fireEvent.press(getByTestId("mock-reorder"));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.map((i: Record<string, unknown>) => i.name)).toEqual(["c", "b", "a"]);
  });

  it("supports re-render with longer value array (grows itemIds)", () => {
    const onChange = mock(() => {});
    const {rerender, toJSON} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={onChange}
        title="Items"
        value={[{active: true, count: 1, name: "a", tags: []}]}
      />
    );
    rerender(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={onChange}
        title="Items"
        value={[
          {active: true, count: 1, name: "a", tags: []},
          {active: false, count: 2, name: "b", tags: []},
        ]}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("supports re-render with shorter value array (shrinks itemIds)", () => {
    const {rerender, toJSON} = renderWithTheme(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={() => {}}
        title="Items"
        value={[
          {active: true, count: 1, name: "a", tags: []},
          {active: false, count: 2, name: "b", tags: []},
        ]}
      />
    );
    rerender(
      <AdminNestedArrayField
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={() => {}}
        title="Items"
        value={[{active: true, count: 1, name: "a", tags: []}]}
      />
    );
    expect(toJSON()).toBeDefined();
  });
});
