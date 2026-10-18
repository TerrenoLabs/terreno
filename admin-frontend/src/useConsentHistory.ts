import {useCallback} from "react";
import {useAdminRpc, useAdminRpcQuery} from "./useAdminRpc";

export interface ConsentHistoryEntry {
  _id: string;
  agreed: boolean;
  agreedAt: string;
  checkboxValues?: Record<string, boolean>;
  contentSnapshot?: string;
  form: {
    captureSignature: boolean;
    checkboxes: Array<{label: string; required: boolean; confirmationPrompt?: string}>;
    slug: string;
    title: string;
    type: string;
    version: number;
  } | null;
  formVersionSnapshot?: number;
  ipAddress?: string;
  locale?: string;
  signature?: string;
  signedAt?: string;
  userAgent?: string;
}

interface ConsentHistoryResponse {
  data?: ConsentHistoryEntry[];
}

const CONSENT_HISTORY_TAGS = ["MyConsents"] as const;

/** Signed consents for the current user from `{baseUrl}/consents/my`. */
export const useConsentHistory = (
  baseUrl?: string
): {
  entries: ConsentHistoryEntry[];
  error: unknown;
  isLoading: boolean;
  refetch: () => Promise<void>;
} => {
  const rpc = useAdminRpc();
  const base = baseUrl || "";
  const {data, error, isLoading, refetch} = useAdminRpcQuery<
    ConsentHistoryEntry[] | ConsentHistoryResponse
  >({
    providesTags: CONSENT_HISTORY_TAGS,
    rpc,
    url: `${base}/consents/my`,
  });
  const entries: ConsentHistoryEntry[] = Array.isArray(data) ? data : (data?.data ?? []);

  const retry = useCallback(async (): Promise<void> => {
    await refetch();
  }, [refetch]);

  return {entries, error, isLoading, refetch: retry};
};
