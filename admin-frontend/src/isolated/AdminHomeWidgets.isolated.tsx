import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse, AdminModelConfig} from "../types";

const pushes: string[] = [];
mock.module("expo-router", () => ({
  router: {push: (href: string) => pushes.push(href)},
}));

mock.module("../useAdminModelApi", () => ({
  useAdminModelApi: () => ({
    useListQuery: () => ({data: {total: 3}, isLoading: false}),
  }),
}));

import {FeatureFlagsOverridesWidget} from "../widgets/FeatureFlagsOverridesWidget";
import {ModelsGridWidget} from "../widgets/ModelsGridWidget";
import {ScriptRunnerWidget} from "../widgets/ScriptRunnerWidget";

const model: AdminModelConfig = {
  displayName: "Todos",
  fields: {title: {required: true, type: "string"}},
  name: "Todo",
  routePath: "/admin/todos",
};
const config: AdminConfigResponse = {customScreens: [], models: [model], scripts: []};
const baseProps = {
  apiBase: "/admin",
  config,
  models: [model],
  routeBase: "/console/",
};

describe("admin home widgets", () => {
  it("opens a model list and its create form", async () => {
    pushes.length = 0;
    const {getByTestId, getByText} = renderWithTheme(<ModelsGridWidget {...baseProps} />);

    expect(getByText("3 rows")).toBeDefined();
    await act(async () => {
      fireEvent.press(getByTestId("admin-home-models-grid-Todo-clickable"));
      fireEvent.press(getByTestId("admin-home-model-add-Todo"));
    });
    expect(pushes).toEqual(["/console/Todo", "/console/Todo/create"]);
  });

  it("opens feature flags and renders the missing-model fallback", async () => {
    pushes.length = 0;
    const rendered = renderWithTheme(
      <FeatureFlagsOverridesWidget {...baseProps} featureFlagModel={model} />
    );
    await act(async () => {
      fireEvent.press(rendered.getByText("Open Todos"));
    });
    expect(pushes).toEqual(["/console/Todo"]);
    rendered.unmount();

    const missing = renderWithTheme(<FeatureFlagsOverridesWidget {...baseProps} />);
    expect(missing.getByText(/No FeatureFlag model/)).toBeDefined();
  });

  it("opens the script runner from the home widget", async () => {
    pushes.length = 0;
    const rendered = renderWithTheme(<ScriptRunnerWidget {...baseProps} />);
    await act(async () => {
      fireEvent.press(rendered.getByText("Open scripts"));
    });
    expect(pushes).toEqual(["/console/__scripts"]);
  });
});
