import {describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";

import {createFakeRequestClient, fakeHttpError} from "./test-utils";
import {useSubmitConsent} from "./useSubmitConsent";

describe("useSubmitConsent", () => {
  it("starts idle", () => {
    const {client} = createFakeRequestClient({});
    const {result} = renderHook(() => useSubmitConsent(client));
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(typeof result.current.submit).toBe("function");
  });

  it("posts the consent response to /consents/respond under baseUrl", async () => {
    const {client, calls} = createFakeRequestClient({
      "POST /api/consents/respond": () => ({agreed: true, id: "response-1"}),
    });
    const {result} = renderHook(() => useSubmitConsent(client, "/api"));
    await act(async () => {
      await result.current.submit({
        agreed: true,
        checkboxValues: {"0": true},
        consentFormId: "form-1",
        locale: "en",
        signature: "sig",
      });
    });
    expect(calls).toEqual([
      {
        body: {
          agreed: true,
          checkboxValues: {"0": true},
          consentFormId: "form-1",
          locale: "en",
          signature: "sig",
        },
        method: "POST",
        url: "/api/consents/respond",
      },
    ]);
    expect(result.current.isSubmitting).toBe(false);
  });

  it("uses no prefix when baseUrl is omitted", async () => {
    const {client, calls} = createFakeRequestClient({"POST /consents/respond": () => ({})});
    const {result} = renderHook(() => useSubmitConsent(client));
    await act(async () => {
      await result.current.submit({agreed: false, consentFormId: "form-1", locale: "en"});
    });
    expect(calls[0]?.url).toBe("/consents/respond");
  });

  it("rejects and exposes the error when the request fails", async () => {
    const failure = fakeHttpError(400, "Invalid");
    const {client} = createFakeRequestClient({
      "POST /consents/respond": () => {
        throw failure;
      },
    });
    const {result} = renderHook(() => useSubmitConsent(client));
    let caught: unknown;
    await act(async () => {
      await result.current
        .submit({agreed: true, consentFormId: "form-1", locale: "en"})
        .catch((error: unknown) => {
          caught = error;
        });
    });
    expect(caught).toBe(failure);
    expect(result.current.error).toBe(failure);
  });
});
