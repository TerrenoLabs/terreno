import {afterEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {
  type CapturedObservabilityRequest,
  flushObservabilityRequests,
  ObservabilityTestProvider,
  stubObservabilityFetch,
} from "../../../testing/observabilityTestUtils";
import {useAiObservabilityReviewApi} from "./useAiObservabilityReviewApi";

let restoreFetch: () => void = () => undefined;

const stub = (): CapturedObservabilityRequest[] => {
  const {calls, restore} = stubObservabilityFetch(() => ({body: {data: {_id: "rev-1"}}}));
  restoreFetch = restore;
  return calls;
};

afterEach(() => {
  restoreFetch();
});

describe("useAiObservabilityReviewApi", () => {
  it("reads the queue, item, current user, and status routes", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityReviewApi();
        return {
          detail: api.useDetailQuery("rev 1"),
          list: api.useListQuery("pending"),
          me: api.useCurrentUserQuery(),
          status: api.useStatusQuery(),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();

    expect(calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /ai/observability/review/rev%201",
      "GET /ai/observability/review?status=pending",
      "GET /ai/observability/status",
      "GET /auth/me",
    ]);
    expect(result.current.detail.data).toEqual({_id: "rev-1"});
  });

  it("skips the item query when asked", async () => {
    const calls = stub();
    renderHook(() => useAiObservabilityReviewApi().useDetailQuery("rev-1", {skip: true}), {
      wrapper: ObservabilityTestProvider,
    });
    await flushObservabilityRequests();
    expect(calls).toHaveLength(0);
  });

  it("posts review actions and refetches the queue", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityReviewApi();
        return {action: api.useActionMutation(), list: api.useListQuery("pending")};
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();
    calls.length = 0;

    let detail: unknown;
    await act(async () => {
      detail = await result.current.action[0]({body: {action: "submit"}, id: "rev-1"}).unwrap();
    });
    await flushObservabilityRequests();

    expect(detail).toEqual({_id: "rev-1"});
    expect(calls[0]).toMatchObject({
      body: {action: "submit"},
      method: "POST",
      url: "/ai/observability/review/rev-1",
    });
    expect(calls.map((call) => call.url)).toContain("/ai/observability/review?status=pending");
  });
});
