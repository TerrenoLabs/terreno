import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {ReviewListItem} from "../widgets/aiObservability/review/reviewTypes";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({}),
}));

import {AiReviewScreenWidget} from "../widgets/aiObservability/review/AiReviewQueueScreen";

const statusData = {
  localOn: true,
  plugins: [],
  primaries: {
    datasets: "local",
    experiments: "local",
    prompts: "local",
    reviewQueue: "local",
  },
};

const items: ReviewListItem[] = [
  {
    enqueuedAt: "2026-01-01T00:00:00.000Z",
    evaluatorId: "eval-1",
    id: "rev-1",
    reason: "manual",
    status: "pending",
    traceId: "trace-1",
    traceName: "summarize",
  },
];

const listState = {
  data: {counts: {done: 0, in_progress: 0, pending: 1, skipped: 0}, data: items},
  isError: false,
  isLoading: false,
  refetch: mock(() => {}),
};

const createApi = (): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityReviewQuery: () => listState,
      useAiObservabilityStatusQuery: () => ({
        data: statusData,
        isError: false,
        isLoading: false,
      }),
    }),
  };
  return api as unknown as AdminApi;
};

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

describe("AiReviewScreenWidget", () => {
  it("shows pending queue and opens the oldest item", async () => {
    routerPush.mockClear();
    const view = renderWithTheme(
      <AiReviewScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review"
      />
    );
    expect(view.getByTestId("ai-review-table")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-start-oldest"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-review-item");
  });
});
