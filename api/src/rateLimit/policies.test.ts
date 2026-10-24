import {describe, expect, it} from "bun:test";
import type {Request} from "express";
import {classifyRateLimitPolicy} from "./policies";

const request = (path: string, method = "POST"): Request => ({method, path}) as Request;

describe("classifyRateLimitPolicy for Better Auth feature routes", () => {
  it("puts two-factor verification in the auth bucket", () => {
    expect(classifyRateLimitPolicy(request("/api/auth/two-factor/verify-totp"))).toBe("auth");
  });

  it("puts every auth feature route in the auth bucket", () => {
    const paths = [
      "/api/auth/two-factor/enable",
      "/api/auth/two-factor/verify-backup-code",
      "/api/auth/passkey/generate-authenticate-options",
      "/api/auth/passkey/verify-authentication",
      "/api/auth/link-social",
      "/api/auth/unlink-account",
      "/api/auth/multi-session/set-active",
      "/api/auth/one-time-token/verify",
      "/api/auth/oauth-handoff/start",
      "/api/auth/oauth-handoff/link-intent",
      "/api/auth/oauth-handoff/link-start",
      "/api/auth/oauth-proxy-callback",
      "/api/auth/expo-authorization-proxy",
      "/api/auth/terreno/set-password",
    ];
    for (const path of paths) {
      expect({path, policy: classifyRateLimitPolicy(request(path))}).toEqual({
        path,
        policy: "auth",
      });
    }
  });

  it("follows a custom Better Auth base path", () => {
    expect(classifyRateLimitPolicy(request("/auth/v2/two-factor/verify-totp"), "/auth/v2")).toBe(
      "auth"
    );
    expect(classifyRateLimitPolicy(request("/api/auth/two-factor/verify-totp"), "/auth/v2")).toBe(
      "api"
    );
  });

  it("leaves the public methods discovery in the api bucket", () => {
    expect(classifyRateLimitPolicy(request("/api/auth/terreno/methods", "GET"))).toBe("api");
  });

  it("does not match a route that only shares a prefix", () => {
    expect(classifyRateLimitPolicy(request("/api/auth/passkeys-report", "GET"))).toBe("api");
  });
});
