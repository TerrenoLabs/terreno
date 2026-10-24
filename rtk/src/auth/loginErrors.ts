/**
 * Turns a failed sign-in into what the login screen shows: a notice with guidance for the
 * refusals Terreno's server sends on purpose (account linking, unverified email, closed sign-up),
 * or a plain error line for everything else.
 *
 * Codes reach the client two ways: in the `?error=` of an OAuth redirect back to the app, and in
 * the `{code, message}` of a refused request. Text from a URL is never shown, because anyone can
 * craft a link; an unknown URL code gets the generic message.
 */
import type {LoginNotice} from "@terreno/ui";

import type {BetterAuthAccountLinkingMode} from "../useAuthMethods";

/** A refused sign-in, from a response's error or from the `?error=` of an OAuth return. */
export interface LoginFailure {
  /** Server error code, such as `account_not_linked` or `VERIFY_EMAIL_TO_USE_ACCOUNT`. */
  code?: string;
  /** Server message. Shown only for `source: "response"`. */
  message?: string;
  /** Where the failure came from. URL text is never displayed. */
  source: "response" | "url";
}

/** What the login screen shows for a failure. */
export interface LoginFeedback {
  /** Guidance shown above the form. */
  notice?: LoginNotice;
  /** A short error line under the form. */
  error?: string;
  /** True when the server said sign-up is closed, so the sign-up link should hide. */
  isSignUpClosed: boolean;
}

/** Shown for any failure without a better message. */
export const LOGIN_FAILED_MESSAGE = "Sign in failed. Please try again.";

const PROVIDER_NOT_FOUND_MESSAGE = "That sign-in provider is not available.";

/** Shown when an email needs verifying before the account can be used. */
export const VERIFY_EMAIL_NOTICE_TEXT =
  "Verify your email to use this account. Open the link we emailed you, then sign in again.";

/** Shown when sign-up is closed and an unknown person tries to sign in. */
export const SIGN_UP_CLOSED_NOTICE_TEXT =
  "Sign-up is closed for this app. Ask your administrator for access.";

const LINKING_DISABLED_NOTICE_TEXT =
  "This app does not link sign-in methods. Sign in with the method you used before.";

// Better Auth answers a refused ID-token sign-in with code OAUTH_LINK_ERROR and one of these
// messages: the account was not linked, or sign-up is closed for an unknown email.
const ACCOUNT_NOT_LINKED_MESSAGE = "account not linked";
const SIGN_UP_CLOSED_MESSAGE = "signup disabled";
const VERIFY_EMAIL_MESSAGE = "verify your email to use this account";

const VERIFY_EMAIL_CODES = new Set(["VERIFY_EMAIL_TO_USE_ACCOUNT", "EMAIL_NOT_VERIFIED"]);
const SIGN_UP_CLOSED_CODES = new Set(["signup_disabled", "EMAIL_PASSWORD_SIGN_UP_DISABLED"]);

/**
 * Guidance for `account_not_linked`, worded for the server's linking mode. `originalMethod` names
 * the method this device used last ("Google", "email"), when known.
 */
export const getAccountNotLinkedText = ({
  mode,
  originalMethod,
}: {
  mode?: BetterAuthAccountLinkingMode;
  originalMethod?: string;
}): string => {
  const signInWith = originalMethod
    ? `Sign in with ${originalMethod}`
    : "Sign in the way you did before";
  if (mode === "explicit") {
    return `An account with this email already exists. ${signInWith}, then link this sign-in method from Security.`;
  }
  if (mode === "never") {
    return `This email already has an account. ${signInWith} instead.`;
  }
  // verified-email (the default): linking waits until both emails are verified.
  return "An account with this email already exists. Verify your email address, then sign in again to link this sign-in method.";
};

const warning = (text: string): LoginNotice => ({text, tone: "warning"});

/**
 * Maps a failure to a notice or an error line.
 *
 * @example
 * ```typescript
 * const {notice, error} = getLoginFeedback({
 *   failure: {code: "account_not_linked", source: "url"},
 *   mode: methods?.accountLinking.mode,
 * });
 * ```
 */
export const getLoginFeedback = ({
  failure,
  mode,
  originalMethod,
}: {
  failure: LoginFailure | undefined;
  mode?: BetterAuthAccountLinkingMode;
  originalMethod?: string;
}): LoginFeedback => {
  if (!failure) {
    return {isSignUpClosed: false};
  }
  const code = failure.code ?? "";
  const message = (failure.message ?? "").trim().toLowerCase();
  // Checked first: an ID-token sign-in refused for closed sign-up also carries OAUTH_LINK_ERROR.
  if (SIGN_UP_CLOSED_CODES.has(code) || message === SIGN_UP_CLOSED_MESSAGE) {
    return {isSignUpClosed: true, notice: warning(SIGN_UP_CLOSED_NOTICE_TEXT)};
  }
  const isAccountNotLinked =
    code === "account_not_linked" ||
    message === ACCOUNT_NOT_LINKED_MESSAGE ||
    (code === "OAUTH_LINK_ERROR" && message === "");
  if (isAccountNotLinked) {
    return {
      isSignUpClosed: false,
      notice: warning(getAccountNotLinkedText({mode, originalMethod})),
    };
  }
  if (VERIFY_EMAIL_CODES.has(code) || message === VERIFY_EMAIL_MESSAGE) {
    return {isSignUpClosed: false, notice: warning(VERIFY_EMAIL_NOTICE_TEXT)};
  }
  if (code === "LINKING_DISABLED") {
    return {isSignUpClosed: false, notice: warning(LINKING_DISABLED_NOTICE_TEXT)};
  }
  if (code === "provider_not_found") {
    return {error: PROVIDER_NOT_FOUND_MESSAGE, isSignUpClosed: false};
  }
  if (failure.source === "response" && failure.message) {
    return {error: failure.message, isSignUpClosed: false};
  }
  return {error: LOGIN_FAILED_MESSAGE, isSignUpClosed: false};
};
