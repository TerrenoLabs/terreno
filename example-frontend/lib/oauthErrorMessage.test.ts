import {describe, expect, it} from "bun:test";

import {getOAuthErrorMessage} from "./oauthErrorMessage";

describe("getOAuthErrorMessage", () => {
  it("names a provider the server does not have", () => {
    expect(getOAuthErrorMessage("provider_not_found")).toBe(
      "That sign-in provider is not available."
    );
  });

  it("shows the generic message for a failed sign-in", () => {
    expect(getOAuthErrorMessage("sign_in_failed")).toBe("Sign in failed. Please try again.");
  });

  it("shows the generic message for Better Auth's own codes, never the code", () => {
    expect(getOAuthErrorMessage("state_mismatch")).toBe("Sign in failed. Please try again.");
    expect(getOAuthErrorMessage("<b>Call 555-0100</b>")).toBe("Sign in failed. Please try again.");
  });

  it("reads the first value of a repeated parameter", () => {
    expect(getOAuthErrorMessage(["provider_not_found", "sign_in_failed"])).toBe(
      "That sign-in provider is not available."
    );
  });

  it("returns undefined without an error", () => {
    expect(getOAuthErrorMessage(undefined)).toBeUndefined();
    expect(getOAuthErrorMessage("")).toBeUndefined();
  });
});
