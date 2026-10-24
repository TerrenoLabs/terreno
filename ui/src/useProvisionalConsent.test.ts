import {describe, expect, it, mock} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";

import {
  type ProvisionalConsentApi,
  type ProvisionalConsentStatusRow,
  useProvisionalConsent,
} from "./useProvisionalConsent";

interface CapturedQuery {
  providesTags: string[];
  query: (userId: string) => string;
}

interface CapturedMutation {
  invalidatesTags: string[];
  query: (args: Record<string, unknown>) => {body: unknown; method: string; url: string};
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
  state: {data?: unknown; error?: unknown; isLoading?: boolean} = {},
  signResult: () => Promise<unknown> = () => Promise.resolve({}),
  voidResult: () => Promise<unknown> = () => Promise.resolve({})
): {
  voidedArgs: unknown[];
  api: ProvisionalConsentApi;
  captured: CapturedQuery[];
  capturedMutations: CapturedMutation[];
  addTagTypes: string[][];
  queriedUserIds: string[];
  signedBodies: unknown[];
} => {
  const captured: CapturedQuery[] = [];
  const capturedMutations: CapturedMutation[] = [];
  const addTagTypes: string[][] = [];
  const queriedUserIds: string[] = [];
  const signedBodies: unknown[] = [];
  const voidedArgs: unknown[] = [];
  const api = {
    enhanceEndpoints: mock((options: {addTagTypes: string[]}) => {
      addTagTypes.push(options.addTagTypes);
      return {
        injectEndpoints: mock(
          (options: {
            endpoints: (build: {
              mutation: (def: CapturedMutation) => unknown;
              query: (def: CapturedQuery) => unknown;
            }) => unknown;
          }) => {
            options.endpoints({
              mutation: (def: CapturedMutation) => {
                capturedMutations.push(def);
                return def;
              },
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
              useSignConsentProvisionallyMutation: () => [
                (body: unknown) => {
                  signedBodies.push(body);
                  return {unwrap: signResult};
                },
                {isLoading: false},
              ],
              useVoidProvisionalConsentMutation: () => [
                (args: unknown) => {
                  voidedArgs.push(args);
                  return {unwrap: voidResult};
                },
                {isLoading: false},
              ],
            };
          }
        ),
      };
    }),
  } as unknown as ProvisionalConsentApi;
  return {addTagTypes, api, captured, capturedMutations, queriedUserIds, signedBodies, voidedArgs};
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

  it("defines the provisional sign mutation and invalidates statuses and pending consents", () => {
    const {api, capturedMutations} = buildApi({data: []});
    renderHook(() => useProvisionalConsent({api, baseUrl: "/api", userId: "a"}));

    expect(capturedMutations).toHaveLength(2);
    expect(capturedMutations[0].invalidatesTags).toEqual(["ConsentStatus", "PendingConsents"]);
    const body = {consentFormId: "form-1", note: "Phone", userId: "a"};
    expect(capturedMutations[0].query(body)).toEqual({
      body,
      method: "POST",
      url: "/api/consent-responses/provisional",
    });
  });

  it("signs for the hook's user and unwraps the response envelope", async () => {
    const response = {_id: "response-1", agreedAt: "2026-10-20T15:30:00.000Z"};
    const {api, signedBodies} = buildApi({data: []}, () => Promise.resolve({data: response}));
    const {result} = renderHook(() => useProvisionalConsent({api, userId: "member-1"}));

    let signed: unknown;
    await act(async () => {
      signed = await result.current.sign({consentFormId: "form-1", locale: "en", note: "Phone"});
    });

    expect(signedBodies).toEqual([
      {consentFormId: "form-1", locale: "en", note: "Phone", userId: "member-1"},
    ]);
    expect(signed).toEqual(response);
    expect(result.current.isSigning).toBe(false);
  });

  it("returns an already-unwrapped sign response as is", async () => {
    const response = {_id: "response-2", agreedAt: "2026-10-20T15:30:00.000Z"};
    const {api} = buildApi({data: []}, () => Promise.resolve(response));
    const {result} = renderHook(() => useProvisionalConsent({api, userId: "member-1"}));

    let signed: unknown;
    await act(async () => {
      signed = await result.current.sign({consentFormId: "form-1", note: "Phone"});
    });
    expect(signed).toEqual(response);
  });

  it("rejects with the server error when signing fails", async () => {
    const error = {data: {title: "Consent form is not active"}, status: 400};
    const {api} = buildApi({data: []}, () => Promise.reject(error));
    const {result} = renderHook(() => useProvisionalConsent({api, userId: "member-1"}));

    await expect(result.current.sign({consentFormId: "form-1", note: "Phone"})).rejects.toBe(error);
  });

  it("defines the void mutation for a response id", () => {
    const {api, capturedMutations} = buildApi({data: []});
    renderHook(() => useProvisionalConsent({api, baseUrl: "/api", userId: "a"}));

    expect(capturedMutations[1].invalidatesTags).toEqual(["ConsentStatus", "PendingConsents"]);
    expect(capturedMutations[1].query({reason: "Wrong member", responseId: "resp 1"})).toEqual({
      body: {reason: "Wrong member"},
      method: "POST",
      url: "/api/consent-responses/resp%201/void",
    });
  });

  it("voids a signature and unwraps the response", async () => {
    const response = {_id: "response-1", voidedAt: "2026-10-21T09:00:00.000Z"};
    const {api, voidedArgs} = buildApi({data: []}, undefined, () =>
      Promise.resolve({data: response})
    );
    const {result} = renderHook(() => useProvisionalConsent({api, userId: "member-1"}));

    let voided: unknown;
    await act(async () => {
      voided = await result.current.voidSignature({reason: "Wrong member", responseId: "r1"});
    });

    expect(voidedArgs).toEqual([{reason: "Wrong member", responseId: "r1"}]);
    expect(voided).toEqual(response);
    expect(result.current.isVoiding).toBe(false);
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
