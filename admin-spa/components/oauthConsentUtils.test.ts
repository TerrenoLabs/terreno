import {describe, expect, it} from "bun:test";
import {
  CONSENT_ERROR_COPY,
  consentErrorKind,
  parseConsentScopes,
  readConsentRequestId,
} from "./oauthConsentUtils";

describe("consentErrorKind", () => {
  it("maps the consent endpoint statuses to screen states", () => {
    expect(consentErrorKind({data: {title: "Authorization request not found"}, status: 404})).toBe(
      "notFound"
    );
    expect(consentErrorKind({data: {code: "mcp-oauth-request-decided"}, status: 409})).toBe(
      "decided"
    );
    expect(consentErrorKind({status: 401})).toBe("signedOut");
  });

  it("treats a 400 as expired only when the server says so", () => {
    expect(consentErrorKind({data: {code: "mcp-oauth-request-expired"}, status: 400})).toBe(
      "expired"
    );
    expect(consentErrorKind({data: {title: "Authorization request expired"}, status: 400})).toBe(
      "expired"
    );
    expect(consentErrorKind({data: {title: "Bad input"}, status: 400})).toBe("error");
    expect(consentErrorKind({status: 400})).toBe("error");
  });

  it("falls back to the generic error", () => {
    expect(consentErrorKind({status: 500})).toBe("error");
    expect(consentErrorKind({error: "TypeError: Failed to fetch", status: "FETCH_ERROR"})).toBe(
      "error"
    );
    expect(consentErrorKind(undefined)).toBe("error");
    expect(consentErrorKind("boom")).toBe("error");
  });

  it("has copy for every state", () => {
    for (const kind of ["decided", "error", "expired", "notFound", "signedOut"] as const) {
      expect(CONSENT_ERROR_COPY[kind].title.length).toBeGreaterThan(0);
      expect(CONSENT_ERROR_COPY[kind].message.length).toBeGreaterThan(0);
    }
  });
});

describe("readConsentRequestId", () => {
  it("returns a single non-empty request id", () => {
    expect(readConsentRequestId("abc123")).toBe("abc123");
    expect(readConsentRequestId(" abc ")).toBe("abc");
    expect(readConsentRequestId(["first", "second"])).toBe("first");
  });

  it("returns undefined for missing or empty values", () => {
    expect(readConsentRequestId(undefined)).toBeUndefined();
    expect(readConsentRequestId("")).toBeUndefined();
    expect(readConsentRequestId("   ")).toBeUndefined();
    expect(readConsentRequestId([])).toBeUndefined();
    expect(readConsentRequestId(42)).toBeUndefined();
  });
});

describe("parseConsentScopes", () => {
  it("splits space-delimited scopes", () => {
    expect(parseConsentScopes("mcp:read  mcp:write")).toEqual(["mcp:read", "mcp:write"]);
  });

  it("returns an empty list for a missing scope", () => {
    expect(parseConsentScopes(null)).toEqual([]);
    expect(parseConsentScopes(undefined)).toEqual([]);
    expect(parseConsentScopes("")).toEqual([]);
  });
});
