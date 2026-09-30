import {describe, expect, it, mock} from "bun:test";
import {Text} from "@terreno/ui";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import {AiObservabilityChrome} from "../widgets/aiObservability/shell/AiObservabilityChrome";
import {AI_OBSERVABILITY_WIDGETS} from "../widgets/aiObservability/shell/AiObservabilityScreenWidgets";
import {AiObservabilityStatusChip} from "../widgets/aiObservability/shell/AiObservabilityStatusChip";
import {
  buildAiObservabilityBreadcrumbs,
  formatObservabilityStatusChip,
  type ObservabilityStatusPayload,
  unwrapObservabilityStatus,
} from "../widgets/aiObservability/shell/aiObservabilityNav";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

const localOnStatus: ObservabilityStatusPayload = {
  localOn: true,
  plugins: [{capabilities: ["prompts", "reviewQueue", "traces"], id: "local"}],
  primaries: {
    datasets: "local",
    experiments: "local",
    prompts: "local",
    reviewQueue: "local",
  },
};

const localOffStatus: ObservabilityStatusPayload = {
  localOn: false,
  plugins: [{capabilities: ["prompts", "traces"], id: "langfuse"}],
  primaries: {
    datasets: "langfuse",
    experiments: "langfuse",
    prompts: "langfuse",
    reviewQueue: "local",
  },
};

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
const stubApi = {} as unknown as AdminApi;

describe("AI observability chrome", () => {
  it("formats the status chip for local on and local off primaries", () => {
    expect(formatObservabilityStatusChip(localOnStatus)).toBe(
      "Local on · prompts:local · datasets:local · experiments:local"
    );
    expect(formatObservabilityStatusChip(localOffStatus)).toBe(
      "Local off · prompts:langfuse · datasets:langfuse · experiments:langfuse"
    );
  });

  it("unwraps both envelope and already-unwrapped status payloads", () => {
    expect(unwrapObservabilityStatus({data: localOnStatus})).toEqual(localOnStatus);
    expect(unwrapObservabilityStatus(localOnStatus)).toEqual(localOnStatus);
  });

  it("builds Admin / AI Observability / Section / leaf breadcrumbs", () => {
    const crumbs = buildAiObservabilityBreadcrumbs({
      routeBase: "/admin",
      screenName: "ai-review-item",
    });
    expect(crumbs.map((crumb) => crumb.label)).toEqual([
      "Admin",
      "AI Observability",
      "Review",
      "Item",
    ]);
  });

  it("renders loading, error, local-on, and local-off chip states", () => {
    const loading = renderWithTheme(<AiObservabilityStatusChip isLoading />);
    expect(loading.getByText("Checking observability…")).toBeTruthy();

    const errored = renderWithTheme(<AiObservabilityStatusChip error />);
    expect(errored.getByText("Observability unavailable")).toBeTruthy();

    const on = renderWithTheme(<AiObservabilityStatusChip status={localOnStatus} />);
    expect(
      on.getByText("Local on · prompts:local · datasets:local · experiments:local")
    ).toBeTruthy();

    const off = renderWithTheme(<AiObservabilityStatusChip status={localOffStatus} />);
    expect(
      off.getByText("Local off · prompts:langfuse · datasets:langfuse · experiments:langfuse")
    ).toBeTruthy();
  });

  it("fetches loading and error states through the injected api", () => {
    const loadingApi = {
      enhanceEndpoints: () => loadingApi,
      injectEndpoints: () => ({
        useAiObservabilityStatusQuery: () => ({
          data: undefined,
          isError: false,
          isLoading: true,
        }),
      }),
    } as unknown as AdminApi;
    const loading = renderWithTheme(<AiObservabilityStatusChip api={loadingApi} />);
    expect(loading.getByText("Checking observability…")).toBeTruthy();

    const errorApi = {
      enhanceEndpoints: () => errorApi,
      injectEndpoints: () => ({
        useAiObservabilityStatusQuery: () => ({
          data: undefined,
          isError: true,
          isLoading: false,
        }),
      }),
    } as unknown as AdminApi;
    const errored = renderWithTheme(<AiObservabilityStatusChip api={errorApi} />);
    expect(errored.getByText("Observability unavailable")).toBeTruthy();

    const unwrappedApi = {
      enhanceEndpoints: () => unwrappedApi,
      injectEndpoints: () => ({
        useAiObservabilityStatusQuery: () => ({
          data: localOnStatus,
          isError: false,
          isLoading: false,
        }),
      }),
    } as unknown as AdminApi;
    const unwrapped = renderWithTheme(<AiObservabilityStatusChip api={unwrappedApi} />);
    expect(
      unwrapped.getByText("Local on · prompts:local · datasets:local · experiments:local")
    ).toBeTruthy();

    const missingStatusApi = {
      enhanceEndpoints: () => missingStatusApi,
      injectEndpoints: () => ({
        useAiObservabilityStatusQuery: () => ({
          data: undefined,
          isError: false,
          isLoading: false,
        }),
      }),
    } as unknown as AdminApi;
    const missingStatus = renderWithTheme(<AiObservabilityStatusChip api={missingStatusApi} />);
    expect(missingStatus.getByText("Observability unavailable")).toBeTruthy();
  });

  it("fetches status through the injected api when props are omitted", () => {
    let statusQuery: (() => {method: string; url: string}) | undefined;
    const api = {
      enhanceEndpoints: () => api,
      injectEndpoints: (config: {
        endpoints: (build: {
          query: (definition: {query: () => {method: string; url: string}}) => {
            query: () => {method: string; url: string};
          };
        }) => Record<string, {query: () => {method: string; url: string}}>;
      }) => {
        const endpoints = config.endpoints({
          query: (definition) => definition,
        });
        statusQuery = endpoints.aiObservabilityStatus?.query;
        return {
          useAiObservabilityStatusQuery: () => ({
            data: {data: localOnStatus},
            isError: false,
            isLoading: false,
          }),
        };
      },
    } as unknown as AdminApi;
    const fetched = renderWithTheme(<AiObservabilityStatusChip api={api} />);
    expect(
      fetched.getByText("Local on · prompts:local · datasets:local · experiments:local")
    ).toBeTruthy();
    assert.deepEqual(statusQuery?.(), {method: "GET", url: "/ai/observability/status"});
  });

  it("shows unavailable chip when api is omitted and no status props are passed", () => {
    const missingApi = renderWithTheme(<AiObservabilityStatusChip />);
    expect(missingApi.getByText("Observability unavailable")).toBeTruthy();
  });

  it("hides review queue content when the local plugin is off", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AiObservabilityChrome
        api={stubApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review"
        status={localOffStatus}
      />
    );
    expect(getByTestId("ai-observability-review-hidden")).toBeTruthy();
    expect(queryByTestId("ai-observability-placeholder-ai-review")).toBeNull();
  });

  it("hides review item content when the local plugin is off", () => {
    const {getByTestId, queryByText} = renderWithTheme(
      <AiObservabilityChrome
        api={stubApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
        status={localOffStatus}
      >
        <Text>Private review body</Text>
      </AiObservabilityChrome>
    );
    expect(getByTestId("ai-observability-review-hidden")).toBeTruthy();
    expect(queryByText("Private review body")).toBeNull();
  });

  it("registers phase 2 screen widgets including evaluators, datasets, and experiments", () => {
    expect(Object.keys(AI_OBSERVABILITY_WIDGETS).sort()).toEqual([
      "ai-dataset-detail",
      "ai-datasets",
      "ai-evaluator-detail",
      "ai-evaluator-new",
      "ai-evaluators",
      "ai-experiment-new",
      "ai-experiment-results",
      "ai-experiments",
      "ai-prompt-editor",
      "ai-prompts",
      "ai-review",
      "ai-review-item",
      "ai-trace-detail",
      "ai-traces",
    ]);
  });
});
