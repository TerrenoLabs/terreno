import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import * as TerrenoUI from "@terreno/ui";
import {act} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

import type {AdminConfigResponse} from "../types";
import {AI_ADMIN_WIDGETS, AIRequestsScreenWidget} from "./AIRequestsScreenWidget";

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

let explorerProps: Record<string, unknown> | undefined;
let explorerData: {data: unknown[]; total: number} = {data: [], total: 0};
let holdResponses = false;
const requestedUrls: string[] = [];
const originalFetch = globalThis.fetch;

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

const lastQuery = (): Record<string, string> => {
  const url = requestedUrls.at(-1) ?? "";
  return Object.fromEntries(new URL(url, "http://localhost").searchParams.entries());
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderWidget = async (): Promise<ReturnType<typeof renderWithTheme>> => {
  const rendered = renderWithTheme(
    <AIRequestsScreenWidget config={emptyConfig} routeBase="/admin" screenName="ai-requests" />
  );
  await flush();
  return rendered;
};

describe("AIRequestsScreenWidget", () => {
  beforeEach(() => {
    explorerProps = undefined;
    explorerData = {data: [{id: "req-1"}], total: 21};
    holdResponses = false;
    requestedUrls.length = 0;
    globalThis.fetch = (async (url: string) => {
      requestedUrls.push(String(url));
      if (holdResponses) {
        return new Promise<Response>(() => undefined);
      }
      return new Response(JSON.stringify({...explorerData, limit: 20, more: false, page: 1}), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("registers the AI explorer widget", () => {
    expect(AI_ADMIN_WIDGETS["ai-requests"]).toBe(AIRequestsScreenWidget);
  });

  it("requests the first explorer page and renders its total", async () => {
    const {getByText} = await renderWidget();

    expect(requestedUrls).toEqual(["/aiRequestsExplorer?limit=20&page=1"]);
    expect(getByText("21 total requests")).toBeTruthy();
    assert.equal(explorerProps?.page, 1);
    assert.equal(explorerProps?.totalCount, 21);
  });

  it("resets page to 1 when filters change and forwards updated query args", async () => {
    await renderWidget();
    assert.isDefined(explorerProps);

    await act(async () => {
      (explorerProps?.onPageChange as (page: number) => void)?.(2);
    });
    await flush();
    assert.equal(lastQuery().page, "2");
    assert.equal(explorerProps?.page, 2);

    await act(async () => {
      (explorerProps?.onRequestTypeFilterChange as (types: string[]) => void)?.([
        "chat",
        "completion",
      ]);
      (explorerProps?.onStartDateChange as (value: string) => void)?.("2024-01-01");
      (explorerProps?.onEndDateChange as (value: string) => void)?.("2024-01-31");
    });
    await flush();

    assert.deepEqual(lastQuery(), {
      endDate: "2024-01-31",
      limit: "20",
      page: "1",
      requestType: "chat,completion",
      startDate: "2024-01-01",
    });
  });

  it("shows loading state while the explorer request is pending", async () => {
    holdResponses = true;
    await renderWidget();
    assert.isTrue(explorerProps?.isLoading);
  });

  it("computes total pages from the response", async () => {
    explorerData = {data: [], total: 45};
    const {getByText} = await renderWidget();
    assert.equal(explorerProps?.totalPages, 3);
    assert.equal(explorerProps?.totalCount, 45);
    expect(getByText("45 total requests")).toBeTruthy();
  });
});
