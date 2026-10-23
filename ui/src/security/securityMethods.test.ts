import {describe, expect, it} from "bun:test";
import {DateTime} from "luxon";

import {
  formatRelativeSecurityTime,
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

  it("formatRelativeSecurityTime is relative to the injected now", () => {
    const now = new Date("2026-03-03T12:00:00.000Z");
    const base = DateTime.fromJSDate(now);
    const fiveMinutesAgo = "2026-03-03T11:55:00.000Z";
    expect(formatRelativeSecurityTime({now, value: fiveMinutesAgo})).toBe(
      DateTime.fromISO(fiveMinutesAgo).toRelative({base}) ?? ""
    );
    const twoDaysAgo = new Date("2026-03-01T12:00:00.000Z");
    expect(formatRelativeSecurityTime({now, value: twoDaysAgo})).toBe(
      DateTime.fromJSDate(twoDaysAgo).toRelative({base}) ?? ""
    );
  });

  it("formatRelativeSecurityTime says just now within a minute and for future times", () => {
    const now = new Date("2026-03-03T12:00:00.000Z");
    expect(formatRelativeSecurityTime({now, value: "2026-03-03T11:59:30.000Z"})).toBe("just now");
    expect(formatRelativeSecurityTime({now, value: "2026-03-03T12:05:00.000Z"})).toBe("just now");
  });

  it("formatRelativeSecurityTime returns undefined for a missing or invalid value", () => {
    expect(formatRelativeSecurityTime({value: undefined})).toBeUndefined();
    expect(formatRelativeSecurityTime({value: "not-a-date"})).toBeUndefined();
  });

  it("formatRelativeSecurityTime defaults now to the current time", () => {
    const value = DateTime.now().minus({hours: 3});
    expect(formatRelativeSecurityTime({value: value.toJSDate()})).toBe(value.toRelative() ?? "");
  });
});
