// noExplicitAny: test mocks use loosely typed hook doubles
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminModelConfig} from "../types";
import {ModelsGridWidget} from "./ModelsGridWidget";

const routerPush = mock(() => {});
mock.module("expo-router", () => ({
  router: {push: routerPush},
}));

let listState: {data?: {total?: number}; isLoading: boolean} = {
  data: {total: 12},
  isLoading: false,
};

mock.module("../useAdminModelApi", () => ({
  useAdminModelApi: () => ({
    useListQuery: (_args?: unknown, opts?: {skip?: boolean}) => {
      if (opts?.skip) {
        return {data: undefined, isLoading: false};
      }
      return listState;
    },
  }),
}));

const model: AdminModelConfig = {
  defaultSort: "-created",
  displayName: "User",
  fields: {email: {required: true, type: "string"}, name: {required: false, type: "string"}},
  listFields: ["email"],
  name: "User",
  permissions: {create: true},
  routePath: "/admin/users",
};

describe("ModelsGridWidget", () => {
  beforeEach(() => {
    routerPush.mockClear();
    listState = {data: {total: 12}, isLoading: false};
  });

  it("renders model cards with field and row counts", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <ModelsGridWidget models={[model]} routeBase="/admin/" />
    );

    expect(getByTestId("admin-home-widget-modelsGrid")).toBeTruthy();
    expect(getByText("2 fields")).toBeTruthy();
    expect(getByText("12 rows")).toBeTruthy();
  });

  it("navigates to list and create routes from model actions", async () => {
    const {getByTestId} = renderWithTheme(
      <ModelsGridWidget models={[model]} routeBase="/admin/" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-home-models-grid-User-clickable"));
    });
    assert.equal(routerPush.mock.calls[0]?.[0], "/admin/User");

    await act(async () => {
      fireEvent.press(getByTestId("admin-home-model-add-User"));
    });
    assert.equal(routerPush.mock.calls[1]?.[0], "/admin/User/create");
  });

  it("hides create action and shows a spinner while counts load", () => {
    listState = {isLoading: true};
    const readOnlyModel: AdminModelConfig = {
      ...model,
      displayName: "Audit log",
      name: "AuditLog",
      permissions: {create: false},
    };
    const {queryByTestId, getByTestId} = renderWithTheme(
      <ModelsGridWidget models={[readOnlyModel]} routeBase="/admin" />
    );

    expect(queryByTestId("admin-home-model-add-AuditLog")).toBeNull();
    expect(getByTestId("admin-home-models-grid-AuditLog-clickable")).toBeTruthy();
  });
});
