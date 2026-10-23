import {useCallback} from "react";

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

export interface SignConsentProvisionallyBody {
  userId: string;
  consentFormId: string;
  note: string;
  locale?: string;
}

/** The `ConsentResponse` the server returns for a provisional signature. */
export interface ProvisionalConsentResponse {
  _id: string;
  agreedAt: string;
  consentFormId: string;
  userId: string;
  provisional: boolean;
  provisionalNote?: string;
  provisionalSignedBy?: {_id: string; name?: string; email?: string} | string;
}

type MutationTrigger<TBody> = (body: TBody) => {unwrap: () => Promise<unknown>};

type MutationHook<TBody> = () => [MutationTrigger<TBody>, {isLoading: boolean; error?: unknown}];

export interface VoidProvisionalConsentArgs {
  responseId: string;
  reason: string;
}

interface ProvisionalConsentQueryBuilder {
  query: (options: {providesTags: string[]; query: (userId: string) => string}) => unknown;
  mutation: <TArgs>(options: {
    invalidatesTags: string[];
    query: (args: TArgs) => {body: unknown; method: "POST"; url: string};
  }) => unknown;
}

interface ProvisionalConsentQueryState {
  data?: ProvisionalConsentStatusRow[] | ConsentStatusResponse;
  error: unknown;
  isLoading: boolean;
  refetch: () => void | Promise<void>;
}

interface ProvisionalConsentEnhancedApi {
  useGetConsentStatusQuery: (userId: string) => ProvisionalConsentQueryState;
  useSignConsentProvisionallyMutation: MutationHook<SignConsentProvisionallyBody>;
  useVoidProvisionalConsentMutation: MutationHook<VoidProvisionalConsentArgs>;
}

interface ProvisionalConsentApiWithTags {
  injectEndpoints: (options: {
    endpoints: (build: ProvisionalConsentQueryBuilder) => {
      getConsentStatus: unknown;
      signConsentProvisionally: unknown;
      voidProvisionalConsent: unknown;
    };
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
  /** Sign a form provisionally for the user. Rejects with the RTK error on failure. */
  sign: (body: Omit<SignConsentProvisionallyBody, "userId">) => Promise<ProvisionalConsentResponse>;
  isSigning: boolean;
  /** Void a provisional signature made in error. Rejects with the RTK error on failure. */
  voidSignature: (args: VoidProvisionalConsentArgs) => Promise<ProvisionalConsentResponse>;
  isVoiding: boolean;
}

/** Mutations may arrive as `{data}` envelopes or already unwrapped by the base query. */
const unwrapData = <T>(result: unknown): T => {
  if (result && typeof result === "object" && "data" in result) {
    return (result as {data: T}).data;
  }
  return result as T;
};

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
      // A provisional signature changes the target's statuses and their pending notice.
      signConsentProvisionally: build.mutation<SignConsentProvisionallyBody>({
        invalidatesTags: ["ConsentStatus", "PendingConsents"],
        query: (body) => ({
          body,
          method: "POST",
          url: `${base}/consent-responses/provisional`,
        }),
      }),
      // A void brings the form back to pending and removes the user's notice.
      voidProvisionalConsent: build.mutation<VoidProvisionalConsentArgs>({
        invalidatesTags: ["ConsentStatus", "PendingConsents"],
        query: ({reason, responseId}) => ({
          body: {reason},
          method: "POST",
          url: `${base}/consent-responses/${encodeURIComponent(responseId)}/void`,
        }),
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
  /** The consumer's RTK Query api. Typed loosely, like `ConsentNavigator`, so any app api fits. */
  api: unknown;
  baseUrl?: string;
  userId: string;
}): UseProvisionalConsentResult => {
  const enhancedApi = getEnhancedApi(api as ProvisionalConsentApi, baseUrl || "");
  const {data, error, isLoading, refetch} = enhancedApi.useGetConsentStatusQuery(userId);
  const [signMutation, {isLoading: isSigning}] = enhancedApi.useSignConsentProvisionallyMutation();
  const statuses = Array.isArray(data) ? data : (data?.data ?? []);

  const sign = useCallback(
    async (
      body: Omit<SignConsentProvisionallyBody, "userId">
    ): Promise<ProvisionalConsentResponse> => {
      const result = await signMutation({...body, userId}).unwrap();
      return unwrapData<ProvisionalConsentResponse>(result);
    },
    [signMutation, userId]
  );

  const [voidMutation, {isLoading: isVoiding}] = enhancedApi.useVoidProvisionalConsentMutation();
  const voidSignature = useCallback(
    async (args: VoidProvisionalConsentArgs): Promise<ProvisionalConsentResponse> => {
      const result = await voidMutation(args).unwrap();
      return unwrapData<ProvisionalConsentResponse>(result);
    },
    [voidMutation]
  );

  return {error, isLoading, isSigning, isVoiding, refetch, sign, statuses, voidSignature};
};
