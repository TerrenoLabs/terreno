import {useCallback, useRef} from "react";

import {
  invalidateClientTags,
  type TerrenoRequestClient,
  unwrapDataEnvelope,
  useClientMutation,
  useClientQuery,
} from "./requestClient";
import type {ConsentFormPublic} from "./useConsentForms";

export type ProvisionalConsentStatus = "pending" | "provisional" | "signed" | "declined";

export interface ProvisionalConsentSignedBy {
  id: string;
  name?: string;
  email?: string;
}

/** Label for whoever signed provisionally: their name, then their email, then "Staff". */
export const provisionalSignerName = (
  signer?: {name?: string; email?: string} | string | null
): string => {
  if (!signer || typeof signer !== "object") {
    return "Staff";
  }
  return signer.name || signer.email || "Staff";
};

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

export interface VoidProvisionalConsentArgs {
  responseId: string;
  reason: string;
}

export interface UseProvisionalConsentResult {
  statuses: ProvisionalConsentStatusRow[];
  isLoading: boolean;
  error: unknown;
  refetch: () => Promise<void>;
  /** Sign a form provisionally for the user. Rejects with the request error on failure. */
  sign: (body: Omit<SignConsentProvisionallyBody, "userId">) => Promise<ProvisionalConsentResponse>;
  isSigning: boolean;
  /** Void a provisional signature made in error. Rejects with the request error on failure. */
  voidSignature: (args: VoidProvisionalConsentArgs) => Promise<ProvisionalConsentResponse>;
  isVoiding: boolean;
}

/** Consent status of each form for `userId`, for staff who sign consent on the user's behalf. */
export const useProvisionalConsent = ({
  baseUrl,
  client,
  userId,
}: {
  baseUrl?: string;
  /** The app's request client, as passed to `ConsentNavigator`. */
  client: TerrenoRequestClient;
  userId: string;
}): UseProvisionalConsentResult => {
  const base = baseUrl || "";

  const fetchStatuses = useCallback(async (): Promise<ProvisionalConsentStatusRow[]> => {
    const result = await client.request<ProvisionalConsentStatusRow[] | ConsentStatusResponse>({
      params: {userId},
      url: `${base}/consent-responses/status`,
    });
    return unwrapDataEnvelope<ProvisionalConsentStatusRow[]>(result) ?? [];
  }, [base, client, userId]);

  const {data, error, isLoading, refetch} = useClientQuery({
    client,
    fetcher: fetchStatuses,
    providesTag: "ConsentStatus",
  });

  // `useClientMutation` runs to completion without a value, so the response waits in a ref.
  const signedRef = useRef<ProvisionalConsentResponse | undefined>(undefined);
  const voidedRef = useRef<ProvisionalConsentResponse | undefined>(undefined);

  // A provisional signature changes the target's statuses and their pending notice; a void
  // brings the form back to pending and removes the user's notice.
  const runSign = useCallback(
    async (body: Omit<SignConsentProvisionallyBody, "userId">): Promise<void> => {
      const result = await client.request<ProvisionalConsentResponse>({
        body: {...body, userId},
        method: "POST",
        url: `${base}/consent-responses/provisional`,
      });
      signedRef.current = unwrapDataEnvelope<ProvisionalConsentResponse>(result);
      invalidateClientTags({client, tags: ["ConsentStatus", "PendingConsents"]});
    },
    [base, client, userId]
  );
  const runVoid = useCallback(
    async ({reason, responseId}: VoidProvisionalConsentArgs): Promise<void> => {
      const result = await client.request<ProvisionalConsentResponse>({
        body: {reason},
        method: "POST",
        url: `${base}/consent-responses/${encodeURIComponent(responseId)}/void`,
      });
      voidedRef.current = unwrapDataEnvelope<ProvisionalConsentResponse>(result);
      invalidateClientTags({client, tags: ["ConsentStatus", "PendingConsents"]});
    },
    [base, client]
  );
  const {isLoading: isSigning, mutate: signMutate} = useClientMutation({run: runSign});
  const {isLoading: isVoiding, mutate: voidMutate} = useClientMutation({run: runVoid});

  const sign = useCallback(
    async (
      body: Omit<SignConsentProvisionallyBody, "userId">
    ): Promise<ProvisionalConsentResponse> => {
      await signMutate(body);
      return signedRef.current as ProvisionalConsentResponse;
    },
    [signMutate]
  );
  const voidSignature = useCallback(
    async (args: VoidProvisionalConsentArgs): Promise<ProvisionalConsentResponse> => {
      await voidMutate(args);
      return voidedRef.current as ProvisionalConsentResponse;
    },
    [voidMutate]
  );

  return {
    error,
    isLoading,
    isSigning,
    isVoiding,
    refetch,
    sign,
    statuses: data ?? [],
    voidSignature,
  };
};
