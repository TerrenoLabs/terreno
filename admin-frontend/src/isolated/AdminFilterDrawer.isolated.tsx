// noExplicitAny: test mock typing
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
/**
 * Isolated because the whole `react-native` module is replaced below. `mock.module` is
 * process-wide and permanent, so running this alongside other files leaves every later
 * suite on `Platform.OS === "web"`, where `@terreno/ui` `Modal` reaches for `document`.
 */
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../../ui/src/test-utils";

let mockWindowWidth = 1200;

mock.module("react-native", () => ({
  Dimensions: {get: () => ({height: 800, width: mockWindowWidth})},
  Platform: {OS: "web", select: (o: Record<string, unknown>) => o.web ?? o.default},
  Pressable: "Pressable",
  StyleSheet: {create: (s: unknown) => s, flatten: (s: unknown) => s},
  useWindowDimensions: () => ({height: 800, width: mockWindowWidth}),
}));

mock.module("../AdminRefField", () => ({
  AdminRefField: (props: Record<string, unknown>) => React.createElement("RefField", props),
}));

import {AdminFilterDrawer} from "../AdminFilterDrawer";

describe("AdminFilterDrawer", () => {
  beforeEach(() => {
    mockWindowWidth = 1200;
  });

  it("renders desktop drawer with apply button and filter testIDs", async () => {
    const onApply = mock(() => {});
    const {getByLabelText, getByTestId, getByText} = renderWithTheme(
      <AdminFilterDrawer
        appliedFilterState={{active: undefined}}
        fields={{active: {required: false, type: "boolean"}}}
        filters={[{field: "active", kind: "boolean", label: "Active"}]}
        onApply={onApply}
      />
    );

    expect(getByTestId("admin-filter-drawer")).toBeDefined();
    expect(getByTestId("admin-filter-active")).toBeDefined();
    expect(getByTestId("admin-filter-apply")).toBeDefined();
    expect(getByTestId("admin-filter-clear-all")).toBeDefined();
    expect(getByTestId("admin-filter-apply").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("admin-filter-clear-all").props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      fireEvent.press(getByTestId("admin-filter-apply"));
    });
    expect(onApply).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByLabelText("Collapse filters"));
    });
    expect(getByText("Filters collapsed")).toBeDefined();
    await act(async () => {
      fireEvent.press(getByLabelText("Expand filters"));
    });
    expect(getByTestId("admin-filter-apply")).toBeDefined();
  });

  it("enables apply after a draft change and clear-all applies empty filters", async () => {
    const onApply = mock(() => {});
    const {getByTestId, rerender} = renderWithTheme(
      <AdminFilterDrawer
        appliedFilterState={{}}
        fields={{active: {required: false, type: "boolean"}}}
        filters={[{field: "active", kind: "boolean", label: "Active"}]}
        onApply={onApply}
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-filter-active.switch"));
    });
    expect(getByTestId("admin-filter-apply").props.accessibilityState.disabled).toBe(false);
    expect(getByTestId("admin-filter-clear-all").props.accessibilityState.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(getByTestId("admin-filter-apply"));
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual({active: true});

    rerender(
      <AdminFilterDrawer
        appliedFilterState={{active: true}}
        fields={{active: {required: false, type: "boolean"}}}
        filters={[{field: "active", kind: "boolean", label: "Active"}]}
        onApply={onApply}
      />
    );
    expect(getByTestId("admin-filter-apply").props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      fireEvent.press(getByTestId("admin-filter-clear-all"));
    });
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply.mock.calls[1]?.[0]).toEqual({});
  });

  it("renders every filter field kind and applies the edited draft", async () => {
    const onApply = mock(() => {});
    const {UNSAFE_root, getByTestId} = renderWithTheme(
      <AdminFilterDrawer
        appliedFilterState={{active: true, status: "open"}}
        fields={{
          active: {required: false, type: "boolean"},
          assignee: {ref: "User", required: false, type: "string"},
          created: {required: false, type: "date"},
          query: {required: false, type: "string"},
          status: {required: false, type: "string"},
        }}
        filters={[
          {field: "active", kind: "boolean", label: "Active"},
          {field: "created", kind: "dateRange", label: "Created"},
          {
            choices: [
              {label: "Open", value: "open"},
              {label: "Closed", value: "closed"},
            ],
            field: "status",
            kind: "choice",
            label: "Status",
          },
          {field: "assignee", kind: "ref", label: "Assignee"},
          {field: "query", kind: "text", label: "Query"},
        ]}
        modelConfigs={[{name: "User", routePath: "/admin/users"}]}
        onApply={onApply}
      />
    );

    expect(getByTestId("admin-filter-created-gte")).toBeDefined();
    expect(getByTestId("admin-filter-created-lte")).toBeDefined();
    expect(getByTestId("admin-filter-query")).toBeDefined();
    expect(getByTestId("admin-filter-assignee").props.routePath).toBe("/admin/users");

    const fieldByTitle = (title: string): ReactTestInstance =>
      UNSAFE_root.findAll(
        (node: ReactTestInstance) =>
          node.props?.title === title && typeof node.props?.onChange === "function"
      )[0];

    await act(async () => {
      fireEvent.press(getByTestId("admin-filter-active.switch"));
    });
    await act(async () => {
      fieldByTitle("Created from").props.onChange("2024-01-01");
    });
    await act(async () => {
      fieldByTitle("Created to").props.onChange("2024-01-31");
    });
    await act(async () => {
      fieldByTitle("Status").props.onChange("__all__");
    });
    await act(async () => {
      fieldByTitle("Assignee").props.onChange("user-1");
    });
    await act(async () => {
      fieldByTitle("Query").props.onChange("needle");
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-filter-apply"));
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({
      active: false,
      assignee: "user-1",
      created_gte: "2024-01-01",
      created_lte: "2024-01-31",
      query: "needle",
      status: "",
    });
  });

  it("renders dateRange, choice, text, and ref filters", () => {
    const onApply = mock(() => {});
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminFilterDrawer
        appliedFilterState={{}}
        fields={{owner: {ref: "User", required: false, type: "string"}}}
        filters={[
          {field: "created", kind: "dateRange", label: "Created"},
          {choices: [{label: "A", value: "a"}], field: "status", kind: "choice"},
          {field: "email", kind: "string"},
          {field: "owner", kind: "ref", refModel: "User"},
        ]}
        modelConfigs={[{name: "User", routePath: "/admin/users"}]}
        onApply={onApply}
      />
    );
    expect(getByTestId("admin-filter-created-gte")).toBeDefined();
    expect(getByTestId("admin-filter-email")).toBeDefined();
    expect(getByTestId("admin-filter-owner")).toBeDefined();

    const invokeChange = (testID: string, value: string): void => {
      const node = UNSAFE_root.findAll(
        (candidate: ReactTestInstance) =>
          candidate.props.testID === testID && typeof candidate.props.onChange === "function"
      )[0];
      assert.isDefined(node);
      act(() => {
        node.props.onChange(value);
      });
    };

    invokeChange("admin-filter-created-gte", "2026-01-01");
    invokeChange("admin-filter-created-lte", "2026-12-31");
    invokeChange("admin-filter-status", "a");
    invokeChange("admin-filter-email", "person@example.com");
    invokeChange("admin-filter-owner", "owner-1");

    act(() => {
      const apply = UNSAFE_root.findAll(
        (candidate: ReactTestInstance) =>
          candidate.props.testID === "admin-filter-apply" &&
          typeof candidate.props.onClick === "function"
      )[0];
      apply.props.onClick();
    });
    assert.deepEqual(onApply.mock.calls.at(-1)?.[0], {
      created_gte: "2026-01-01",
      created_lte: "2026-12-31",
      email: "person@example.com",
      owner: "owner-1",
      status: "a",
    });
  });

  it("clears an individual boolean filter and collapses the desktop drawer", async () => {
    const onApply = mock(() => {});
    const {getByLabelText, getByText, UNSAFE_root} = renderWithTheme(
      <AdminFilterDrawer
        appliedFilterState={{active: true}}
        fields={{active: {required: false, type: "boolean"}}}
        filters={[{field: "active", kind: "boolean"}]}
        onApply={onApply}
      />
    );

    const clearButton = UNSAFE_root.findAll(
      (candidate: ReactTestInstance) =>
        candidate.props.text === "Clear filter" && typeof candidate.props.onClick === "function"
    )[0];
    assert.isDefined(clearButton);
    act(() => {
      clearButton.props.onClick();
    });
    await act(async () => {
      fireEvent.press(getByLabelText("Collapse filters"));
    });
    assert.isDefined(getByText("Filters collapsed"));
    await act(async () => {
      fireEvent.press(getByLabelText("Expand filters"));
    });
    assert.isDefined(getByText("All values"));
  });

  it("opens and dismisses the mobile filter sheet", async () => {
    mockWindowWidth = 320;
    const onApply = mock(() => {});
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {activeElement: null},
    });
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: class HTMLElement {},
    });
    const {UNSAFE_root, getByTestId} = renderWithTheme(
      <AdminFilterDrawer
        appliedFilterState={{}}
        fields={{query: {required: false, type: "string"}}}
        filters={[{field: "query", kind: "text", label: "Query"}]}
        onApply={onApply}
      />
    );

    expect(getByTestId("admin-filter-open")).toBeDefined();
    await act(async () => {
      fireEvent.press(getByTestId("admin-filter-open"));
    });
    const modal = UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        node.props?.title === "Filters" && typeof node.props?.onDismiss === "function"
    )[0];
    await act(async () => {
      modal.props.onDismiss();
    });
    expect(onApply).not.toHaveBeenCalled();
  });
});
