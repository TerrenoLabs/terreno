import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {ReviewDetail, ReviewListItem} from "../widgets/aiObservability/review/reviewTypes";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({id: reviewId}),
}));

import {AiReviewItemScreenWidget} from "../widgets/aiObservability/review/AiReviewItemScreen";

let reviewId = "rev-1";

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

const detail: ReviewDetail = {
  dimensions: [{dataType: "boolean", key: "correct", required: true}],
  evaluatorId: "eval-1",
  id: "rev-1",
  panels: {given: [], wrote: []},
  status: "pending",
  traceId: "trace-1",
};

const pending: ReviewListItem[] = [
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

const actionImpl = mock(async () => detail);

let actionShouldFail = false;

const createApi = (options?: {currentUserId?: string}): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityCurrentUserQuery: () => ({
        data: options?.currentUserId === "" ? undefined : {id: options?.currentUserId ?? "user-1"},
        isLoading: false,
      }),
      useAiObservabilityReviewItemQuery: () => ({
        data: detail,
        isError: false,
        isLoading: false,
        refetch: mock(() => {}),
      }),
      useAiObservabilityReviewQuery: () => ({
        data: {counts: {done: 0, in_progress: 0, pending: 1, skipped: 0}, data: pending},
        isError: false,
        isLoading: false,
        refetch: mock(() => {}),
      }),
      useAiObservabilityStatusQuery: () => ({
        data: statusData,
        isError: false,
        isLoading: false,
      }),
      useUpdateAiObservabilityReviewItemMutation: () => [
        () => ({
          unwrap: async () => {
            if (actionShouldFail) {
              throw new Error("action failed");
            }
            return actionImpl();
          },
        }),
        {isError: false, isLoading: false},
      ],
    }),
  };
  return api as unknown as AdminApi;
};

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

describe("AiReviewItemScreenWidget", () => {
  it("shows loading then review item with score controls", () => {
    const loadingApi = {
      enhanceEndpoints: () => loadingApi,
      injectEndpoints: () => ({
        useAiObservabilityCurrentUserQuery: () => ({data: undefined, isLoading: false}),
        useAiObservabilityReviewItemQuery: () => ({
          data: undefined,
          isError: false,
          isLoading: true,
          refetch: mock(() => {}),
        }),
        useAiObservabilityReviewQuery: () => ({
          data: {data: pending},
          isError: false,
          isLoading: false,
          refetch: mock(() => {}),
        }),
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
        useUpdateAiObservabilityReviewItemMutation: () => [
          () => ({unwrap: actionImpl}),
          {isError: false, isLoading: false},
        ],
      }),
    } as unknown as AdminApi;
    const loading = renderWithTheme(
      <AiReviewItemScreenWidget
        api={loadingApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
      />
    );
    expect(loading.getByTestId("ai-review-item-loading")).toBeTruthy();
    loading.unmount();

    const loaded = renderWithTheme(
      <AiReviewItemScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
      />
    );
    expect(loaded.getByTestId("ai-review-item")).toBeTruthy();
    expect(loaded.getByTestId("ai-review-score-boolean-correct")).toBeTruthy();
  });

  it("requires scores before submit and submits on pass", async () => {
    actionImpl.mockClear();
    const view = renderWithTheme(
      <AiReviewItemScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
      />
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-submit-next"));
      await Promise.resolve();
    });
    expect(view.getByText("Score correct before submitting.")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-score-correct-pass"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-submit-next"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(actionImpl.mock.calls.length, 1);
  });

  it("shows missing id and load error with retry", async () => {
    reviewId = "";
    const missing = renderWithTheme(
      <AiReviewItemScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
      />
    );
    expect(missing.getByText(/Missing review item id/)).toBeTruthy();
    missing.unmount();
    reviewId = "rev-1";

    const refetch = mock(() => {});
    const errorApi = {
      enhanceEndpoints: () => errorApi,
      injectEndpoints: () => ({
        useAiObservabilityCurrentUserQuery: () => ({data: {id: "user-1"}, isLoading: false}),
        useAiObservabilityReviewItemQuery: () => ({
          data: undefined,
          isError: true,
          isLoading: false,
          refetch,
        }),
        useAiObservabilityReviewQuery: () => ({
          data: {data: pending},
          isError: false,
          isLoading: false,
          refetch: mock(() => {}),
        }),
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
        useUpdateAiObservabilityReviewItemMutation: () => [
          () => ({unwrap: actionImpl}),
          {isError: false, isLoading: false},
        ],
      }),
    } as unknown as AdminApi;
    const errored = renderWithTheme(
      <AiReviewItemScreenWidget
        api={errorApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
      />
    );
    await act(async () => {
      fireEvent.press(errored.getByText("Retry"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    assert.isAtLeast(refetch.mock.calls.length, 1);
  });

  it("skips, assigns, and surfaces action errors", async () => {
    actionShouldFail = false;
    actionImpl.mockClear();
    routerPush.mockClear();
    const view = renderWithTheme(
      <AiReviewItemScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
      />
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-skip"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.isAtLeast(actionImpl.mock.calls.length, 1);

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-assign"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(actionImpl.mock.calls.length, 2);

    actionShouldFail = true;
    const failing = renderWithTheme(
      <AiReviewItemScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
      />
    );
    await act(async () => {
      fireEvent.press(failing.getByTestId("ai-review-skip"));
      await Promise.resolve();
    });
    expect(failing.getByText("Could not skip this review.")).toBeTruthy();

    const noUser = renderWithTheme(
      <AiReviewItemScreenWidget
        api={createApi({currentUserId: ""})}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
      />
    );
    await act(async () => {
      fireEvent.press(noUser.getByTestId("ai-review-assign"));
      await Promise.resolve();
    });
    expect(noUser.getByText("Could not identify the current admin.")).toBeTruthy();
    actionShouldFail = false;
  });

  it("navigates between pending items and clears the queue", async () => {
    const secondPending: ReviewListItem = {
      enqueuedAt: "2026-01-01T00:01:00.000Z",
      evaluatorId: "eval-1",
      id: "rev-2",
      reason: "manual",
      status: "pending",
      traceId: "trace-2",
      traceName: "summarize",
    };
    const twoPendingApi = {
      enhanceEndpoints: () => twoPendingApi,
      injectEndpoints: () => ({
        useAiObservabilityCurrentUserQuery: () => ({data: {id: "user-1"}, isLoading: false}),
        useAiObservabilityReviewItemQuery: () => ({
          data: detail,
          isError: false,
          isLoading: false,
          refetch: mock(() => {}),
        }),
        useAiObservabilityReviewQuery: () => ({
          data: {
            counts: {done: 0, in_progress: 0, pending: 2, skipped: 0},
            data: [pending[0]!, secondPending],
          },
          isError: false,
          isLoading: false,
          refetch: mock(() => {}),
        }),
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
        useUpdateAiObservabilityReviewItemMutation: () => [
          () => ({unwrap: actionImpl}),
          {isError: false, isLoading: false},
        ],
      }),
    } as unknown as AdminApi;

    routerPush.mockClear();
    const view = renderWithTheme(
      <AiReviewItemScreenWidget
        api={twoPendingApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
      />
    );
    await act(async () => {
      fireEvent.press(view.getByText("Next"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-review-item");

    actionImpl.mockClear();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-score-correct-pass"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.changeText(view.getByTestId("ai-review-comment"), "looks good");
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-submit-next"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.isAtLeast(actionImpl.mock.calls.length, 1);
  });
});
