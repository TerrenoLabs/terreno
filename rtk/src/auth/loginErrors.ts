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
  /** The sign-in method that failed: a provider id, `"email"`, or `"passkey"`. */
  method?: string;
}

/** What the login screen shows for a failure. */
export interface LoginFeedback {
  /** Guidance shown under the heading. */
  notice?: LoginNotice;
  /** A short error banner under the heading. */
  error?: string;
  /** Wrong email or password, shown on the password field instead of a banner. */
  passwordError?: string;
  /** True when the server said sign-up is closed, so the sign-up link should hide. */
  isSignUpClosed: boolean;
}

/** Shown for any failure without a better message. */
export const LOGIN_FAILED_MESSAGE = "Sign in failed. Please try again.";

/** Shown under the password field when the email and password do not match. */
export const PASSWORD_MISMATCH_MESSAGE = "That password doesn't match. Try again or reset it.";

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
const CANCELLED_CODES = new Set(["AUTH_CANCELLED", "auth_cancelled"]);
const PASSWORD_MISMATCH_CODES = new Set([
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_PASSWORD",
  "INVALID_EMAIL",
]);
const PASSWORD_MISMATCH_MESSAGES = new Set([
  "invalid email or password",
  "invalid password",
  "invalid credentials",
]);

const VERIFIED_EMAIL_LINK_TEXT =
  "An account with this email already exists. Verify your email address, then sign in again to link this sign-in method.";

/**
 * Guidance for `account_not_linked`, worded for the server's linking mode. `originalMethod` names
 * the method this device used last ("Google", "email"), when known. `attemptedMethod` names the
 * method that was just refused.
 */
export const getAccountNotLinkedText = ({
  mode,
  originalMethod,
  attemptedMethod,
}: {
  mode?: BetterAuthAccountLinkingMode;
  originalMethod?: string;
  attemptedMethod?: string;
}): string => {
  const signInWith = originalMethod
    ? `Sign in with ${originalMethod}`
    : "Sign in the way you did before";
  const linkTarget = attemptedMethod ? `link ${attemptedMethod}` : "link it";
  if (mode === "explicit") {
    const usedWith = originalMethod ? `with ${originalMethod}` : "with another sign-in method";
    return `That email is already used ${usedWith}. ${signInWith}, then ${linkTarget} from Security.`;
  }
  if (mode === "never") {
    return `That email already has an account. ${signInWith} instead.`;
  }
  // verified-email (the default): linking waits until both emails are verified.
  return VERIFIED_EMAIL_LINK_TEXT;
};

const warning = (text: string, title: string, extra?: Partial<LoginNotice>): LoginNotice => ({
  text,
  title,
  tone: "warning",
  ...extra,
});

const isCancelled = (code: string, message: string): boolean => {
  return (
    CANCELLED_CODES.has(code) ||
    message === "auth cancelled" ||
    message === "authentication cancelled"
  );
};

const isPasswordMismatch = (code: string, message: string): boolean => {
  return PASSWORD_MISMATCH_CODES.has(code) || PASSWORD_MISMATCH_MESSAGES.has(message);
};

const cancelledText = ({
  attemptedMethod,
  hasAccounts,
}: {
  attemptedMethod?: string;
  hasAccounts: boolean;
}): string => {
  const provider = attemptedMethod ?? "Sign-in";
  const next = hasAccounts ? "Tap an account to try again." : "Try again or choose another way.";
  return `${cancelledProviderName(provider)} sign-in was cancelled. ${next}`;
};

/** "a passkey" and "email" read as sentences; branded names are already titled. */
const cancelledProviderName = (attemptedMethod: string): string => {
  if (attemptedMethod === "Sign-in") {
    return attemptedMethod;
  }
  if (attemptedMethod === "a passkey" || attemptedMethod === "passkey") {
    return "Passkey";
  }
  if (attemptedMethod === "email") {
    return "Email";
  }
  return attemptedMethod.charAt(0).toUpperCase() + attemptedMethod.slice(1);
};

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
  originalMethodId,
  attemptedMethod,
  hasAccounts = false,
}: {
  failure: LoginFailure | undefined;
  mode?: BetterAuthAccountLinkingMode;
  /** Display name of the method this device used last, such as "GitHub". */
  originalMethod?: string;
  /** Id of that method (`"email"`, `"github"`), so the notice action can focus it. */
  originalMethodId?: string;
  /** Display name of the method that just failed, such as "Google". */
  attemptedMethod?: string;
  /** Whether the screen is offering continue-as accounts. Changes the cancelled copy. */
  hasAccounts?: boolean;
}): LoginFeedback => {
  if (!failure) {
    return {isSignUpClosed: false};
  }
  const code = failure.code ?? "";
  const message = (failure.message ?? "").trim().toLowerCase();
  if (isCancelled(code, message)) {
    return {
      isSignUpClosed: false,
      notice: {
        text: cancelledText({attemptedMethod, hasAccounts}),
        tone: "info",
      },
    };
  }
  // Checked first: an ID-token sign-in refused for closed sign-up also carries OAUTH_LINK_ERROR.
  if (SIGN_UP_CLOSED_CODES.has(code) || message === SIGN_UP_CLOSED_MESSAGE) {
    return {
      isSignUpClosed: true,
      notice: warning(SIGN_UP_CLOSED_NOTICE_TEXT, "Sign-up is closed"),
    };
  }
  const isAccountNotLinked =
    code === "account_not_linked" ||
    message === ACCOUNT_NOT_LINKED_MESSAGE ||
    (code === "OAUTH_LINK_ERROR" && message === "");
  if (isAccountNotLinked) {
    const isVerifiedEmail = mode !== "explicit" && mode !== "never";
    const action =
      !isVerifiedEmail && originalMethod
        ? {
            actionLabel: `Sign in with ${originalMethod}`,
            ...(originalMethodId ? {focusMethod: originalMethodId} : {}),
          }
        : {};
    return {
      isSignUpClosed: false,
      notice: warning(
        getAccountNotLinkedText({attemptedMethod, mode, originalMethod}),
        isVerifiedEmail ? "Verify your email first" : "You already have an account",
        action
      ),
    };
  }
  if (VERIFY_EMAIL_CODES.has(code) || message === VERIFY_EMAIL_MESSAGE) {
    return {
      isSignUpClosed: false,
      notice: warning(VERIFY_EMAIL_NOTICE_TEXT, "Verify your email"),
    };
  }
  if (code === "LINKING_DISABLED") {
    return {
      isSignUpClosed: false,
      notice: warning(LINKING_DISABLED_NOTICE_TEXT, "Linking is off"),
    };
  }
  if (code === "provider_not_found") {
    return {error: PROVIDER_NOT_FOUND_MESSAGE, isSignUpClosed: false};
  }
  if (failure.source === "response" && isPasswordMismatch(code, message)) {
    return {isSignUpClosed: false, passwordError: PASSWORD_MISMATCH_MESSAGE};
  }
  if (failure.source === "response" && failure.message) {
    return {error: failure.message, isSignUpClosed: false};
  }
  return {error: LOGIN_FAILED_MESSAGE, isSignUpClosed: false};
};
