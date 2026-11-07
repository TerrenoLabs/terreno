import {describe, expect, it, mock, spyOn} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";

import {createFakeRequestClient, fakeHttpError} from "./test-utils";
import type {ConsentFormPublic} from "./useConsentForms";
import {
  applyConsentVariables,
  detectLocale,
  resolveConsentLocale,
  useConsentForms,
} from "./useConsentForms";
import {useSubmitConsent} from "./useSubmitConsent";

const makeForm = (id: string): ConsentFormPublic =>
  ({id, title: `Form ${id}`}) as unknown as ConsentFormPublic;

interface GlobalThisWithNavigator {
  navigator: {language: string} | undefined;
}

mock.module("expo-localization", () => ({
  getLocales: () => [{languageTag: "es-ES"}],
}));

describe("resolveConsentLocale", () => {
  const form = {
    content: {en: "Hi", "pt-BR": "Oi"},
    defaultLocale: "en",
  } as unknown as ConsentFormPublic;

  it("uses the exact locale when the form has it", () => {
    expect(resolveConsentLocale(form, "pt-BR")).toBe("pt-BR");
  });

  it("falls back to the language when the exact locale is missing", () => {
    expect(resolveConsentLocale(form, "en-GB")).toBe("en");
  });

  it("falls back to the form default otherwise", () => {
    expect(resolveConsentLocale(form, "fr-FR")).toBe("en");
  });
});

describe("applyConsentVariables", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    expect(applyConsentVariables("Hi {{name}}, {{missing}}", {name: "Ada"})).toBe(
      "Hi Ada, {{missing}}"
    );
  });

  it("returns content unchanged without variables", () => {
    expect(applyConsentVariables("Hi {{name}}")).toBe("Hi {{name}}");
  });
});

describe("detectLocale", () => {
  it("returns locale from expo-localization in native test env", () => {
    const g = globalThis as unknown as GlobalThisWithNavigator;
    const originalNavigator = g.navigator;
    g.navigator = undefined;
    const locale = detectLocale();
    g.navigator = originalNavigator;
    expect(typeof locale).toBe("string");
    expect(locale.length).toBeGreaterThan(0);
  });

  it("falls back to en when expo-localization throws and no navigator", () => {
    const g = globalThis as unknown as GlobalThisWithNavigator;
    const originalNavigator = g.navigator;
    g.navigator = undefined;
    mock.module("expo-localization", () => ({
      getLocales: () => {
        throw new Error("not available");
      },
    }));
    const locale = detectLocale();
    g.navigator = originalNavigator;
    // Reset mock
    mock.module("expo-localization", () => ({
      getLocales: () => [{languageTag: "es-ES"}],
    }));
    expect(locale).toBe("en");
  });

  it("returns navigator.language when available", () => {
    const g = globalThis as unknown as GlobalThisWithNavigator;
    const originalNavigator = g.navigator;
    g.navigator = {language: "fr-FR"};
    const locale = detectLocale();
    g.navigator = originalNavigator;
    expect(locale).toBe("fr-FR");
  });
});

describe("useConsentForms", () => {
  it("returns forms from a bare array response", async () => {
    const {client, calls} = createFakeRequestClient({
      "GET /consents/pending": () => [makeForm("1")],
    });
    const {result} = renderHook(() => useConsentForms(client));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.forms).toEqual([]);
    await waitFor(() => expect(result.current.forms).toHaveLength(1));
    expect(result.current.isLoading).toBe(false);
    expect(calls[0]?.url).toBe("/consents/pending");
  });

  it("unwraps a {data} envelope and prefixes baseUrl", async () => {
    const {client, calls} = createFakeRequestClient({
      "GET /api/consents/pending": () => ({data: [makeForm("2")]}),
    });
    const {result} = renderHook(() => useConsentForms(client, "/api"));
    await waitFor(() => expect(result.current.forms[0]?.id).toBe("2"));
    expect(calls[0]?.url).toBe("/api/consents/pending");
  });

  it("returns an empty array when the envelope has no data", async () => {
    const {client} = createFakeRequestClient({"GET /consents/pending": () => ({})});
    const {result} = renderHook(() => useConsentForms(client));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.forms).toEqual([]);
  });

  it("surfaces request errors and logs a warning", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const failure = fakeHttpError(500);
    const {client} = createFakeRequestClient({
      "GET /consents/pending": () => {
        throw failure;
      },
    });
    const {result} = renderHook(() => useConsentForms(client));
    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.forms).toEqual([]);
    expect(warn).toHaveBeenCalledWith("[useConsentForms] Failed to fetch pending consent forms", {
      error: failure,
    });
    warn.mockRestore();
  });

  it("refetches when a consent submission invalidates pending consents", async () => {
    let forms = [makeForm("1")];
    const {client, callsTo} = createFakeRequestClient({
      "GET /consents/pending": () => forms,
      "POST /consents/respond": () => ({agreed: true}),
    });
    const {result} = renderHook(() => ({
      pending: useConsentForms(client),
      submit: useSubmitConsent(client),
    }));
    await waitFor(() => expect(result.current.pending.forms).toHaveLength(1));

    forms = [];
    await act(async () => {
      await result.current.submit.submit({agreed: true, consentFormId: "1", locale: "en"});
    });
    await waitFor(() => expect(result.current.pending.forms).toHaveLength(0));
    expect(callsTo("GET /consents/pending")).toHaveLength(2);
  });
});
