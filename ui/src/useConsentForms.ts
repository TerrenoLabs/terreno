import {getLocales} from "expo-localization";
import {useCallback} from "react";

import {type TerrenoRequestClient, useClientQuery} from "./requestClient";

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

/** Replace `{{name}}` placeholders in consent content; unknown placeholders stay as written. */
export const applyConsentVariables = (
  content: string,
  variables?: Record<string, string>
): string => {
  if (!variables) {
    return content;
  }
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] ?? match);
};

/** The content locale to show: the exact locale, then its language, then the form default. */
export const resolveConsentLocale = (form: ConsentFormPublic, locale: string): string => {
  if (form.content[locale] !== undefined) {
    return locale;
  }
  const language = locale.split("-")[0];
  if (form.content[language] !== undefined) {
    return language;
  }
  return form.defaultLocale;
};

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

export interface UseConsentFormsResult {
  error: unknown;
  forms: ConsentFormPublic[];
  isLoading: boolean;
  refetch: () => Promise<void>;
}

/** Fetch the signed-in user's pending consent forms (`GET /consents/pending`). */
export const useConsentForms = (
  client: TerrenoRequestClient,
  baseUrl?: string
): UseConsentFormsResult => {
  const base = baseUrl || "";

  const fetchPendingConsents = useCallback(async (): Promise<ConsentFormPublic[]> => {
    console.info("[useConsentForms] Fetching pending consent forms");
    try {
      const result = await client.request<ConsentFormPublic[] | {data?: ConsentFormPublic[]}>({
        url: `${base}/consents/pending`,
      });
      const forms = Array.isArray(result) ? result : (result?.data ?? []);
      console.info("[useConsentForms] Pending consent forms fetched", {count: forms.length});
      return forms;
    } catch (error) {
      console.warn("[useConsentForms] Failed to fetch pending consent forms", {error});
      throw error;
    }
  }, [base, client]);

  const {data, error, isLoading, refetch} = useClientQuery({
    client,
    fetcher: fetchPendingConsents,
    providesTag: "PendingConsents",
  });

  return {error, forms: data ?? [], isLoading, refetch};
};
