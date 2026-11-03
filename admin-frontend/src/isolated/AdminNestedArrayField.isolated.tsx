// noExplicitAny: test mocks use type-erased UI component stubs and mock field renderers
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminFieldConfig} from "../types";

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
    itemHeight,
    renderItem,
    callbackNewDataIds,
  }: {
    dataIDs: string[];
    itemHeight: number;
    renderItem: (arg: {item: string}) => React.ReactElement;
    callbackNewDataIds: (ids: string[]) => void;
  }) => {
    return ReactMod.createElement(RN.View, {itemHeight, testID: "mock-draggable-list"}, [
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

type NestedOnChange = React.ComponentProps<typeof AdminNestedArrayField>["onChange"];

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
        api={{} as unknown as AdminApi}
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
        api={{} as unknown as AdminApi}
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
        api={{} as unknown as AdminApi}
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
    const onChange = mock<NestedOnChange>(() => {});
    const {getByTestId} = renderWithTheme(
      <AdminNestedArrayField
        api={{} as unknown as AdminApi}
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
    const onChange = mock<NestedOnChange>(() => {});
    const {getByTestId} = renderWithTheme(
      <AdminNestedArrayField
        api={{} as unknown as AdminApi}
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
    const onChange = mock<NestedOnChange>(() => {});
    const items = {
      enabled: {required: false, type: "boolean"},
      qty: {required: false, type: "number"},
      tags: {required: false, type: "array"},
    };
    const {getByTestId} = renderWithTheme(
      <AdminNestedArrayField
        api={{} as unknown as AdminApi}
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
    expect(added.tags).toEqual([]);
  });

  it("removes an item via IconButton", () => {
    const onChange = mock<NestedOnChange>(() => {});
    const {getAllByTestId} = renderWithTheme(
      <AdminNestedArrayField
        api={{} as unknown as AdminApi}
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
    const onChange = mock<NestedOnChange>(() => {});
    const {getAllByTestId} = renderWithTheme(
      <AdminNestedArrayField
        api={{} as unknown as AdminApi}
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
    const onChange = mock<NestedOnChange>(() => {});
    const {getByTestId} = renderWithTheme(
      <AdminNestedArrayField
        api={{} as unknown as AdminApi}
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
    const onChange = mock<NestedOnChange>(() => {});
    const {rerender, toJSON} = renderWithTheme(
      <AdminNestedArrayField
        api={{} as unknown as AdminApi}
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={onChange}
        title="Items"
        value={[{active: true, count: 1, name: "a", tags: []}]}
      />
    );
    rerender(
      <AdminNestedArrayField
        api={{} as unknown as AdminApi}
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
        api={{} as unknown as AdminApi}
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
        api={{} as unknown as AdminApi}
        baseUrl="/admin"
        items={baseItems as unknown as Record<string, AdminFieldConfig>}
        onChange={() => {}}
        title="Items"
        value={[{active: true, count: 1, name: "a", tags: []}]}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  describe("nested object subfields", () => {
    const mediaConfig = {
      items: {
        port: {required: false, type: "number"},
        sonarr: {
          items: {
            apiKey: {required: false, type: "string"},
            url: {required: false, type: "string"},
          },
          required: false,
          type: "object",
        },
      },
      required: false,
      type: "object",
    };

    it("sizes editable rows to fit nested object groups", () => {
      const {getByTestId} = renderWithTheme(
        <AdminNestedArrayField
          api={{} as unknown as AdminApi}
          fieldKey="servers"
          items={
            {media: mediaConfig, name: {required: false, type: "string"}} as unknown as Record<
              string,
              AdminFieldConfig
            >
          }
          onChange={() => {}}
          title="Servers"
          value={[{media: {port: 1}, name: "a"}]}
        />
      );
      // Header 44 + name 76 + media group (84 + port 76 + sonarr group (84 + 2 * 76)) + padding 24
      expect(getByTestId("mock-draggable-list").props.itemHeight).toBe(540);
    });

    it("gives nested groups per-item test IDs in editable rows", () => {
      const {getByTestId} = renderWithTheme(
        <AdminNestedArrayField
          api={{} as unknown as AdminApi}
          fieldKey="servers"
          items={{media: mediaConfig} as unknown as Record<string, AdminFieldConfig>}
          onChange={() => {}}
          title="Servers"
          value={[{media: {port: 1}}, {media: {port: 2}}]}
        />
      );
      expect(getByTestId("admin-field-servers.0.media.sonarr.url")).toBeTruthy();
      expect(getByTestId("admin-field-servers.1.media.sonarr.url")).toBeTruthy();
    });

    it("merges an edited nested leaf into the right item", () => {
      const onChange = mock((_: unknown) => {});
      const {getByTestId} = renderWithTheme(
        <AdminNestedArrayField
          api={{} as unknown as AdminApi}
          fieldKey="servers"
          items={{media: mediaConfig} as unknown as Record<string, AdminFieldConfig>}
          onChange={onChange}
          title="Servers"
          value={[{media: {port: 1}}, {media: {port: 2}}]}
        />
      );
      getByTestId("admin-field-servers.1.media.port").props.onChange(9);
      expect(onChange).toHaveBeenCalledWith([{media: {port: 1}}, {media: {port: 9}}]);
    });

    it("starts new items from subfield defaults, skipping system fields and blank enums", () => {
      const onChange = mock((_: unknown) => {});
      const {getByTestId} = renderWithTheme(
        <AdminNestedArrayField
          api={{} as unknown as AdminApi}
          items={
            {
              _id: {required: false, type: "objectid"},
              kind: {enum: ["a", "b"], required: false, type: "string"},
              media: mediaConfig,
            } as unknown as Record<string, AdminFieldConfig>
          }
          onChange={onChange}
          title="Servers"
          value={[]}
        />
      );
      fireEvent.press(getByTestId("btn-plus"));
      expect(onChange).toHaveBeenCalledWith([{media: {port: 0, sonarr: {apiKey: "", url: ""}}}]);
    });
  });
});
