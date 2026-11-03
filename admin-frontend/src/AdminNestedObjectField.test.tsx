import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminFieldRenderer} from "./AdminFieldRenderer";
import {buildNestedObjectDefault, isNestedObjectField} from "./AdminNestedObjectField";
import type {AdminApi, AdminFieldConfig, AdminFieldValue} from "./types";

const api = {} as unknown as AdminApi;

const TASKS_CONFIG: AdminFieldConfig = {
  description: "Project task settings",
  items: {
    enabled: {
      default: false,
      description: "Turn on project tasks",
      required: false,
      type: "boolean",
    },
    intakePollMs: {
      default: 300000,
      description: "How often intake polls, in ms",
      required: false,
      type: "number",
    },
    labels: {itemType: "string", required: false, type: "array"},
  },
  required: false,
  type: "object",
};

const MCP_MEDIA_CONFIG: AdminFieldConfig = {
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

describe("AdminNestedObjectField via AdminFieldRenderer", () => {
  it("renders each leaf with its own control instead of a JSON box", () => {
    const {getByTestId, getByText, queryByText} = renderWithTheme(
      <AdminFieldRenderer
        api={api}
        fieldConfig={TASKS_CONFIG}
        fieldKey="tasks"
        onChange={() => {}}
        value={{enabled: true, intakePollMs: 1000, labels: ["a"]}}
      />
    );
    expect(getByTestId("admin-field-group-tasks")).toBeTruthy();
    expect(getByText("Tasks")).toBeTruthy();
    expect(getByText("Project task settings")).toBeTruthy();
    expect(getByTestId("admin-field-tasks.enabled")).toBeTruthy();
    expect(getByTestId("admin-field-tasks.intakePollMs").props.value).toBe("1000");
    expect(getByText("Enabled")).toBeTruthy();
    expect(getByText("Intake Poll Ms")).toBeTruthy();
    expect(getByText("How often intake polls, in ms")).toBeTruthy();
    expect(getByText("Labels")).toBeTruthy();
    expect(queryByText("JSON value (string, number, boolean, object, or array)")).toBeNull();
  });

  it("shows subfield defaults when the stored object is missing a leaf", () => {
    const {getByTestId} = renderWithTheme(
      <AdminFieldRenderer
        api={api}
        fieldConfig={TASKS_CONFIG}
        fieldKey="tasks"
        onChange={() => {}}
        value={{enabled: true}}
      />
    );
    expect(getByTestId("admin-field-tasks.intakePollMs").props.value).toBe("300000");
  });

  it("merges an edited leaf into the parent object", () => {
    const onChange = mock((_: AdminFieldValue) => {});
    const {getByTestId} = renderWithTheme(
      <AdminFieldRenderer
        api={api}
        fieldConfig={TASKS_CONFIG}
        fieldKey="tasks"
        onChange={onChange}
        value={{enabled: true, intakePollMs: 1000}}
      />
    );
    fireEvent.changeText(getByTestId("admin-field-tasks.intakePollMs"), "2500");
    expect(onChange).toHaveBeenCalledWith({enabled: true, intakePollMs: 2500});
  });

  it("recurses into deeper nested objects", () => {
    const onChange = mock((_: AdminFieldValue) => {});
    const {getByTestId} = renderWithTheme(
      <AdminFieldRenderer
        api={api}
        fieldConfig={MCP_MEDIA_CONFIG}
        fieldKey="mcpMedia"
        onChange={onChange}
        value={{port: 8080, sonarr: {apiKey: "k", url: "http://old"}}}
      />
    );
    expect(getByTestId("admin-field-group-mcpMedia.sonarr")).toBeTruthy();
    fireEvent.changeText(getByTestId("admin-field-mcpMedia.sonarr.url"), "http://new");
    expect(onChange).toHaveBeenCalledWith({
      port: 8080,
      sonarr: {apiKey: "k", url: "http://new"},
    });
  });

  it("renders a nested object with no stored value", () => {
    const onChange = mock((_: AdminFieldValue) => {});
    const {getByTestId} = renderWithTheme(
      <AdminFieldRenderer
        api={api}
        fieldConfig={MCP_MEDIA_CONFIG}
        fieldKey="mcpMedia"
        onChange={onChange}
        value={undefined}
      />
    );
    fireEvent.changeText(getByTestId("admin-field-mcpMedia.port"), "9000");
    expect(onChange).toHaveBeenCalledWith({port: 9000});
  });

  it("groups nested objects inside array-of-subdocument items", () => {
    const {getByTestId, queryByText} = renderWithTheme(
      <AdminFieldRenderer
        api={api}
        fieldConfig={{items: {media: MCP_MEDIA_CONFIG}, required: false, type: "array"}}
        fieldKey="servers"
        onChange={() => {}}
        readOnly
        value={[
          {media: {port: 1, sonarr: {apiKey: "k", url: "http://x"}}},
          {media: {port: 2, sonarr: {apiKey: "j", url: "http://y"}}},
        ]}
      />
    );
    expect(getByTestId("admin-field-group-servers.0.media")).toBeTruthy();
    expect(getByTestId("admin-field-servers.0.media.sonarr.url").props.value).toBe("http://x");
    expect(getByTestId("admin-field-servers.1.media.sonarr.url").props.value).toBe("http://y");
    expect(queryByText("JSON value (string, number, boolean, object, or array)")).toBeNull();
  });

  it("keeps a string leaf a text field when only its parent's name contains 'date'", () => {
    const onChange = mock((_: AdminFieldValue) => {});
    const {getByTestId} = renderWithTheme(
      <AdminFieldRenderer
        api={api}
        fieldConfig={{
          items: {note: {required: false, type: "string"}},
          required: false,
          type: "object",
        }}
        fieldKey="updates"
        onChange={onChange}
        value={{note: "hello"}}
      />
    );
    const noteInput = getByTestId("admin-field-updates.note");
    expect(noteInput.props.value).toBe("hello");
    fireEvent.changeText(noteInput, "bye");
    expect(onChange).toHaveBeenCalledWith({note: "bye"});
  });

  it("keeps the JSON editor for objects without subfields and for mixed", () => {
    const {getAllByText} = renderWithTheme(
      <>
        <AdminFieldRenderer
          api={api}
          fieldConfig={{required: false, type: "object"}}
          fieldKey="selectors"
          onChange={() => {}}
          value={{a: 1}}
        />
        <AdminFieldRenderer
          api={api}
          fieldConfig={{items: {}, required: false, type: "object"}}
          fieldKey="emptyItems"
          onChange={() => {}}
          value={{}}
        />
        <AdminFieldRenderer
          api={api}
          fieldConfig={{required: false, type: "mixed"}}
          fieldKey="data"
          onChange={() => {}}
          value={{b: 2}}
        />
      </>
    );
    expect(getAllByText("JSON value (string, number, boolean, object, or array)")).toHaveLength(3);
  });
});

describe("isNestedObjectField", () => {
  it("is true only for objects with subfields and no custom widget", () => {
    expect(isNestedObjectField(TASKS_CONFIG)).toBe(true);
    expect(isNestedObjectField({required: false, type: "object"})).toBe(false);
    expect(isNestedObjectField({...TASKS_CONFIG, widget: "locale-content"})).toBe(false);
    expect(isNestedObjectField({...TASKS_CONFIG, type: "mixed"})).toBe(false);
    expect(isNestedObjectField({...TASKS_CONFIG, type: "array"})).toBe(false);
  });
});

describe("buildNestedObjectDefault", () => {
  it("uses schema defaults and blank values, recursing into nested objects", () => {
    expect(buildNestedObjectDefault(TASKS_CONFIG.items ?? {})).toEqual({
      enabled: false,
      intakePollMs: 300000,
      labels: [],
    });
    expect(buildNestedObjectDefault(MCP_MEDIA_CONFIG.items ?? {})).toEqual({
      port: 0,
      sonarr: {apiKey: "", url: ""},
    });
  });

  it("omits enums, refs, dates, mixed, and system fields without a default", () => {
    expect(
      buildNestedObjectDefault({
        _id: {required: false, type: "objectid"},
        kind: {enum: ["a", "b"], required: false, type: "string"},
        name: {required: false, type: "string"},
        owner: {ref: "User", required: false, type: "string"},
        payload: {required: false, type: "mixed"},
        when: {required: false, type: "date"},
      })
    ).toEqual({name: ""});
  });
});
