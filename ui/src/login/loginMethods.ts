import {getSocialProviderName} from "../SocialLoginButton";
import type {GenericOAuthProviderConfig} from "../signUp/signUpTypes";

/** Ways to name a sign-in method in the login screen's copy. */
export interface LoginMethodLabels {
  /** Noun form, e.g. "GitHub", "email", "passkey": "Forget this {name} account". */
  name: string;
  /** Form used after "with", e.g. "GitHub", "email", "a passkey": "Continue with {phrase}". */
  phrase: string;
}

/**
 * Names a sign-in method: a branded provider's name, a generic provider's label, "email",
 * "passkey", or the raw id as a last resort.
 */
export const getLoginMethodLabels = ({
  method,
  genericProviders = [],
}: {
  method: string;
  genericProviders?: GenericOAuthProviderConfig[];
}): LoginMethodLabels => {
  if (method === "email") {
    return {name: "email", phrase: "email"};
  }
  if (method === "passkey") {
    return {name: "passkey", phrase: "a passkey"};
  }
  const generic = genericProviders.find((provider) => provider.id === method);
  const name = generic?.label ?? getSocialProviderName(method) ?? method;
  return {name, phrase: name};
};

/** Appends the last-used marker to an accessible name, e.g. "Continue with GitHub, last used". */
export const withLastUsedLabel = ({
  label,
  lastUsedLabel,
}: {
  label: string;
  lastUsedLabel: string;
}): string => {
  return `${label}, ${lastUsedLabel.toLocaleLowerCase()}`;
};
