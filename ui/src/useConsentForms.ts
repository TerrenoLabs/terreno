export interface ConsentFormPublic {
  id: string;
  title: string;
  slug: string;
  version: number;
  order: number;
  type: string;
  content: Record<string, string>;
  defaultLocale: string;
  active: boolean;
  captureSignature: boolean;
  requireScrollToBottom: boolean;
  checkboxes: Array<{label: string; required: boolean; confirmationPrompt?: string}>;
  agreeButtonText: string;
  allowDecline: boolean;
  declineButtonText: string;
  required: boolean;
  /** Set when staff signed this form provisionally for the user; the user still signs it. */
  provisionalSignature?: {signedAt: string; signedByName: string};
}

import {getLocales} from "expo-localization";

interface ConsentFormsResponse {
  data?: ConsentFormPublic[];
}

interface ConsentFormsQueryBuilder {
  query: (options: {
    onQueryStarted?: (
      _arg: unknown,
      helpers: {queryFulfilled: Promise<ConsentFormsResponse>}
    ) => Promise<void>;
    providesTags: string[];
    query: () => string;
  }) => unknown;
}

interface ConsentFormsHookState {
  data?: ConsentFormPublic[] | ConsentFormsResponse;
  error: unknown;
  isLoading: boolean;
  refetch: () => void | Promise<void>;
}

interface ConsentFormsEnhancedApi {
  useGetPendingConsentsQuery: () => ConsentFormsHookState;
}

interface ConsentFormsApiWithTags {
  injectEndpoints: (options: {
    endpoints: (build: ConsentFormsQueryBuilder) => {getPendingConsents: unknown};
    overrideExisting: boolean;
  }) => ConsentFormsEnhancedApi;
}

interface ConsentFormsApi {
  enhanceEndpoints: (options: {addTagTypes: string[]}) => ConsentFormsApiWithTags;
}

export const detectLocale = (): string => {
  // Web
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }

  // Native — expo-localization
  try {
    const locale = getLocales()[0]?.languageTag;
    if (locale) {
      return locale;
    }
  } catch {
    // expo-localization not available in this environment
  }

  return "en";
};

/**
 * Cache the enhanced api per (api, baseUrl). `injectEndpoints` logs a console
 * error in development whenever an endpoint with the same name is re-injected
 * (with `overrideExisting: false`), so calling it on every render of every
 * consumer would flood the console. WeakMap-by-api lets the GC reclaim entries
 * when the api object is unreachable.
 */
const enhancedApiCache = new WeakMap<ConsentFormsApi, Map<string, ConsentFormsEnhancedApi>>();

const getEnhancedApi = (api: ConsentFormsApi, base: string): ConsentFormsEnhancedApi => {
  let byBase = enhancedApiCache.get(api);
  if (!byBase) {
    byBase = new Map();
    enhancedApiCache.set(api, byBase);
  }
  const cached = byBase.get(base);
  if (cached) {
    return cached;
  }
  const apiWithConsentTags = api.enhanceEndpoints({addTagTypes: ["PendingConsents"]});
  const enhanced = apiWithConsentTags.injectEndpoints({
    endpoints: (build) => ({
      getPendingConsents: build.query({
        async onQueryStarted(_arg: unknown, {queryFulfilled}) {
          console.info("[useConsentForms] Fetching pending consent forms");
          try {
            const result = await queryFulfilled;
            console.info("[useConsentForms] Pending consent forms fetched", {
              count: result?.data?.length ?? 0,
            });
          } catch (error) {
            console.warn("[useConsentForms] Failed to fetch pending consent forms", {error});
          }
        },
        providesTags: ["PendingConsents"],
        query: () => `${base}/consents/pending`,
      }),
    }),
    overrideExisting: false,
  });
  byBase.set(base, enhanced);
  return enhanced;
};

export const useConsentForms = (api: ConsentFormsApi, baseUrl?: string) => {
  const base = baseUrl || "";
  const enhancedApi = getEnhancedApi(api, base);

  const {data, isLoading, error, refetch} = enhancedApi.useGetPendingConsentsQuery();
  const forms: ConsentFormPublic[] = Array.isArray(data) ? data : (data?.data ?? []);

  return {error, forms, isLoading, refetch};
};
