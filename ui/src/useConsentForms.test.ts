import {describe, expect, it, mock} from "bun:test";
import {renderHook} from "@testing-library/react-native";

import type {ConsentFormPublic} from "./useConsentForms";
import {
  applyConsentVariables,
  detectLocale,
  resolveConsentLocale,
  useConsentForms,
} from "./useConsentForms";

type ConsentFormsApi = Parameters<typeof useConsentForms>[0];

interface GlobalThisWithNavigator {
  navigator: {language: string} | undefined;
}

interface MockQueryDef {
  onQueryStarted?: (
    _arg: unknown,
    helpers: {queryFulfilled: Promise<{data: ConsentFormPublic[]}> | Promise<never>}
  ) => Promise<void>;
  query: () => string;
}

interface MockInjectOpts {
  endpoints: (build: {query: (def: MockQueryDef) => string}) => Record<string, unknown>;
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
  const buildApi = (queryResult: {data?: unknown; error?: unknown; isLoading?: boolean}) => {
    const refetch = mock(() => {});
    const useGetPendingConsentsQuery = mock(() => ({
      data: queryResult.data,
      error: queryResult.error,
      isLoading: queryResult.isLoading ?? false,
      refetch,
    }));
    const api = {
      enhanceEndpoints: mock(() => ({
        injectEndpoints: mock((opts: MockInjectOpts) => {
          // Call endpoint builder to exercise provides/onQueryStarted
          const build = {
            query: mock((def: MockQueryDef) => {
              // Call onQueryStarted with a successful result
              if (def.onQueryStarted) {
                void def.onQueryStarted(undefined, {
                  queryFulfilled: Promise.resolve({data: [{id: "1"}]}),
                });
              }
              // Also exercise the URL builder
              def.query();
              return "pending-query";
            }),
          };
          opts.endpoints(build);
          return {useGetPendingConsentsQuery};
        }),
      })),
    };
    return {api, refetch};
  };

  it("returns an array of forms when response is an array", () => {
    const {api} = buildApi({data: [{id: "1", title: "Form 1"} as unknown as ConsentFormPublic]});
    const {result} = renderHook(() => useConsentForms(api as unknown as ConsentFormsApi));
    expect(result.current.forms).toBeDefined();
    expect(Array.isArray(result.current.forms)).toBe(true);
  });

  it("unwraps .data property when response is object shape", () => {
    const {api} = buildApi({data: {data: [{id: "2"} as unknown as ConsentFormPublic]}});
    const {result} = renderHook(() => useConsentForms(api as unknown as ConsentFormsApi, "/api"));
    expect(Array.isArray(result.current.forms)).toBe(true);
  });

  it("returns empty array when no data is present", () => {
    const {api} = buildApi({data: undefined, isLoading: true});
    const {result} = renderHook(() => useConsentForms(api as unknown as ConsentFormsApi));
    expect(result.current.forms).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("calls onQueryStarted with failing query", () => {
    const refetch = mock(() => {});
    const api = {
      enhanceEndpoints: mock(() => ({
        injectEndpoints: mock((opts: MockInjectOpts) => {
          const build = {
            query: mock((def: MockQueryDef) => {
              if (def.onQueryStarted) {
                void def.onQueryStarted(undefined, {
                  queryFulfilled: Promise.reject(new Error("failed")),
                });
              }
              return "q";
            }),
          };
          opts.endpoints(build);
          return {
            useGetPendingConsentsQuery: () => ({
              data: undefined,
              error: "error",
              isLoading: false,
              refetch,
            }),
          };
        }),
      })),
    };
    const {result} = renderHook(() => useConsentForms(api as unknown as ConsentFormsApi));
    expect(result.current.error).toBe("error");
  });

  it("injects the pending-consents endpoint only once per (api, baseUrl)", () => {
    let injectCallCount = 0;
    const refetch = mock(() => {});
    const useGetPendingConsentsQuery = mock(() => ({
      data: undefined,
      error: undefined,
      isLoading: false,
      refetch,
    }));
    const api = {
      enhanceEndpoints: () => ({
        injectEndpoints: () => {
          injectCallCount += 1;
          return {useGetPendingConsentsQuery};
        },
      }),
    };
    const {rerender} = renderHook(() => useConsentForms(api as unknown as ConsentFormsApi));
    rerender(undefined);
    rerender(undefined);
    // The hook reuses the cached enhanced api after the first render so the
    // dev-mode RTK warning about re-injecting endpoints never fires.
    expect(injectCallCount).toBe(1);
  });
});
