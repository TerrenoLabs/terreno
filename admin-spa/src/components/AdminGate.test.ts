import {describe, expect, it} from "bun:test";
import {
  buildRoutePath,
  isForbiddenAdminConfigError,
  isSignedInOnlyRoute,
  resolveAdminGate,
} from "../../components/adminGateUtils";
import {sanitizeReturnTo} from "../returnTo";

describe("isForbiddenAdminConfigError", () => {
  it("returns true only for authenticated 403 responses", () => {
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Forbidden"},
        isAuthenticated: true,
        isConfigLoading: false,
        status: 403,
      })
    ).toBe(true);
  });

  it("returns false for non-403 statuses", () => {
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Server error"},
        isAuthenticated: true,
        isConfigLoading: false,
        status: 500,
      })
    ).toBe(false);
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Rate limited"},
        isAuthenticated: true,
        isConfigLoading: false,
        status: 429,
      })
    ).toBe(false);
  });

  it("returns false when status is unknown", () => {
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Network issue"},
        isAuthenticated: true,
        isConfigLoading: false,
      })
    ).toBe(false);
  });

  it("returns false when unauthenticated, loading, or no error", () => {
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Forbidden"},
        isAuthenticated: false,
        isConfigLoading: false,
        status: 403,
      })
    ).toBe(false);
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Forbidden"},
        isAuthenticated: true,
        isConfigLoading: true,
        status: 403,
      })
    ).toBe(false);
    expect(
      isForbiddenAdminConfigError({
        error: undefined,
        isAuthenticated: true,
        isConfigLoading: false,
        status: 403,
      })
    ).toBe(false);
  });
});

describe("sanitizeReturnTo", () => {
  it("accepts in-app paths", () => {
    expect(sanitizeReturnTo("/oauth/consent?request=abc")).toBe("/oauth/consent?request=abc");
    expect(sanitizeReturnTo("/")).toBe("/");
    expect(sanitizeReturnTo(["/orgs", "/other"])).toBe("/orgs");
  });

  it("rejects anything that could leave the SPA", () => {
    const rejected = [
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example/path",
      "/ok\\path",
      "/path with space",
      "/path\ttab",
      "/path\nnewline",
      "/\u0000null",
      "",
      "/login",
      "/login?returnTo=/x",
    ];
    for (const value of rejected) {
      expect(sanitizeReturnTo(value)).toBeUndefined();
    }
    expect(sanitizeReturnTo(undefined)).toBeUndefined();
    expect(sanitizeReturnTo(42)).toBeUndefined();
    expect(sanitizeReturnTo([])).toBeUndefined();
  });
});

describe("buildRoutePath", () => {
  it("rebuilds the path with its query", () => {
    expect(buildRoutePath({params: {request: "abc"}, pathname: "/oauth/consent"})).toBe(
      "/oauth/consent?request=abc"
    );
    expect(buildRoutePath({params: {a: ["1", "2"], b: undefined}, pathname: "/x"})).toBe(
      "/x?a=1&a=2"
    );
    expect(buildRoutePath({params: {}, pathname: "/x"})).toBe("/x");
  });
});

describe("isSignedInOnlyRoute", () => {
  it("matches the consent route only", () => {
    expect(isSignedInOnlyRoute("/oauth/consent")).toBe(true);
    expect(isSignedInOnlyRoute("/oauth/consent/")).toBe(true);
    expect(isSignedInOnlyRoute("/")).toBe(false);
    expect(isSignedInOnlyRoute("/oauth")).toBe(false);
    expect(isSignedInOnlyRoute("/login")).toBe(false);
  });
});

describe("resolveAdminGate", () => {
  const base = {
    currentPath: "/",
    isAdmin: false,
    isAuthenticated: true,
    isAuthLoading: false,
    isConfigLoading: false,
    isForbidden: false,
    pathname: "/",
    returnTo: undefined,
    status: undefined,
  };

  it("waits while the session loads", () => {
    expect(resolveAdminGate({...base, isAuthLoading: true})).toEqual({kind: "loading"});
  });

  it("sends a signed-out consent visitor to login with returnTo", () => {
    expect(
      resolveAdminGate({
        ...base,
        currentPath: "/oauth/consent?request=abc",
        isAuthenticated: false,
        pathname: "/oauth/consent",
      })
    ).toEqual({
      kind: "redirect",
      render: false,
      target: "/login?returnTo=%2Foauth%2Fconsent%3Frequest%3Dabc",
    });
  });

  it("renders consent for a non-admin despite the admin config 403 or a stale 401", () => {
    const consent = {
      ...base,
      currentPath: "/oauth/consent?request=abc",
      pathname: "/oauth/consent",
    };
    expect(resolveAdminGate({...consent, isForbidden: true, status: 403})).toEqual({
      kind: "render",
    });
    expect(resolveAdminGate({...consent, status: 401})).toEqual({kind: "render"});
    expect(resolveAdminGate({...consent, isConfigLoading: true})).toEqual({kind: "render"});
  });

  it("keeps the existing login and forbidden redirects", () => {
    expect(resolveAdminGate({...base, isAuthenticated: false})).toEqual({
      kind: "redirect",
      render: false,
      target: "/login",
    });
    expect(resolveAdminGate({...base, isAuthenticated: false, pathname: "/login"})).toEqual({
      kind: "render",
    });
    expect(resolveAdminGate({...base, status: 401})).toEqual({
      kind: "redirect",
      render: false,
      target: "/login",
    });
    expect(resolveAdminGate({...base, isForbidden: true})).toEqual({
      kind: "redirect",
      render: false,
      target: "/forbidden",
    });
    expect(resolveAdminGate({...base, isForbidden: true, pathname: "/forbidden"})).toEqual({
      kind: "render",
    });
    expect(resolveAdminGate({...base, isAdmin: true, pathname: "/login"})).toEqual({
      kind: "redirect",
      render: true,
      target: "/",
    });
    expect(resolveAdminGate({...base, isConfigLoading: true})).toEqual({kind: "loading"});
    expect(resolveAdminGate({...base, isAdmin: true})).toEqual({kind: "render"});
  });

  it("honors a safe returnTo for any signed-in user on login", () => {
    const login = {...base, pathname: "/login", returnTo: "/oauth/consent?request=abc"};
    expect(resolveAdminGate({...login, isForbidden: true})).toEqual({
      kind: "redirect",
      render: false,
      target: "/oauth/consent?request=abc",
    });
    expect(resolveAdminGate({...login, isAdmin: true})).toEqual({
      kind: "redirect",
      render: false,
      target: "/oauth/consent?request=abc",
    });
    expect(resolveAdminGate({...login, isAdmin: true, returnTo: "//evil.example"})).toEqual({
      kind: "redirect",
      render: true,
      target: "/",
    });
  });
});
