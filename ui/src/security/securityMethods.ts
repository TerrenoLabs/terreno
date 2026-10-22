import {DateTime} from "luxon";

import type {IconName} from "../Common";
import {SOCIAL_PROVIDER_NAMES} from "../SocialLoginButton";
import type {LinkableProvider, LinkedAccount} from "./securityTypes";

/** Better Auth's `providerId` for an email and password account. */
export const CREDENTIAL_PROVIDER_ID = "credential";

/** Providers whose FontAwesome brand icon shares their id. */
const BRAND_ICON_PROVIDERS = new Set(["apple", "github", "google"]);

/** How a provider row names and draws a provider. */
export interface ProviderDisplay {
  /** Display name, e.g. "GitHub". */
  label: string;
  /** FontAwesome icon name. */
  iconName: IconName;
  /** FontAwesome icon style: `brand` for branded providers. */
  iconType: "brand" | "solid";
}

/** Whether the user has a password, i.e. a `"credential"` account. */
export const hasPasswordCredential = (accounts: LinkedAccount[]): boolean => {
  return accounts.some((account) => account.providerId === CREDENTIAL_PROVIDER_ID);
};

/** Names and picks an icon for a provider, preferring the app's own label and icon. */
export const getProviderDisplay = ({
  providerId,
  provider,
}: {
  providerId: string;
  provider?: LinkableProvider;
}): ProviderDisplay => {
  const label = provider?.label ?? SOCIAL_PROVIDER_NAMES[providerId] ?? providerId;
  if (provider?.iconName) {
    return {iconName: provider.iconName, iconType: "solid", label};
  }
  if (BRAND_ICON_PROVIDERS.has(providerId)) {
    return {iconName: providerId as IconName, iconType: "brand", label};
  }
  return {iconName: "key", iconType: "solid", label};
};

/**
 * Formats a `Date` or ISO string as a short local date ("Mar 3, 2026"), or undefined when missing
 * or invalid.
 */
export const formatSecurityDate = (value?: string | Date): string | undefined => {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value);
  if (!date.isValid) {
    return undefined;
  }
  return date.toLocaleString(DateTime.DATE_MED);
};

/** The message of a rejected callback, or a fallback for non-Error rejections. */
export const getRejectionMessage = ({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const {message} = error as {message?: unknown};
    if (typeof message === "string" && message) {
      return message;
    }
  }
  return fallback;
};
