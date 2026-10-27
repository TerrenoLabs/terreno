/** Verifies Better Auth config: OAuth handoff, mock OIDC, secrets, and CORS_ORIGINS parsing. */
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {once} from "node:events";
import {createServer, type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {BetterAuthApp, type UserModel as TerrenoAuthUserModel} from "@terreno/api";
import express from "express";
import supertest from "supertest";
import {User} from "../models/user";
import {start as startServer} from "../server";
import {
  buildBetterAuthConfig,
  getCorsOrigins,
  getOAuthHandoffWebOrigins,
  getWebOrigins,
  MOCK_OIDC_PROVIDER_ID,
  OAUTH_HANDOFF_CALLBACK_PATHS,
  toCorsOrigin,
} from "./betterAuthConfig";

const WEB_ORIGIN = "http://localhost:8082";

// A discovery document is all the start endpoint reads from the provider.
const startDiscoveryServer = async (): Promise<{close: () => Promise<void>; issuer: string}> => {
  let issuer = "";
  const server: Server = createServer((req, res) => {
    if (req.url !== "/.well-known/openid-configuration") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {"content-type": "application/json"});
    res.end(
      JSON.stringify({
        authorization_endpoint: `${issuer}/authorize`,
        issuer,
        response_types_supported: ["code"],
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
      })
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    close: async (): Promise<void> => {
      server.close();
      await once(server, "close");
    },
    issuer,
  };
};

describe("buildBetterAuthConfig", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCorsOrigins = process.env.CORS_ORIGINS;

  beforeEach(() => {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_OAUTH_HANDOFF");
    Reflect.deleteProperty(process.env, "MOCK_OIDC_ISSUER");
    Reflect.deleteProperty(process.env, "CORS_ORIGINS");
  });

  afterEach(() => {
    // The preload does not reset NODE_ENV, so a production case must not leak into later files.
    if (originalNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalCorsOrigins === undefined) {
      Reflect.deleteProperty(process.env, "CORS_ORIGINS");
    } else {
      process.env.CORS_ORIGINS = originalCorsOrigins;
    }
  });

  it("leaves the OAuth handoff off by default", () => {
    const config = buildBetterAuthConfig();
    expect(config?.oauthHandoff).toBeUndefined();
  });

  it("hands off to the web origins and the login page when BETTER_AUTH_OAUTH_HANDOFF=true", () => {
    process.env.BETTER_AUTH_OAUTH_HANDOFF = "true";
    process.env.CORS_ORIGINS = "https://app.example.com";
    const config = buildBetterAuthConfig();
    expect(config?.oauthHandoff).toEqual({
      callbackPaths: ["/login"],
      webOrigins: getWebOrigins(),
    });
    expect(config?.oauthHandoff?.webOrigins).toContain("https://app.example.com");
    expect(OAUTH_HANDOFF_CALLBACK_PATHS).toEqual(["/login"]);
  });

  it("keeps loopback handoff origins outside production for the local e2e", () => {
    process.env.BETTER_AUTH_OAUTH_HANDOFF = "true";
    process.env.NODE_ENV = "test";
    const config = buildBetterAuthConfig();
    expect(config?.oauthHandoff?.webOrigins).toContain("http://localhost:8082");
    expect(config?.oauthHandoff?.webOrigins).toContain("http://127.0.0.1:8082");
  });

  it("hands off only to non-loopback origins in production", () => {
    process.env.BETTER_AUTH_OAUTH_HANDOFF = "true";
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS =
      "https://app.example.com, http://localhost:3000, http://[::1]:8082, http://127.0.0.1:9000";
    const config = buildBetterAuthConfig();
    expect(config?.oauthHandoff?.webOrigins).toEqual(["https://app.example.com"]);
    // CORS and trustedOrigins still list the loopback origins.
    expect(getWebOrigins()).toContain("http://localhost:8082");
    expect(config?.trustedOrigins).toContain("http://localhost:3000");
  });

  it("refuses to start the handoff in production with no deployed web origin", () => {
    process.env.BETTER_AUTH_OAUTH_HANDOFF = "true";
    process.env.NODE_ENV = "production";
    expect(() => buildBetterAuthConfig()).toThrow(
      /needs a non-loopback web origin in CORS_ORIGINS/
    );
    expect(() => getOAuthHandoffWebOrigins()).toThrow();
  });

  it("does not check handoff origins in production when the handoff is off", () => {
    process.env.NODE_ENV = "production";
    expect(buildBetterAuthConfig()?.oauthHandoff).toBeUndefined();
  });

  it("registers no extra plugin without MOCK_OIDC_ISSUER", () => {
    const config = buildBetterAuthConfig();
    expect(config?.plugins).toBeUndefined();
  });

  it("registers the mock OIDC provider when MOCK_OIDC_ISSUER is set outside production", () => {
    process.env.MOCK_OIDC_ISSUER = "http://127.0.0.1:4555";
    const config = buildBetterAuthConfig();
    expect(config?.plugins?.map((plugin) => plugin.id)).toEqual(["generic-oauth"]);
  });

  it("refuses to start with MOCK_OIDC_ISSUER in production", () => {
    process.env.NODE_ENV = "production";
    process.env.MOCK_OIDC_ISSUER = "http://127.0.0.1:4555";
    expect(() => buildBetterAuthConfig()).toThrow(/MOCK_OIDC_ISSUER must not be set in production/);
  });

  it("refuses to start in production without BETTER_AUTH_SECRET", () => {
    process.env.NODE_ENV = "production";
    Reflect.deleteProperty(process.env, "BETTER_AUTH_SECRET");
    expect(() => buildBetterAuthConfig()).toThrow(/BETTER_AUTH_SECRET is required/);
  });

  it("refuses to start in production with the committed development secret", () => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_SECRET = "terreno-example-better-auth-secret-dev-only-32";
    expect(() => buildBetterAuthConfig()).toThrow(/BETTER_AUTH_SECRET is required/);
  });

  it("uses the supplied BETTER_AUTH_SECRET in production", () => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_SECRET = "dummy-deployed-better-auth-secret-0123456789";
    expect(buildBetterAuthConfig()?.secret).toBe("dummy-deployed-better-auth-secret-0123456789");
  });

  it("falls back to the development secret outside production", () => {
    process.env.NODE_ENV = "development";
    Reflect.deleteProperty(process.env, "BETTER_AUTH_SECRET");
    expect(buildBetterAuthConfig()?.secret).toBe("terreno-example-better-auth-secret-dev-only-32");
  });

  it("refuses a MOCK_OIDC_ISSUER that is not an http(s) origin", () => {
    process.env.MOCK_OIDC_ISSUER = "javascript:alert(1)";
    expect(() => buildBetterAuthConfig()).toThrow(/MOCK_OIDC_ISSUER/);
  });

  it("refuses a MOCK_OIDC_ISSUER that is not on this machine", () => {
    process.env.MOCK_OIDC_ISSUER = "https://idp.example.com";
    expect(() => buildBetterAuthConfig()).toThrow(/127\.0\.0\.1, localhost/);
  });

  it("starts a handed-off mock OIDC sign-in that returns to the login page", async () => {
    const discovery = await startDiscoveryServer();
    try {
      process.env.BETTER_AUTH_OAUTH_HANDOFF = "true";
      process.env.MOCK_OIDC_ISSUER = discovery.issuer;
      const config = buildBetterAuthConfig();
      if (!config) {
        throw new Error("Better Auth is the default provider, so a config is expected");
      }
      const app = express();
      new BetterAuthApp({config, userModel: User as unknown as TerrenoAuthUserModel}).register(app);

      const start = await supertest(app)
        .get("/api/auth/oauth-handoff/start")
        .query({callbackURL: `${WEB_ORIGIN}/login?handoff=nonce`, provider: MOCK_OIDC_PROVIDER_ID});
      expect(start.status).toBe(302);
      const authorize = new URL(start.headers.location as string);
      expect(`${authorize.origin}${authorize.pathname}`).toBe(`${discovery.issuer}/authorize`);
      expect(authorize.searchParams.get("redirect_uri")).toBe(
        `${process.env.BETTER_AUTH_URL}/api/auth/callback/${MOCK_OIDC_PROVIDER_ID}`
      );

      // Only the login page may receive a token.
      const elsewhere = await supertest(app)
        .get("/api/auth/oauth-handoff/start")
        .query({callbackURL: `${WEB_ORIGIN}/profile`, provider: MOCK_OIDC_PROVIDER_ID});
      expect(elsewhere.status).toBe(400);
    } finally {
      await discovery.close();
    }
  });
});

const PREVIEW_PATTERN = "https://terreno-frontend-*-terrenolabs.vercel.app";

const matches = (origin: string | RegExp, candidate: string): boolean =>
  typeof origin === "string" ? origin === candidate : origin.test(candidate);

describe("toCorsOrigin", () => {
  it("passes exact origins through unchanged", () => {
    expect(toCorsOrigin("https://terreno-frontend.vercel.app")).toBe(
      "https://terreno-frontend.vercel.app"
    );
  });

  it("matches Vercel per-deployment and branch preview hosts", () => {
    const origin = toCorsOrigin(PREVIEW_PATTERN);
    expect(matches(origin, "https://terreno-frontend-a1b2c3d4e-terrenolabs.vercel.app")).toBe(true);
    expect(matches(origin, "https://terreno-frontend-git-fix-login-terrenolabs.vercel.app")).toBe(
      true
    );
  });

  it("rejects hosts that widen the wildcard past one label or onto another team", () => {
    const origin = toCorsOrigin(PREVIEW_PATTERN);
    expect(matches(origin, "https://terreno-frontend-x.evil.com-terrenolabs.vercel.app")).toBe(
      false
    );
    expect(matches(origin, "https://terreno-frontend-abc-otherteam.vercel.app")).toBe(false);
    expect(matches(origin, "http://terreno-frontend-abc-terrenolabs.vercel.app")).toBe(false);
    expect(matches(origin, "https://terreno-frontend--terrenolabs.vercel.app")).toBe(false);
    expect(matches(origin, "https://terreno-frontend-abc-terrenolabs.vercel.app.evil.com")).toBe(
      false
    );
  });
});

describe("CORS_ORIGINS", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = `https://terreno-frontend.vercel.app, ${PREVIEW_PATTERN}`;
  });

  afterEach(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "CORS_ORIGINS");
    } else {
      process.env.CORS_ORIGINS = previous;
    }
  });

  it("keeps the dev origins and adds exact and wildcard entries", () => {
    const origins = getCorsOrigins();
    expect(origins).toContain("http://localhost:8082");
    expect(origins).toContain("https://terreno-frontend.vercel.app");
    expect(origins.some((origin) => origin instanceof RegExp)).toBe(true);
  });

  it("hands Better Auth the raw wildcard pattern", () => {
    const config = buildBetterAuthConfig();
    expect(config?.trustedOrigins).toContain(PREVIEW_PATTERN);
    expect(config?.trustedOrigins).toContain("https://terreno-frontend.vercel.app");
  });

  it("reflects a preview origin on preflight and refuses an unlisted one", async () => {
    const app = await startServer(true);
    const preview = "https://terreno-frontend-a1b2c3d4e-terrenolabs.vercel.app";

    const allowed = await supertest(app)
      .options("/openapi.json")
      .set("Origin", preview)
      .set("Access-Control-Request-Method", "GET");
    expect(allowed.headers["access-control-allow-origin"]).toBe(preview);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const refused = await supertest(app)
      .options("/openapi.json")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "GET");
    expect(refused.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
