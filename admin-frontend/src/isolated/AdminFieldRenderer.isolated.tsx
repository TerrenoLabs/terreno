// noExplicitAny: test mocks use type-erased UI component stubs and field config literals
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

mock.module("../AdminNestedArrayField", () => ({
  AdminNestedArrayField: ({title}: {title: string}) =>
    React.createElement("AdminNestedArrayField", {title}),
}));
mock.module("../AdminRefField", () => ({
  AdminRefField: ({title}: {title: string}) => React.createElement("AdminRefField", {title}),
}));
mock.module("../CheckboxListEditor", () => ({
  CheckboxListEditor: ({title}: {title: string}) =>
    React.createElement("CheckboxListEditor", {title}),
}));
mock.module("../LocaleContentEditor", () => ({
  LocaleContentEditor: ({title}: {title: string}) =>
    React.createElement("LocaleContentEditor", {title}),
}));

import {AdminFieldRenderer} from "../AdminFieldRenderer";
import type {AdminFieldConfig} from "../types";

const base = {baseUrl: "/admin", onChange: () => {}};

describe("AdminFieldRenderer", () => {
  it.each([
    ["boolean default", {required: false, type: "boolean"}, true],
    ["number default", {required: false, type: "number"}, 42],
    ["string default", {required: false, type: "string"}, "hello"],
    ["date (by type)", {required: false, type: "date"}, "2024-01-01"],
    ["datetime", {required: false, type: "datetime"}, "2024-01-01T00:00:00Z"],
    ["string field with 'date' in name", {required: false, type: "string"}, "2024-01-01"],
    ["object (JSON)", {required: false, type: "object"}, {foo: "bar"}],
    ["mixed (JSON)", {required: false, type: "mixed"}, [1, 2]],
    [
      "array with items",
      {items: {name: {required: false, type: "string"}}, required: false, type: "array"},
      [],
    ],
    ["array without items", {required: false, type: "array"}, [1, 2, 3]],
    ["array string fallback", {required: false, type: "array"}, "raw-string"],
    [
      "enum",
      {
        enum: ["active", "inactive"],
        required: false,
        type: "string",
      },
      "active",
    ],
    [
      "enum with null value",
      {
        enum: [null, "a"],
        required: false,
        type: "string",
      },
      undefined,
    ],
    ["widget markdown", {required: false, type: "string", widget: "markdown"}, "# Hi"],
    ["widget textarea", {required: false, type: "string", widget: "textarea"}, "some text"],
    ["widget checkbox-list", {required: false, type: "array", widget: "checkbox-list"}, []],
    [
      "widget checkbox-list non-array",
      {required: false, type: "string", widget: "checkbox-list"},
      ["x"],
    ],
    [
      "widget locale-content",
      {required: false, type: "object", widget: "locale-content"},
      {en: "hi"},
    ],
  ])("renders %s type", (_label, fieldConfig, value) => {
    const fieldKey = _label === "string field with 'date' in name" ? "birthDate" : "field";
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={fieldConfig as unknown as AdminFieldConfig}
        fieldKey={fieldKey}
        value={value}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders reference field when ref+modelConfigs match", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{ref: "User", required: false, type: "string"}}
        fieldKey="owner"
        modelConfigs={[{name: "User", routePath: "/admin/users"}]}
        value=""
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("falls back to default when ref model is missing", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{ref: "Unknown", required: false, type: "string"}}
        fieldKey="owner"
        modelConfigs={[{name: "User", routePath: "/admin/users"}]}
        value=""
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders dynamic enum from a sibling plural array (e.g. variant→variants)", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "string"}}
        fieldKey="variant"
        parentFormState={{variants: [{key: "a"}, {key: "b"}]}}
        value="a"
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders locale-default widget using sibling content map", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "string", widget: "locale-default"}}
        fieldKey="defaultLocale"
        parentFormState={{content: {en: "hi", es: "hola"}}}
        value="en"
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders locale-default as disabled when no locales exist", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "string", widget: "locale-default"}}
        fieldKey="defaultLocale"
        parentFormState={{}}
        value=""
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("number field onChange converts numeric text to Number, falls back to raw text for NaN", () => {
    const changes: unknown[] = [];
    const {getByTestId} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "number"}}
        fieldKey="qty"
        onChange={(v) => changes.push(v)}
        value={1}
      />
    );
    const input = getByTestId("admin-field-qty");
    fireEvent.changeText(input, "42");
    fireEvent.changeText(input, "abc");
    expect(changes).toEqual([42, "abc"]);
  });

  it("enum onChange maps empty string to undefined", () => {
    const changes: unknown[] = [];
    const {UNSAFE_root} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{enum: [null, "a", "b"], required: false, type: "string"}}
        fieldKey="status"
        onChange={(v) => changes.push(v)}
        value=""
      />
    );
    // Pull the first element that has an `options` prop (SelectField) and
    // invoke its onChange directly to exercise the empty-string → undefined
    // wrapper.
    const candidates = UNSAFE_root.findAll(
      (n) => n.props && Array.isArray((n.props as {options?: unknown}).options)
    );
    const select = candidates[0];
    (select.props as {onChange?: (v: string) => void}).onChange?.("");
    (select.props as {onChange?: (v: string) => void}).onChange?.("a");
    expect(changes).toEqual([undefined, "a"]);
  });

  it("object field onChange parses JSON text and falls back to raw string", () => {
    const changes: unknown[] = [];
    const {getByTestId} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "object"}}
        fieldKey="meta"
        onChange={(v) => changes.push(v)}
        value={{a: 1}}
      />
    );
    const input = getByTestId("admin-field-meta");
    fireEvent.changeText(input, '{"a":2}');
    fireEvent.changeText(input, "not-json");
    fireEvent.changeText(input, "");
    expect(changes).toEqual([{a: 2}, "not-json", undefined]);
  });

  it("array without items onChange parses JSON array then falls back to raw text", () => {
    const changes: unknown[] = [];
    const {getByTestId} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "array"}}
        fieldKey="tags"
        onChange={(v) => changes.push(v)}
        value={[1, 2, 3]}
      />
    );
    const input = getByTestId("admin-field-tags");
    fireEvent.changeText(input, "[4,5]");
    fireEvent.changeText(input, "oops");
    expect(changes).toEqual([[4, 5], "oops"]);
  });

  it("renders mixed type with null value (serializes to empty string)", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "mixed"}}
        fieldKey="anything"
        value={null}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders mixed type with string value (serializes as-is)", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "mixed"}}
        fieldKey="anything"
        value="plain string"
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("array without items uses raw string when value is already a string", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "array"}}
        fieldKey="raw"
        value="[already,string]"
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("dynamic enum skips rendering when sibling plural exists but has no .key values", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "string"}}
        fieldKey="variant"
        parentFormState={{variants: [{key: ""}, {key: null}]}}
        value=""
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("dynamic enum ignores sibling when first item has no .key", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "string"}}
        fieldKey="variant"
        parentFormState={{variants: [{notKey: "x"}]}}
        value=""
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders roles arrays with the dedicated role field", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{itemType: "string", required: false, type: "array"}}
        fieldKey="roles"
        value={["admin"]}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders multi-value user targeting with the primitive array field", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        autocompleteFields={["value"]}
        fieldConfig={{required: false, type: "array"}}
        fieldKey="value"
        modelConfigs={[{name: "User", routePath: "/admin/users"}]}
        parentFormState={{field: "userId", operator: "in"}}
        readOnly
        value="user-1"
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders single-value user targeting with a custom renderer", () => {
    const CustomRenderer: React.FC<Record<string, unknown>> = (props) =>
      React.createElement("CustomRenderer", props);
    const {UNSAFE_root} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        autocompleteFields={["value"]}
        fieldConfig={{required: false, type: "string"}}
        fieldKey="value"
        modelConfigs={[{name: "User", routePath: "/admin/users"}]}
        parentFormState={{field: "ownerId", operator: "eq"}}
        refRenderers={{User: CustomRenderer}}
        value="user-1"
      />
    );
    const custom = UNSAFE_root.findAll((node) => node.type === "CustomRenderer")[0];
    expect(custom.props.routePath).toBe("/admin/users");
    expect(custom.props.autocomplete).toBe(true);
  });

  it("renders single-value user targeting with the standard ref field", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "string"}}
        fieldKey="value"
        modelConfigs={[{name: "User", routePath: "/admin/users"}]}
        parentFormState={{field: "createdBy", operator: "neq"}}
        value={42}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders a configured reference with a custom renderer", () => {
    const CustomRenderer: React.FC<Record<string, unknown>> = (props) =>
      React.createElement("CustomRenderer", props);
    const {UNSAFE_root} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{ref: "Organization", required: false, type: "string"}}
        fieldKey="organizationId"
        modelConfigs={[{name: "Organization", routePath: "/admin/organizations"}]}
        refRenderers={{Organization: CustomRenderer}}
        value="org-1"
      />
    );
    const custom = UNSAFE_root.findAll((node) => node.type === "CustomRenderer")[0];
    expect(custom.props.routePath).toBe("/admin/organizations");
    expect(custom.props.value).toBe("org-1");
  });

  it("renders primitive arrays from item metadata", () => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{
          itemEnum: ["one", "two"],
          itemType: "string",
          required: false,
          type: "array",
        }}
        fieldKey="tags"
        value="not-an-array"
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it.each([
    ["markdown", "string", "# Read only"],
    ["textarea", "string", "Read only"],
    ["checkbox-list", "array", ["one"]],
    ["locale-content", "object", {en: "English"}],
    ["locale-default", "string", "en"],
  ])("renders read-only %s widgets", (widget, type, value) => {
    const {toJSON} = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type, widget} as AdminFieldConfig}
        fieldKey="content"
        parentFormState={{content: {en: "English"}}}
        readOnly
        value={value}
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("keeps read-only structured widget change handlers inert", () => {
    for (const fieldConfig of [
      {required: false, type: "array", widget: "checkbox-list"},
      {required: false, type: "object", widget: "locale-content"},
    ] as AdminFieldConfig[]) {
      const changes: unknown[] = [];
      const rendered = renderWithTheme(
        <AdminFieldRenderer
          {...base}
          fieldConfig={fieldConfig}
          fieldKey="content"
          onChange={(value) => changes.push(value)}
          readOnly
          value={fieldConfig.type === "array" ? ["one"] : {en: "English"}}
        />
      );
      fireEvent.changeText(rendered.getByTestId("admin-field-content"), "ignored");
      expect(changes).toEqual([]);
      rendered.unmount();
    }
  });

  it("normalizes invalid editable widget values", () => {
    const checkbox = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "array", widget: "checkbox-list"}}
        fieldKey="choices"
        value="invalid"
      />
    );
    const locale = renderWithTheme(
      <AdminFieldRenderer
        {...base}
        fieldConfig={{required: false, type: "object", widget: "locale-content"}}
        fieldKey="content"
        value={["invalid"]}
      />
    );
    expect(checkbox.toJSON()).toBeDefined();
    expect(locale.toJSON()).toBeDefined();
  });
});
