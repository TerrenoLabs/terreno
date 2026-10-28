import {describe, expect, it} from "bun:test";

import {
  getAccountNotLinkedText,
  getLoginFeedback,
  LOGIN_FAILED_MESSAGE,
  PASSWORD_MISMATCH_MESSAGE,
  SIGN_UP_CLOSED_NOTICE_TEXT,
  VERIFY_EMAIL_NOTICE_TEXT,
} from "./loginErrors";

describe("getLoginFeedback", () => {
  it("shows nothing without a failure", () => {
    expect(getLoginFeedback({failure: undefined})).toEqual({isSignUpClosed: false});
  });

  it("maps every spelling of account_not_linked to the linking guidance", () => {
    const expected = getAccountNotLinkedText({mode: "explicit", originalMethod: "GitHub"});
    for (const failure of [
      {code: "account_not_linked", source: "url" as const},
      {code: "OAUTH_LINK_ERROR", source: "response" as const},
      {code: "OAUTH_LINK_ERROR", message: "account not linked", source: "response" as const},
      {message: "Account not linked", source: "response" as const},
    ]) {
      expect(getLoginFeedback({failure, mode: "explicit", originalMethod: "GitHub"})).toEqual({
        isSignUpClosed: false,
        notice: {
          actionLabel: "Sign in with GitHub",
          text: expected,
          title: "You already have an account",
          tone: "warning",
        },
      });
    }
  });

  it("uses the verified-email wording when the mode is not known yet", () => {
    expect(getAccountNotLinkedText({})).toBe(getAccountNotLinkedText({mode: "verified-email"}));
    expect(getAccountNotLinkedText({mode: "explicit"})).toContain("Sign in the way you did before");
  });

  it("asks for email verification for the server's and Better Auth's codes", () => {
    for (const failure of [
      {code: "VERIFY_EMAIL_TO_USE_ACCOUNT", source: "url" as const},
      {code: "EMAIL_NOT_VERIFIED", message: "Email not verified", source: "response" as const},
      {message: "Verify your email to use this account", source: "response" as const},
    ]) {
      expect(getLoginFeedback({failure}).notice?.text).toBe(VERIFY_EMAIL_NOTICE_TEXT);
    }
  });

  it("reports closed sign-up from the redirect code and the email sign-up code", () => {
    for (const code of ["signup_disabled", "EMAIL_PASSWORD_SIGN_UP_DISABLED"]) {
      expect(getLoginFeedback({failure: {code, source: "url"}})).toEqual({
        isSignUpClosed: true,
        notice: {text: SIGN_UP_CLOSED_NOTICE_TEXT, title: "Sign-up is closed", tone: "warning"},
      });
    }
  });

  it("reads the ID-token refusal 'signup disabled' as closed sign-up, not as linking", () => {
    expect(
      getLoginFeedback({
        failure: {code: "OAUTH_LINK_ERROR", message: "signup disabled", source: "response"},
        mode: "explicit",
      })
    ).toEqual({
      isSignUpClosed: true,
      notice: {text: SIGN_UP_CLOSED_NOTICE_TEXT, title: "Sign-up is closed", tone: "warning"},
    });
    // Any other OAUTH_LINK_ERROR message is shown as it is.
    expect(
      getLoginFeedback({
        failure: {code: "OAUTH_LINK_ERROR", message: "unable to create user", source: "response"},
      })
    ).toEqual({error: "unable to create user", isSignUpClosed: false});
  });

  it("explains LINKING_DISABLED and provider_not_found", () => {
    expect(
      getLoginFeedback({failure: {code: "LINKING_DISABLED", source: "response"}}).notice?.text
    ).toContain("does not link sign-in methods");
    expect(getLoginFeedback({failure: {code: "provider_not_found", source: "url"}}).error).toBe(
      "That sign-in provider is not available."
    );
  });

  it("shows a response's own message but never text from a URL", () => {
    expect(
      getLoginFeedback({failure: {message: "Invalid email or password", source: "response"}})
    ).toEqual({isSignUpClosed: false, passwordError: PASSWORD_MISMATCH_MESSAGE});
    expect(
      getLoginFeedback({failure: {code: "sign_in_failed", message: "evil", source: "url"}}).error
    ).toBe(LOGIN_FAILED_MESSAGE);
    expect(getLoginFeedback({failure: {source: "response"}}).error).toBe(LOGIN_FAILED_MESSAGE);
  });
});
