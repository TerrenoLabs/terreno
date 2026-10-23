import {describe, expect, it, mock} from "bun:test";
import {renderHook} from "@testing-library/react-native";

import {
  type ProvisionalConsentApi,
  type ProvisionalConsentStatusRow,
  useProvisionalConsent,
} from "./useProvisionalConsent";

interface CapturedQuery {
  providesTags: string[];
  query: (userId: string) => string;
}

const row: ProvisionalConsentStatusRow = {
  form: {
    active: true,
    agreeButtonText: "I agree",
    allowDecline: true,
    captureSignature: false,
    checkboxes: [],
    content: {en: "# Telehealth"},
    declineButtonText: "Decline",
    defaultLocale: "en",
    id: "form-1",
    order: 1,
    required: true,
    requireScrollToBottom: false,
    slug: "telehealth",
    title: "Telehealth",
    type: "agreement",
    version: 1,
  },
  isConsented: false,
  status: "pending",
};

const buildApi = (
  state: {data?: unknown; error?: unknown; isLoading?: boolean} = {}
): {
  api: ProvisionalConsentApi;
  captured: CapturedQuery[];
  addTagTypes: string[][];
  queriedUserIds: string[];
} => {
  const captured: CapturedQuery[] = [];
  const addTagTypes: string[][] = [];
  const queriedUserIds: string[] = [];
  const api = {
    enhanceEndpoints: mock((options: {addTagTypes: string[]}) => {
      addTagTypes.push(options.addTagTypes);
      return {
        injectEndpoints: mock(
          (options: {endpoints: (build: {query: (def: CapturedQuery) => unknown}) => unknown}) => {
            options.endpoints({
              query: (def: CapturedQuery) => {
                captured.push(def);
                return def;
              },
            });
            return {
              useGetConsentStatusQuery: (userId: string) => {
                queriedUserIds.push(userId);
                return {
                  data: state.data,
                  error: state.error,
                  isLoading: state.isLoading ?? false,
                  refetch: () => {},
                };
              },
            };
          }
        ),
      };
    }),
  } as unknown as ProvisionalConsentApi;
  return {addTagTypes, api, captured, queriedUserIds};
};

describe("useProvisionalConsent", () => {
  it("queries the status endpoint for the user under the base URL", () => {
    const {api, captured, addTagTypes, queriedUserIds} = buildApi({data: {data: [row]}});

    const {result} = renderHook(() =>
      useProvisionalConsent({api, baseUrl: "/api", userId: "user 1"})
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].query("user 1")).toBe("/api/consent-responses/status?userId=user%201");
    expect(captured[0].providesTags).toEqual(["ConsentStatus"]);
    expect(addTagTypes[0]).toEqual(["ConsentStatus", "PendingConsents"]);
    expect(queriedUserIds).toContain("user 1");
    expect(result.current.statuses).toEqual([row]);
    expect(result.current.isLoading).toBe(false);
  });

  it("injects the endpoint once per api and base URL", () => {
    const {api, captured} = buildApi({data: {data: []}});

    renderHook(() => useProvisionalConsent({api, userId: "a"}));
    renderHook(() => useProvisionalConsent({api, userId: "b"}));
    renderHook(() => useProvisionalConsent({api, baseUrl: "/v2", userId: "a"}));

    expect(captured).toHaveLength(2);
    expect(captured[0].query("a")).toBe("/consent-responses/status?userId=a");
    expect(captured[1].query("a")).toBe("/v2/consent-responses/status?userId=a");
  });

  it("accepts an unwrapped array response", () => {
    const {api} = buildApi({data: [row]});
    const {result} = renderHook(() => useProvisionalConsent({api, userId: "a"}));
    expect(result.current.statuses).toEqual([row]);
  });

  it("returns no statuses while loading and passes the error through", () => {
    const error = {status: 405};
    const {api} = buildApi({error, isLoading: true});
    const {result} = renderHook(() => useProvisionalConsent({api, userId: "a"}));
    expect(result.current.statuses).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBe(error);
  });
});
