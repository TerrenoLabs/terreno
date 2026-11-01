import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse, AdminModelConfig} from "../types";

const routerPush = mock(() => {});
mock.module("expo-router", () => ({
  router: {push: routerPush},
}));

let listState: {data?: unknown; isError: boolean; isLoading: boolean} = {
  data: {
    data: [
      {
        _id: "a1",
        createdAt: "2024-01-01T00:00:00Z",
        modelName: "User",
        recordLabel: "Ada",
        verb: "update",
      },
    ],
    total: 4,
  },
  isError: false,
  isLoading: false,
};

mock.module("../useAdminApi", () => ({
  useAdminApi: () => ({
    useListQuery: (_args?: unknown, opts?: {skip?: boolean}) => {
      if (opts?.skip) {
        return {data: undefined, isError: false, isLoading: false};
      }
      return listState;
    },
  }),
}));

mock.module("../DocumentStorageBrowser", () => ({
  DocumentStorageBrowser: (props: Record<string, unknown>) =>
    React.createElement("DocumentStorageBrowser", {testID: "documents-browser", ...props}),
}));

import {AIRequestsScreenWidget} from "../widgets/AIRequestsScreenWidget";
import {DocumentsScreenWidget} from "../widgets/DocumentsScreenWidget";
import {FeatureFlagsOverridesWidget} from "../widgets/FeatureFlagsOverridesWidget";
import {ModelsGridWidget} from "../widgets/ModelsGridWidget";
import {RecentActivityWidget} from "../widgets/RecentActivityWidget";

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

const model: AdminModelConfig = {
  defaultSort: "-created",
  displayName: "User",
  fieldOrder: ["email"],
  fields: {email: {required: true, type: "string"}},
  listFields: ["email"],
  name: "User",
  routePath: "/admin/users",
};

const makeExplorerApi = (): AdminApi => {
  return {
    injectEndpoints: () => ({
      useAdminAiRequestsExplorerQuery: () => ({
        data: {data: [{id: "r1"}], total: 21},
        isLoading: false,
      }),
    }),
  } as unknown as AdminApi;
};

describe("admin home and screen widgets", () => {
  beforeEach(() => {
    routerPush.mockClear();
    listState = {
      data: {
        data: [
          {
            _id: "a1",
            createdAt: "2024-01-01T00:00:00Z",
            modelName: "User",
            recordLabel: "Ada",
            verb: "update",
          },
        ],
        total: 4,
      },
      isError: false,
      isLoading: false,
    };
  });

  it("shows the empty recent-activity copy when no audit model is configured", () => {
    const {getByText} = renderWithTheme(
      <RecentActivityWidget
        api={makeExplorerApi()}
        apiBase="/admin"
        config={emptyConfig}
        models={[]}
        routeBase="/admin"
      />
    );
    expect(getByText(/Register AuditApp \(or an AdminAuditLog model\)/)).toBeDefined();
  });

  it("renders audit rows when an audit model is present", () => {
    const {getByText} = renderWithTheme(
      <RecentActivityWidget
        api={makeExplorerApi()}
        apiBase="/admin"
        auditModel={model}
        config={emptyConfig}
        models={[model]}
        routeBase="/admin"
      />
    );
    expect(getByText(/update/)).toBeDefined();
  });

  it("shows loading and error states for recent activity", () => {
    listState = {isError: false, isLoading: true};
    const loading = renderWithTheme(
      <RecentActivityWidget
        api={makeExplorerApi()}
        apiBase="/admin"
        auditModel={model}
        config={emptyConfig}
        models={[model]}
        routeBase="/admin"
      />
    );
    expect(loading.toJSON()).toBeDefined();

    listState = {isError: true, isLoading: false};
    const errored = renderWithTheme(
      <RecentActivityWidget
        api={makeExplorerApi()}
        apiBase="/admin"
        auditModel={model}
        config={emptyConfig}
        models={[model]}
        routeBase="/admin"
      />
    );
    expect(errored.getByText(/Could not load audit entries/)).toBeDefined();

    listState = {data: {data: []}, isError: false, isLoading: false};
    const empty = renderWithTheme(
      <RecentActivityWidget
        api={makeExplorerApi()}
        apiBase="/admin"
        auditModel={model}
        config={emptyConfig}
        models={[model]}
        routeBase="/admin"
      />
    );
    expect(empty.getByText(/No audit entries yet/)).toBeDefined();
  });

  it("opens a feature-flag model from the home widget", async () => {
    const {getByText} = renderWithTheme(
      <FeatureFlagsOverridesWidget
        api={makeExplorerApi()}
        apiBase="/admin"
        config={emptyConfig}
        featureFlagModel={model}
        models={[model]}
        routeBase="/admin/"
      />
    );
    await act(async () => {
      fireEvent.press(getByText("Open User"));
    });
    expect(routerPush).toHaveBeenCalled();
  });

  it("shows a missing feature-flag message", () => {
    const {getByText} = renderWithTheme(
      <FeatureFlagsOverridesWidget
        api={makeExplorerApi()}
        apiBase="/admin"
        config={emptyConfig}
        models={[]}
        routeBase="/admin"
      />
    );
    expect(getByText(/No FeatureFlag model/)).toBeDefined();
  });

  it("renders the documents screen widget", () => {
    const {getByTestId} = renderWithTheme(
      <DocumentsScreenWidget
        api={makeExplorerApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="documents"
      />
    );
    expect(getByTestId("documents-browser")).toBeDefined();
  });

  it("renders the AI explorer", () => {
    const {toJSON} = renderWithTheme(
      <AIRequestsScreenWidget
        api={makeExplorerApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="aiRequests"
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("navigates from the models grid", async () => {
    const {getByText, getByTestId} = renderWithTheme(
      <ModelsGridWidget
        api={makeExplorerApi()}
        apiBase="/admin"
        config={emptyConfig}
        models={[model]}
        routeBase="/admin/"
      />
    );
    expect(getByText("User")).toBeDefined();
    expect(getByTestId("admin-home-widget-modelsGrid")).toBeDefined();
  });
});
