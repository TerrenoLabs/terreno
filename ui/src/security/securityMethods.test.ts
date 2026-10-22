import {describe, expect, it} from "bun:test";
import {DateTime} from "luxon";

import {
  formatSecurityDate,
  getProviderDisplay,
  getRejectionMessage,
  hasPasswordCredential,
} from "./securityMethods";

describe("securityMethods", () => {
  it("hasPasswordCredential finds the credential account", () => {
    expect(
      hasPasswordCredential([
        {id: "acc-google", providerId: "google"},
        {id: "acc-credential", providerId: "credential"},
      ])
    ).toBe(true);
    expect(hasPasswordCredential([{id: "acc-google", providerId: "google"}])).toBe(false);
  });

  it("getProviderDisplay prefers the app label and icon, then brand, then a key", () => {
    expect(getProviderDisplay({providerId: "github"})).toEqual({
      iconName: "github",
      iconType: "brand",
      label: "GitHub",
    });
    expect(
      getProviderDisplay({
        provider: {iconName: "building", id: "okta", label: "Okta"},
        providerId: "okta",
      })
    ).toEqual({iconName: "building", iconType: "solid", label: "Okta"});
    expect(getProviderDisplay({providerId: "mock-oidc"})).toEqual({
      iconName: "key",
      iconType: "solid",
      label: "mock-oidc",
    });
  });

  it("formatSecurityDate formats ISO dates and ignores missing or invalid ones", () => {
    const iso = "2026-03-03T12:00:00.000Z";
    // Expectations come from Luxon so they follow the runner's locale and time zone.
    expect(formatSecurityDate(iso)).toBe(DateTime.fromISO(iso).toLocaleString(DateTime.DATE_MED));
    expect(formatSecurityDate(new Date(iso))).toBe(
      DateTime.fromISO(iso).toLocaleString(DateTime.DATE_MED)
    );
    expect(formatSecurityDate(new Date("nope"))).toBeUndefined();
    expect(formatSecurityDate(undefined)).toBeUndefined();
    expect(formatSecurityDate("nope")).toBeUndefined();
  });

  it("getRejectionMessage reads Error and {message} rejections, else falls back", () => {
    expect(getRejectionMessage({error: new Error("Bad"), fallback: "x"})).toBe("Bad");
    expect(getRejectionMessage({error: {message: "Better Auth said no"}, fallback: "x"})).toBe(
      "Better Auth said no"
    );
    expect(getRejectionMessage({error: "string", fallback: "Fallback"})).toBe("Fallback");
    expect(getRejectionMessage({error: {message: 3}, fallback: "Fallback"})).toBe("Fallback");
  });
});
