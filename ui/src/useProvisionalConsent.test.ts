import {describe, expect, it} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";

import {createFakeRequestClient, fakeHttpError} from "./test-utils";
import {
  type ProvisionalConsentStatusRow,
  provisionalSignerName,
  useProvisionalConsent,
} from "./useProvisionalConsent";

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

/** A fake request client: the status route returns `status`, signing and voiding run `signResult` / `voidResult`. */
const buildClient = ({
  signResult = () => Promise.resolve({}),
  status = {data: []},
  voidResult = () => Promise.resolve({}),
}: {
  signResult?: () => Promise<unknown>;
  status?: unknown | (() => Promise<unknown>);
  voidResult?: () => Promise<unknown>;
} = {}) => {
  const signedBodies: unknown[] = [];
  const voidedArgs: unknown[] = [];
  const fake = createFakeRequestClient({
    "GET /consent-responses/status": async () =>
      typeof status === "function" ? (status as () => Promise<unknown>)() : status,
    "GET /v2/consent-responses/status": async () => status,
    "POST /consent-responses/:id/void": async (args, params) => {
      voidedArgs.push({reason: (args.body as {reason: string}).reason, responseId: params.id});
      return voidResult();
    },
    "POST /consent-responses/provisional": async (args) => {
      signedBodies.push(args.body);
      return signResult();
    },
  });
  return {...fake, signedBodies, voidedArgs};
};

describe("useProvisionalConsent", () => {
  it("requests the status endpoint for the user and returns the rows", async () => {
    const {client, callsTo} = buildClient({status: {data: [row]}});

    const {result} = renderHook(() => useProvisionalConsent({client, userId: "user 1"}));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.statuses).toEqual([row]));
    expect(result.current.isLoading).toBe(false);
    expect(callsTo("GET /consent-responses/status")[0]?.params).toEqual({userId: "user 1"});
  });

  it("prefixes the base URL", async () => {
    const {client, callsTo} = buildClient({status: {data: [row]}});

    const {result} = renderHook(() => useProvisionalConsent({baseUrl: "/v2", client, userId: "a"}));

    await waitFor(() => expect(result.current.statuses).toEqual([row]));
    expect(callsTo("GET /v2/consent-responses/status")).toHaveLength(1);
  });

  it("accepts an unwrapped array response", async () => {
    const {client} = buildClient({status: [row]});
    const {result} = renderHook(() => useProvisionalConsent({client, userId: "a"}));
    await waitFor(() => expect(result.current.statuses).toEqual([row]));
  });

  it("signs for the hook's user, unwraps the envelope, and refetches the statuses", async () => {
    const response = {_id: "response-1", agreedAt: "2026-10-20T15:30:00.000Z"};
    const {client, callsTo, signedBodies} = buildClient({
      signResult: () => Promise.resolve({data: response}),
    });
    const {result} = renderHook(() => useProvisionalConsent({client, userId: "member-1"}));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let signed: unknown;
    await act(async () => {
      signed = await result.current.sign({consentFormId: "form-1", locale: "en", note: "Phone"});
    });

    expect(signedBodies).toEqual([
      {consentFormId: "form-1", locale: "en", note: "Phone", userId: "member-1"},
    ]);
    expect(signed).toEqual(response);
    expect(result.current.isSigning).toBe(false);
    await waitFor(() => expect(callsTo("GET /consent-responses/status").length).toBeGreaterThan(1));
  });

  it("returns an already-unwrapped sign response as is", async () => {
    const response = {_id: "response-2", agreedAt: "2026-10-20T15:30:00.000Z"};
    const {client} = buildClient({signResult: () => Promise.resolve(response)});
    const {result} = renderHook(() => useProvisionalConsent({client, userId: "member-1"}));

    let signed: unknown;
    await act(async () => {
      signed = await result.current.sign({consentFormId: "form-1", note: "Phone"});
    });
    expect(signed).toEqual(response);
  });

  it("rejects with the server error when signing fails", async () => {
    const error = fakeHttpError(400, "Consent form is not active");
    const {client} = buildClient({signResult: () => Promise.reject(error)});
    const {result} = renderHook(() => useProvisionalConsent({client, userId: "member-1"}));

    await act(async () => {
      await expect(result.current.sign({consentFormId: "form-1", note: "Phone"})).rejects.toBe(
        error
      );
    });
  });

  it("voids a signature by response id, unwraps the response, and refetches", async () => {
    const response = {_id: "response-1", voidedAt: "2026-10-21T09:00:00.000Z"};
    const {callsTo, client, voidedArgs} = buildClient({
      voidResult: () => Promise.resolve({data: response}),
    });
    const {result} = renderHook(() => useProvisionalConsent({client, userId: "member-1"}));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let voided: unknown;
    await act(async () => {
      voided = await result.current.voidSignature({reason: "Wrong member", responseId: "resp 1"});
    });

    expect(voidedArgs).toEqual([{reason: "Wrong member", responseId: "resp%201"}]);
    expect(callsTo("POST /consent-responses/:id/void")[0]?.url).toBe(
      "/consent-responses/resp%201/void"
    );
    expect(voided).toEqual(response);
    expect(result.current.isVoiding).toBe(false);
  });

  it("returns no statuses while loading and passes the load error through", async () => {
    const error = fakeHttpError(405, "Method not allowed");
    const {client} = buildClient({status: () => Promise.reject(error)});
    const {result} = renderHook(() => useProvisionalConsent({client, userId: "a"}));

    expect(result.current.statuses).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.error).toBe(error));
  });
});

describe("provisionalSignerName", () => {
  it("prefers the signer's name, then their email", () => {
    expect(provisionalSignerName({email: "dana@example.com", name: "Dana Rivera"})).toBe(
      "Dana Rivera"
    );
    expect(provisionalSignerName({email: "dana@example.com"})).toBe("dana@example.com");
  });

  it("falls back to Staff when the signer is unknown or not populated", () => {
    expect(provisionalSignerName({})).toBe("Staff");
    expect(provisionalSignerName(null)).toBe("Staff");
    expect(provisionalSignerName(undefined)).toBe("Staff");
    expect(provisionalSignerName("64b7f0c2a1b2c3d4e5f60718")).toBe("Staff");
  });
});
