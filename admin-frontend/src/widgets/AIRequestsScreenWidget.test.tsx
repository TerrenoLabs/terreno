// noExplicitAny: test mocks use type-erased RTK Query API doubles
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import * as TerrenoUI from "@terreno/ui";
import {act} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

import type {AdminApi, AdminConfigResponse} from "../types";
import {AI_ADMIN_WIDGETS, AIRequestsScreenWidget} from "./AIRequestsScreenWidget";

const registrationQueryRequests: Record<string, unknown>[] = [];

const createRegistrationAdminApi = (): AdminApi => {
  const api = {
    injectEndpoints: ({endpoints}: {endpoints: (build: unknown) => Record<string, unknown>}) => {
      const definitions = endpoints({query: (definition: unknown) => definition});
      const query = definitions.adminAiRequestsExplorer as {
        query: (params: Record<string, unknown>) => unknown;
      };
      registrationQueryRequests.push(query.query({limit: 20, page: 1}) as Record<string, unknown>);
      return {
        useAdminAiRequestsExplorerQuery: () => ({
          data: {data: [], limit: 20, more: false, page: 1, total: 21},
          isLoading: false,
        }),
      };
    },
  };
  return api as unknown as AdminApi;
};

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

let explorerQueryArg: Record<string, unknown> | undefined;
let explorerProps: Record<string, unknown> | undefined;
let explorerData: {data: unknown[]; total: number} | undefined;
let explorerLoading = false;

const ExplorerStub: React.FC<Record<string, unknown>> = (props) => {
  explorerProps = props;
  return (
    <TerrenoUI.Box testID={props.testID as string}>
      <TerrenoUI.Text>{`${props.totalCount} total requests`}</TerrenoUI.Text>
      {props.isLoading ? <TerrenoUI.Spinner /> : null}
    </TerrenoUI.Box>
  );
};

mock.module("../AdminScreenPage", () => ({
  AdminScreenPage: ({children}: {children: React.ReactNode}) => children,
}));

mock.module("@terreno/ui", () => ({
  ...TerrenoUI,
  AIRequestExplorer: ExplorerStub,
}));

const makeExplorerApi = (): AdminApi =>
  ({
    injectEndpoints: () => ({
      useAdminAiRequestsExplorerQuery: (arg: Record<string, unknown>) => {
        explorerQueryArg = arg;
        return {data: explorerData, isLoading: explorerLoading};
      },
    }),
  }) as unknown as AdminApi;

describe("AIRequestsScreenWidget", () => {
  it("registers the AI explorer widget", () => {
    expect(AI_ADMIN_WIDGETS["ai-requests"]).toBe(AIRequestsScreenWidget);
  });

  it("injects the explorer endpoint and renders the first page", () => {
    registrationQueryRequests.length = 0;
    const {getByText} = renderWithTheme(
      <AIRequestsScreenWidget
        api={createRegistrationAdminApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-requests"
      />
    );

    expect(registrationQueryRequests).toEqual([
      {
        method: "GET",
        params: {limit: 20, page: 1},
        url: "/aiRequestsExplorer",
      },
    ]);
    expect(getByText("21 total requests")).toBeDefined();
  });

  beforeEach(() => {
    explorerQueryArg = undefined;
    explorerProps = undefined;
    explorerData = {data: [{id: "req-1"}], total: 21};
    explorerLoading = false;
  });

  it("requests explorer data with the current page and filters", () => {
    const {getByText} = renderWithTheme(
      <AIRequestsScreenWidget
        api={makeExplorerApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="aiRequests"
      />
    );

    expect(getByText("21 total requests")).toBeTruthy();
    assert.deepEqual(explorerQueryArg, {
      endDate: undefined,
      limit: 20,
      page: 1,
      requestType: undefined,
      startDate: undefined,
    });
    assert.equal(explorerProps?.page, 1);
    assert.equal(explorerProps?.totalCount, 21);
  });

  it("resets page to 1 when filters change and forwards updated query args", async () => {
    renderWithTheme(
      <AIRequestsScreenWidget
        api={makeExplorerApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="aiRequests"
      />
    );
    assert.isDefined(explorerProps);

    await act(async () => {
      (explorerProps?.onRequestTypeFilterChange as (types: string[]) => void)?.(["json_object"]);
      (explorerProps?.onStartDateChange as (value: string) => void)?.("2024-01-01");
      (explorerProps?.onEndDateChange as (value: string) => void)?.("2024-01-31");
    });

    assert.equal(explorerQueryArg?.page, 1);
    assert.equal(explorerQueryArg?.requestType, "json_object");
    assert.equal(explorerQueryArg?.startDate, "2024-01-01");
    assert.equal(explorerQueryArg?.endDate, "2024-01-31");

    await act(async () => {
      (explorerProps?.onPageChange as (page: number) => void)?.(2);
    });
    assert.equal(explorerQueryArg?.page, 2);
    assert.equal(explorerProps?.page, 2);
  });

  it("shows loading state and computes total pages from the response", () => {
    explorerLoading = true;
    explorerData = {data: [], total: 45};
    const {getByText} = renderWithTheme(
      <AIRequestsScreenWidget
        api={makeExplorerApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="aiRequests"
      />
    );

    assert.isTrue(explorerProps?.isLoading);
    assert.equal(explorerProps?.totalPages, 3);
    assert.equal(explorerProps?.totalCount, 45);
    expect(getByText("45 total requests")).toBeTruthy();
  });
});
