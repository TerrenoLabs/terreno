import {describe, expect, it} from "bun:test";
import {genericOAuth} from "better-auth/plugins";
import express from "express";
import supertest from "supertest";
import type {BetterAuthConfig} from "./betterAuth";
import {
  createBetterAuth,
  getMongoClientFromMongoose,
  mountBetterAuthRoutes,
} from "./betterAuthSetup";

const SECRET = "test-secret-at-least-32-characters-long";
const OAUTH_APP = {clientId: "client-id", clientSecret: "client-secret"};

const buildApp = (overrides: Partial<BetterAuthConfig> = {}): express.Application => {
  const config: BetterAuthConfig = {
    baseURL: "http://localhost:3000",
    enabled: true,
    secret: SECRET,
    ...overrides,
  };
  const auth = createBetterAuth({config, mongoClient: getMongoClientFromMongoose()});
  const app = express();
  mountBetterAuthRoutes(app, auth, config.basePath);
  return app;
};

// Registered with explicit endpoints, so init needs no discovery fetch.
const mockOidcPlugin = genericOAuth({
  config: [
    {
      authorizationUrl: "https://oidc.example.com/authorize",
      clientId: "mock-client",
      clientSecret: "mock-secret",
      providerId: "mock-oidc",
      tokenUrl: "https://oidc.example.com/token",
      userInfoUrl: "https://oidc.example.com/userinfo",
    },
  ],
});

describe("GET {basePath}/terreno/methods", () => {
  it("lists only configured providers", async () => {
    const res = await supertest(buildApp({githubOAuth: OAUTH_APP})).get(
      "/api/auth/terreno/methods"
    );
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(["github"]);
  });

  it("answers without a session and reports the defaults", async () => {
    const res = await supertest(buildApp()).get("/api/auth/terreno/methods");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accountLinking: {mode: "verified-email"},
      emailPassword: true,
      multiSession: false,
      passkey: false,
      providers: [],
      signUp: true,
      twoFactor: false,
    });
  });

  it("lists social providers in a stable order", async () => {
    const res = await supertest(
      buildApp({appleOAuth: OAUTH_APP, githubOAuth: OAUTH_APP, googleOAuth: OAUTH_APP})
    ).get("/api/auth/terreno/methods");
    expect(res.body.providers).toEqual(["apple", "github", "google"]);
  });

  it("lists generic OAuth provider ids from config.plugins", async () => {
    const res = await supertest(buildApp({googleOAuth: OAUTH_APP, plugins: [mockOidcPlugin]})).get(
      "/api/auth/terreno/methods"
    );
    expect(res.body.providers).toEqual(["google", "mock-oidc"]);
  });

  it("omits a generic OAuth provider whose discovery failed", async () => {
    const unreachable = genericOAuth({
      config: [
        {
          clientId: "broken-client",
          clientSecret: "broken-secret",
          discoveryUrl: "http://127.0.0.1:1/.well-known/openid-configuration",
          providerId: "broken",
        },
      ],
    });
    const res = await supertest(buildApp({plugins: [unreachable]})).get(
      "/api/auth/terreno/methods"
    );
    expect(res.body.providers).toEqual([]);
  });

  it("reports sign-up closed when email sign-up is disabled", async () => {
    const res = await supertest(buildApp({options: {emailAndPassword: {disableSignUp: true}}})).get(
      "/api/auth/terreno/methods"
    );
    expect(res.body.emailPassword).toBe(true);
    expect(res.body.signUp).toBe(false);
  });

  it("reports email and password off when it is disabled", async () => {
    const res = await supertest(buildApp({options: {emailAndPassword: {enabled: false}}})).get(
      "/api/auth/terreno/methods"
    );
    expect(res.body.emailPassword).toBe(false);
    expect(res.body.signUp).toBe(false);
  });

  it("reports account linking from Better Auth's account options", async () => {
    const never = await supertest(
      buildApp({options: {account: {accountLinking: {enabled: false}}}})
    ).get("/api/auth/terreno/methods");
    expect(never.body.accountLinking).toEqual({mode: "never"});

    const explicit = await supertest(
      buildApp({options: {account: {accountLinking: {disableImplicitLinking: true}}}})
    ).get("/api/auth/terreno/methods");
    expect(explicit.body.accountLinking).toEqual({mode: "explicit"});
  });

  it("mounts under a custom basePath", async () => {
    const app = buildApp({basePath: "/auth/v2", githubOAuth: OAUTH_APP});
    const res = await supertest(app).get("/auth/v2/terreno/methods");
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(["github"]);
  });

  it("refuses methods other than GET", async () => {
    const res = await supertest(buildApp())
      .post("/api/auth/terreno/methods")
      .set("content-type", "application/json")
      .send({});
    expect(res.status).toBe(404);
  });
});
