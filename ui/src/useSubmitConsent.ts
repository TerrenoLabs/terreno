import {useCallback} from "react";

import {invalidateClientTags, type TerrenoRequestClient, useClientMutation} from "./requestClient";

export interface SubmitConsentBody {
  agreed: boolean;
  checkboxValues?: Record<string, boolean>;
  consentFormId: string;
  locale: string;
  signature?: string;
}

export interface UseSubmitConsentResult {
  error: unknown;
  isSubmitting: boolean;
  /** Post a consent response; rejects with the request error. */
  submit: (body: SubmitConsentBody) => Promise<void>;
}

/**
 * Submit a consent response (`POST /consents/respond`). On success every mounted
 * `useConsentForms` on the same client refetches its pending forms.
 */
export const useSubmitConsent = (
  client: TerrenoRequestClient,
  baseUrl?: string
): UseSubmitConsentResult => {
  const base = baseUrl || "";

  const run = useCallback(
    async (body: SubmitConsentBody): Promise<void> => {
      await client.request({body: {...body}, method: "POST", url: `${base}/consents/respond`});
      invalidateClientTags({client, tags: ["PendingConsents"]});
    },
    [base, client]
  );

  const {error, isLoading: isSubmitting, mutate: submit} = useClientMutation({run});

  return {error, isSubmitting, submit};
};
