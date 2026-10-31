import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";

const routerPush = mock((_href: unknown) => undefined);
mock.module("expo-router", () => ({
  router: {push: routerPush},
}));

import {AdminBreadcrumbs} from "./AdminBreadcrumbs";

describe("AdminBreadcrumbs", () => {
  it("renders labels and separators", () => {
    const {getByText, getByTestId} = renderWithTheme(
      <AdminBreadcrumbs segments={[{href: "/", label: "Admin"}, {label: "Todos"}]} />
    );
    expect(getByText("Admin")).toBeTruthy();
    expect(getByText("Todos")).toBeTruthy();
    expect(getByTestId("admin-breadcrumb-sep-1")).toBeTruthy();
  });

  it("exposes an accessible control for linked segments", () => {
    const {getByHintText} = renderWithTheme(
      <AdminBreadcrumbs segments={[{href: "/", label: "Admin"}, {label: "Todos"}]} />
    );
    expect(getByHintText("Navigate to Admin")).toBeTruthy();
  });

  it("returns null when there are no segments", () => {
    const {toJSON} = renderWithTheme(<AdminBreadcrumbs segments={[]} />);
    assert.isNull(toJSON());
  });

  it("navigates when a linked segment is pressed", async () => {
    routerPush.mockClear();
    const {getByTestId} = renderWithTheme(
      <AdminBreadcrumbs segments={[{href: "/admin", label: "Admin"}, {label: "Todos"}]} />
    );
    await act(async () => {
      fireEvent.press(getByTestId("admin-breadcrumb-link-0-clickable"));
    });
    assert.equal(routerPush.mock.calls.length, 1);
    assert.equal(routerPush.mock.calls[0]?.[0], "/admin");
  });
});
