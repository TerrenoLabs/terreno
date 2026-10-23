import type {ConsentFormPublic} from "./useConsentForms";

export type ProvisionalConsentStatus = "pending" | "provisional" | "signed" | "declined";

export interface ProvisionalConsentSignedBy {
  id: string;
  name?: string;
  email?: string;
}

/** One row of `GET /consent-responses/status`: a form and where the user stands on it. */
export interface ProvisionalConsentStatusRow {
  form: ConsentFormPublic & {_id?: string};
  status: ProvisionalConsentStatus;
  /** True for `signed` and `provisional`. */
  isConsented: boolean;
  respondedAt?: string;
  provisional?: {
    responseId: string;
    signedAt: string;
    signedBy: ProvisionalConsentSignedBy | null;
    note?: string;
  };
}

interface ConsentStatusResponse {
  data?: ProvisionalConsentStatusRow[];
}

interface ProvisionalConsentQueryBuilder {
  query: (options: {providesTags: string[]; query: (userId: string) => string}) => unknown;
}

interface ProvisionalConsentQueryState {
  data?: ProvisionalConsentStatusRow[] | ConsentStatusResponse;
  error: unknown;
  isLoading: boolean;
  refetch: () => void | Promise<void>;
}

interface ProvisionalConsentEnhancedApi {
  useGetConsentStatusQuery: (userId: string) => ProvisionalConsentQueryState;
}

interface ProvisionalConsentApiWithTags {
  injectEndpoints: (options: {
    endpoints: (build: ProvisionalConsentQueryBuilder) => {getConsentStatus: unknown};
    overrideExisting: boolean;
  }) => ProvisionalConsentEnhancedApi;
}

/** The consumer's RTK Query api, as passed to `ConsentNavigator`. */
export interface ProvisionalConsentApi {
  enhanceEndpoints: (options: {addTagTypes: string[]}) => ProvisionalConsentApiWithTags;
}

export interface UseProvisionalConsentResult {
  statuses: ProvisionalConsentStatusRow[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void | Promise<void>;
}

/**
 * Cache the enhanced api per (api, baseUrl) so `injectEndpoints` runs once, as in
 * `useConsentForms`: re-injecting the same endpoint name logs a development error.
 */
const enhancedApiCache = new WeakMap<
  ProvisionalConsentApi,
  Map<string, ProvisionalConsentEnhancedApi>
>();

const getEnhancedApi = (
  api: ProvisionalConsentApi,
  base: string
): ProvisionalConsentEnhancedApi => {
  let byBase = enhancedApiCache.get(api);
  if (!byBase) {
    byBase = new Map();
    enhancedApiCache.set(api, byBase);
  }
  const cached = byBase.get(base);
  if (cached) {
    return cached;
  }
  const apiWithTags = api.enhanceEndpoints({addTagTypes: ["ConsentStatus", "PendingConsents"]});
  const enhanced = apiWithTags.injectEndpoints({
    endpoints: (build) => ({
      getConsentStatus: build.query({
        providesTags: ["ConsentStatus"],
        query: (userId: string) =>
          `${base}/consent-responses/status?userId=${encodeURIComponent(userId)}`,
      }),
    }),
    overrideExisting: false,
  });
  byBase.set(base, enhanced);
  return enhanced;
};

/** Consent status of each form for `userId`, for staff who sign consent on the user's behalf. */
export const useProvisionalConsent = ({
  api,
  baseUrl,
  userId,
}: {
  api: ProvisionalConsentApi;
  baseUrl?: string;
  userId: string;
}): UseProvisionalConsentResult => {
  const enhancedApi = getEnhancedApi(api, baseUrl || "");
  const {data, error, isLoading, refetch} = enhancedApi.useGetConsentStatusQuery(userId);
  const statuses = Array.isArray(data) ? data : (data?.data ?? []);
  return {error, isLoading, refetch, statuses};
};
