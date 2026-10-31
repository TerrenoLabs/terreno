import {afterAll, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import type {BetterAuthPlugin} from "better-auth";
import {createAuthMiddleware} from "better-auth/api";
import {genericOAuth} from "better-auth/plugins";
import express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";
import type {BetterAuthConfig} from "./betterAuth";
import {
  type BetterAuthInstance,
  createBetterAuth,
  getMongoClientFromMongoose,
  mountBetterAuthRoutes,
} from "./betterAuthSetup";
import {type MockOidcProvider, startMockOidcProvider} from "./tests/mockOidcProvider";

const API_ORIGIN = "http://localhost:3000";
const WEB_ORIGIN = "https://web.example.com";
const PROVIDER_ID = "mock-oidc";
const SECRET = "test-secret-at-least-32-characters-long";

// Lets a case replace what Better Auth put on the callback response before the handoff hook
// reads it, to probe the hook with redirects Better Auth's own origin check would refuse.
interface CallbackOverride {
  location?: string;
  replaceResponse?: boolean;
}

let callbackOverride: CallbackOverride = {};

const callbackOverridePlugin = {
  hooks: {
    after: [
      {
        handler: createAuthMiddleware(async (ctx): Promise<void> => {
          if (callbackOverride.location !== undefined) {
            ctx.setHeader("location", callbackOverride.location);
          }
          if (callbackOverride.replaceResponse) {
            (ctx.context as {returned?: unknown}).returned = new Response("replaced", {
              status: 200,
            });
          }
        }),
        matcher: (context: {path?: string}): boolean =>
          Boolean(context.path?.startsWith("/callback/")),
      },
    ],
  },
  id: "terreno-test-callback-override",
} satisfies BetterAuthPlugin;

let provider: MockOidcProvider;

interface HandoffApp {
  app: express.Application;
  auth: BetterAuthInstance;
}

const buildApp = (overrides: Partial<BetterAuthConfig> = {}): HandoffApp => {
  const config: BetterAuthConfig = {
    baseURL: API_ORIGIN,
    enabled: true,
    oauthHandoff: {callbackPaths: ["/", "/after"], webOrigins: [WEB_ORIGIN]},
    // Better Auth skips origin checks when NODE_ENV is "test"; turn them back on so the
    // callbackURLs below pass or fail the same check they would in production.
    options: {advanced: {disableOriginCheck: false}},
    plugins: [
      genericOAuth({
        config: [
          {
            clientId: "mock-client",
            clientSecret: "mock-secret",
            discoveryUrl: `${provider.issuer}/.well-known/openid-configuration`,
            providerId: PROVIDER_ID,
          },
          // Registered without an authorization URL, so starting a sign-in with it fails.
          {clientId: "broken-client", clientSecret: "broken-secret", providerId: "broken"},
        ],
      }),
      callbackOverridePlugin,
    ],
    secret: SECRET,
    trustedOrigins: [
      WEB_ORIGIN,
      "http://web.example.com",
      "https://other.example.com",
      "https://*.preview.example.com",
      "exp://",
      "terreno://",
    ],
    ...overrides,
  };
  const auth = createBetterAuth({config, mongoClient: getMongoClientFromMongoose()});
  const app = express();
  mountBetterAuthRoutes(app, auth);
  return {app, auth};
};

// `name=value` pairs from a response's set-cookie headers, ready for a cookie request header.
const cookieHeaderFrom = (res: supertest.Response): string => {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (raw ?? []).map((cookie) => cookie.split(";")[0]).join("; ");
};

interface StartedSignIn {
  callbackPath: string;
  cookie: string;
}

// The web app's cross-site `signIn.social` call, then the provider's approval redirect.
const startSignIn = async (
  app: express.Application,
  body: Record<string, string>
): Promise<StartedSignIn> => {
  const start = await supertest(app)
    .post("/api/auth/sign-in/social")
    .set("origin", WEB_ORIGIN)
    .set("sec-fetch-site", "cross-site")
    .set("sec-fetch-mode", "cors")
    .set("content-type", "application/json")
    .send({provider: PROVIDER_ID, ...body});
  expect(start.status).toBe(200);
  expect(start.body.url).toStartWith(`${provider.issuer}/authorize`);

  const approval = await fetch(start.body.url, {redirect: "manual"});
  const callback = new URL(approval.headers.get("location") ?? "");
  expect(callback.origin).toBe(API_ORIGIN);
  expect(callback.pathname).toBe(`/api/auth/callback/${PROVIDER_ID}`);
  // The callback needs the OAuth state cookie the sign-in response set. Carrying it by hand
  // stands in for however the browser keeps it; how a cross-site app keeps it is T13/T14's call.
  return {callbackPath: `${callback.pathname}${callback.search}`, cookie: cookieHeaderFrom(start)};
};

// Completes the provider's redirect back to the API's callback (a top-level navigation).
const completeSignIn = async (
  app: express.Application,
  body: Record<string, string>
): Promise<supertest.Response> => {
  const {callbackPath, cookie} = await startSignIn(app, body);
  return supertest(app).get(callbackPath).set("cookie", cookie);
};

const fragmentParams = (location: string): URLSearchParams =>
  new URLSearchParams(new URL(location).hash.slice(1));

const HANDOFF_TOKEN_ROWS = {identifier: {$regex: /^one-time-token:/}};

// Better Auth's verification collection on the default connection.
const verificationRows = (): ReturnType<mongoose.mongo.Db["collection"]> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("The test database is not connected");
  }
  return db.collection("verification");
};

const verify = (app: express.Application, token: string): supertest.Test =>
  supertest(app)
    .post("/api/auth/one-time-token/verify")
    .set("origin", WEB_ORIGIN)
    .set("sec-fetch-site", "cross-site")
    .set("sec-fetch-mode", "cors")
    .set("content-type", "application/json")
    .send({token});

beforeAll(async () => {
  provider = await startMockOidcProvider();
});

afterAll(async () => {
  await provider?.close();
});

beforeEach(async () => {
  callbackOverride = {};
  provider.setUser({
    email: `oidc-${Math.random().toString(36).slice(2)}@example.com`,
    id: `oidc-${Math.random().toString(36).slice(2)}`,
    name: "OIDC User",
  });
  for (const collection of ["user", "session", "account", "verification"]) {
    await mongoose.connection.db?.collection(collection).deleteMany({});
  }
});

describe("oauthHandoff on a listed web origin", () => {
  it("redirects with #ott, which verifies once into a bearer session", async () => {
    const {app} = buildApp();

    const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after?tab=1`});

    expect(callback.status).toBe(302);
    const location = callback.headers.location as string;
    expect(location).toStartWith(`${WEB_ORIGIN}/after?tab=1#ott=`);
    // The handed-off redirect leaves no session behind on the API's origin: no session cookie
    // and no raw token header, while the state cookie is still cleared.
    const callbackCookies = (callback.headers["set-cookie"] as unknown as string[]) ?? [];
    expect(callbackCookies.some((cookie) => cookie.includes("session_token="))).toBe(false);
    expect(callbackCookies.some((cookie) => cookie.includes("session_data="))).toBe(false);
    expect(callbackCookies.some((cookie) => cookie.includes(".state="))).toBe(true);
    expect(callback.headers["set-auth-token"]).toBeUndefined();
    const ott = fragmentParams(location).get("ott") ?? "";
    expect(ott.length).toBeGreaterThan(20);
    // The token travels only in the fragment, never in the path or query the server sees.
    expect(new URL(location).search).toBe("?tab=1");

    const first = await verify(app, ott);
    expect(first.status).toBe(200);
    const bearer = first.headers["set-auth-token"] as string;
    expect(bearer).toBeTruthy();
    expect(first.headers["set-ott"]).toBeUndefined();
    // Bearer mode needs no API-origin session cookie.
    expect(first.headers["set-cookie"]).toBeUndefined();
    const exposed = String(first.headers["access-control-expose-headers"] ?? "").toLowerCase();
    expect(exposed).toContain("set-auth-token");
    expect(first.body.user.email).toStartWith("oidc-");

    const session = await supertest(app)
      .get("/api/auth/get-session")
      .set("authorization", `Bearer ${bearer}`);
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(first.body.user.email);

    const second = await verify(app, ott);
    expect(second.status).toBe(400);
    expect(second.headers["set-auth-token"]).toBeUndefined();
  });

  it("lets only one of two concurrent verifies use the token", async () => {
    const {app} = buildApp();
    const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after`});
    const ott = fragmentParams(callback.headers.location as string).get("ott") ?? "";

    const results = await Promise.all([verify(app, ott), verify(app, ott)]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
  });

  it("stores the token hashed, expiring in three minutes", async () => {
    const {app} = buildApp();
    const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/`});
    const ott = fragmentParams(callback.headers.location as string).get("ott") ?? "";

    const rows = await verificationRows().find(HANDOFF_TOKEN_ROWS).toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).not.toContain(ott);
    const minutes = DateTime.fromJSDate(rows[0].expiresAt).diffNow("minutes").minutes;
    expect(minutes).toBeGreaterThan(2.5);
    expect(minutes).toBeLessThanOrEqual(3);
  });

  it("keeps an existing fragment and replaces an ott already in it", async () => {
    const {app} = buildApp();

    const callback = await completeSignIn(app, {
      callbackURL: `${WEB_ORIGIN}/after#section=2&ott=planted&o%74t=planted2`,
    });

    const location = callback.headers.location as string;
    expect(location).toStartWith(`${WEB_ORIGIN}/after#section=2&ott=`);
    const params = fragmentParams(location);
    expect(params.getAll("ott")).toHaveLength(1);
    expect(params.get("ott")).not.toBe("planted");
    expect(params.get("section")).toBe("2");
    expect((await verify(app, params.get("ott") ?? "")).status).toBe(200);
  });

  it("keeps a fragment part it cannot decode", async () => {
    const {app} = buildApp();

    const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after#%zz=1`});

    expect(callback.headers.location).toStartWith(`${WEB_ORIGIN}/after#%zz=1&ott=`);
  });

  it("gives no token when a new user is sent to an unlisted newUserCallbackURL", async () => {
    const {app} = buildApp();

    const callback = await completeSignIn(app, {
      callbackURL: `${WEB_ORIGIN}/after`,
      newUserCallbackURL: "https://other.example.com/welcome",
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("https://other.example.com/welcome");
  });

  it("gives no token when the callback links an account to a signed-in user", async () => {
    const {app} = buildApp();
    const email = `linker-${Math.random().toString(36).slice(2)}@example.com`;
    provider.setUser({email, id: `oidc-${Math.random().toString(36).slice(2)}`, name: "Linker"});
    const signUp = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("origin", WEB_ORIGIN)
      .set("content-type", "application/json")
      .send({email, name: "Linker", password: "password-123456"});
    expect(signUp.status).toBe(200);
    const sessionCookie = cookieHeaderFrom(signUp);

    const link = await supertest(app)
      .post("/api/auth/link-social")
      .set("origin", WEB_ORIGIN)
      .set("cookie", sessionCookie)
      .set("content-type", "application/json")
      .send({callbackURL: `${WEB_ORIGIN}/after`, provider: PROVIDER_ID});
    expect(link.status).toBe(200);
    const approval = await fetch(link.body.url, {redirect: "manual"});
    const callback = new URL(approval.headers.get("location") ?? "");

    const returned = await supertest(app)
      .get(`${callback.pathname}${callback.search}`)
      .set("cookie", `${sessionCookie}; ${cookieHeaderFrom(link)}`);

    expect(returned.status).toBe(302);
    expect(returned.headers.location).toBe(`${WEB_ORIGIN}/after`);
    expect(await verificationRows().countDocuments(HANDOFF_TOKEN_ROWS)).toBe(0);
    const accounts = await mongoose.connection.db
      ?.collection("account")
      .countDocuments({providerId: PROVIDER_ID});
    expect(accounts).toBe(1);
  });

  it("gives no token to a failed sign-in that redirects to a listed web origin", async () => {
    const {app} = buildApp();
    const {callbackPath, cookie} = await startSignIn(app, {
      callbackURL: `${WEB_ORIGIN}/after`,
      errorCallbackURL: `${WEB_ORIGIN}/error`,
    });
    const state = new URL(callbackPath, API_ORIGIN).searchParams.get("state") ?? "";

    const callback = await supertest(app)
      .get(`/api/auth/callback/${PROVIDER_ID}?error=access_denied&state=${state}`)
      .set("cookie", cookie);

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toStartWith(`${WEB_ORIGIN}/error?error=access_denied`);
    expect(callback.headers.location).not.toContain("ott=");
  });

  it("leaves a callback response another plugin replaced untouched", async () => {
    const {app} = buildApp();
    callbackOverride = {replaceResponse: true};

    const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after`});

    expect(callback.status).toBe(200);
    expect(callback.text).toBe("replaced");
    expect(String(callback.headers.location ?? "")).not.toContain("ott=");
  });

  it("keeps the redirect without a token when minting fails", async () => {
    const {app} = buildApp({
      options: {
        advanced: {disableOriginCheck: false},
        databaseHooks: {
          verification: {
            create: {
              before: async (verification: {identifier: string}): Promise<void> => {
                if (verification.identifier.startsWith("one-time-token:")) {
                  throw new Error("verification store unavailable");
                }
              },
            },
          },
        },
      },
    });

    const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after`});

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${WEB_ORIGIN}/after`);
  });
});

describe("oauthHandoff on a callbackURL that is not a listed web origin", () => {
  const unlisted: {callbackURL: string; name: string}[] = [
    {callbackURL: "exp://127.0.0.1:8081/--/home", name: "an exp:// app scheme"},
    {callbackURL: "terreno://home", name: "a terreno:// app scheme"},
    {callbackURL: "/dashboard", name: "a relative path"},
    {callbackURL: `${API_ORIGIN}/welcome`, name: "the API's own origin"},
    {callbackURL: "http://web.example.com/after", name: "the web host over http"},
    {callbackURL: "https://other.example.com/after", name: "another trusted origin"},
    {callbackURL: "https://pr-7.preview.example.com/after", name: "a wildcard-trusted origin"},
  ];

  for (const {name, callbackURL} of unlisted) {
    it(`passes the origin check but gets no ott for ${name}`, async () => {
      const {app} = buildApp();

      const callback = await completeSignIn(app, {callbackURL});

      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe(callbackURL);
      const rows = await verificationRows().countDocuments(HANDOFF_TOKEN_ROWS);
      expect(rows).toBe(0);
    });
  }

  it("rejects a callbackURL outside trustedOrigins before any redirect", async () => {
    const {app} = buildApp();

    const start = await supertest(app)
      .post("/api/auth/sign-in/social")
      .set("origin", WEB_ORIGIN)
      .set("content-type", "application/json")
      .send({callbackURL: "https://evil.example/after", provider: PROVIDER_ID});

    expect(start.status).toBe(403);
    expect(start.body.code).toBe("INVALID_CALLBACK_URL");
  });

  // Redirects Better Auth itself would refuse, injected after its check, to prove the hook's
  // own origin comparison is exact.
  const injected: {location: string; name: string; ott: boolean}[] = [
    {
      location: `${WEB_ORIGIN}@evil.example/after`,
      name: "userinfo before another host",
      ott: false,
    },
    {location: "https://web.example.com.evil.example/", name: "a suffix host", ott: false},
    {location: "https://web.example.com:8443/", name: "another port", ott: false},
    {location: "//web.example.com/after", name: "a scheme-relative URL", ott: false},
    {location: "https:web.example.com/after", name: "a scheme without slashes", ott: false},
    {location: "javascript://web.example.com/%0aalert(1)", name: "a javascript: URL", ott: false},
    {location: "https://[web.example.com/after", name: "an unparseable URL", ott: false},
    // Only the normal form the URL parser would print gets a token, so browsers that parse a
    // little differently cannot be steered elsewhere.
    {
      location: "HTTPS://WEB.EXAMPLE.COM/after",
      name: "the listed origin in upper case",
      ott: false,
    },
    {
      location: "https://web.example.com:443/after",
      name: "the listed origin's default port",
      ott: false,
    },
    {location: "https://web.example.com\\after", name: "a backslash for the slash", ott: false},
  ];

  for (const {location, name, ott} of injected) {
    it(`${ott ? "hands" : "gives no"} ott to ${name}`, async () => {
      const {app} = buildApp();
      callbackOverride = {location};

      const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after`});

      expect(callback.status).toBe(302);
      if (ott) {
        expect(callback.headers.location).toStartWith(`${location}#ott=`);
      } else {
        expect(callback.headers.location).toBe(location);
      }
    });
  }
});

describe("oauthHandoff minting is server-only", () => {
  const signUpAndSignIn = async (app: express.Application): Promise<supertest.Response> => {
    const email = `email-${Math.random().toString(36).slice(2)}@example.com`;
    const signUp = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("origin", WEB_ORIGIN)
      .set("content-type", "application/json")
      .send({email, name: "Email User", password: "password-123456"});
    expect(signUp.status).toBe(200);
    expect(signUp.headers["set-ott"]).toBeUndefined();
    return supertest(app)
      .post("/api/auth/sign-in/email")
      .set("origin", WEB_ORIGIN)
      .set("content-type", "application/json")
      .send({email, password: "password-123456"});
  };

  it("refuses the client route GET /one-time-token/generate", async () => {
    const {app} = buildApp();
    const signIn = await signUpAndSignIn(app);
    const bearer = signIn.headers["set-auth-token"] as string;
    expect(bearer).toBeTruthy();

    const res = await supertest(app)
      .get("/api/auth/one-time-token/generate")
      .set("origin", WEB_ORIGIN)
      .set("authorization", `Bearer ${bearer}`);

    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  it("sends no set-ott header on email sign-in", async () => {
    const {app} = buildApp();

    const signIn = await signUpAndSignIn(app);

    expect(signIn.status).toBe(200);
    expect(signIn.headers["set-ott"]).toBeUndefined();
    expect(String(signIn.headers["access-control-expose-headers"] ?? "")).not.toContain("set-ott");
  });

  it("has no /one-time-token routes when oauthHandoff is unset", async () => {
    const {app} = buildApp({oauthHandoff: undefined});

    const verifyRes = await verify(app, "anything");
    const generateRes = await supertest(app).get("/api/auth/one-time-token/generate");

    expect(verifyRes.status).toBe(404);
    expect(generateRes.status).toBe(404);
  });

  it("puts no ott on the callback redirect when oauthHandoff is unset", async () => {
    const {app} = buildApp({oauthHandoff: undefined});

    const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after`});

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${WEB_ORIGIN}/after`);
  });
});

describe("oauthHandoff configuration", () => {
  const invalid = [
    "web.example.com",
    "https://*.example.com",
    "exp://",
    "https://web.example.com/app",
    "https://web.example.com?x=1",
    "https://user@web.example.com",
  ];

  for (const entry of invalid) {
    it(`refuses "${entry}" as a web origin`, () => {
      expect(() => buildApp({oauthHandoff: {webOrigins: [entry]}})).toThrow(
        "oauthHandoff.webOrigins must list exact http(s) origins"
      );
    });
  }

  it("refuses an empty webOrigins list", () => {
    expect(() => buildApp({oauthHandoff: {webOrigins: []}})).toThrow(
      "oauthHandoff.webOrigins must list exact http(s) origins"
    );
  });

  for (const baseURL of ["localhost:3000", "not a url"]) {
    it(`refuses "${baseURL}" as the baseURL`, () => {
      expect(() => buildApp({baseURL})).toThrow("BETTER_AUTH_URL must be an absolute URL");
    });
  }

  it("accepts an origin with a trailing slash", async () => {
    const {app} = buildApp({
      oauthHandoff: {callbackPaths: ["/after"], webOrigins: [`${WEB_ORIGIN}/`]},
    });

    const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after`});

    expect(callback.headers.location).toStartWith(`${WEB_ORIGIN}/after#ott=`);
  });

  it("never hands a token to the API origin, even when listed", async () => {
    const {app} = buildApp({oauthHandoff: {webOrigins: [WEB_ORIGIN, API_ORIGIN]}});

    const callback = await completeSignIn(app, {callbackURL: `${API_ORIGIN}/welcome`});

    expect(callback.headers.location).toBe(`${API_ORIGIN}/welcome`);
  });
});

describe("GET /oauth-handoff/start", () => {
  // A top-level navigation from the web app to the API: no cookie, no Origin header.
  const start = (app: express.Application, query: Record<string, string>): supertest.Test =>
    supertest(app)
      .get(`/api/auth/oauth-handoff/start?${new URLSearchParams(query).toString()}`)
      .set("sec-fetch-site", "cross-site")
      .set("sec-fetch-mode", "navigate");

  const setCookies = (res: supertest.Response): string[] =>
    (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];

  it("starts the flow with a first-party state cookie and ends on the web origin with #ott", async () => {
    const {app} = buildApp();
    const callbackURL = `${WEB_ORIGIN}/after?handoff=nonce-123&tab=1`;

    const started = await start(app, {callbackURL, provider: PROVIDER_ID});

    expect(started.status).toBe(302);
    expect(started.headers.location).toStartWith(`${provider.issuer}/authorize?`);
    const stateCookie = setCookies(started).find((cookie) => cookie.includes(".state="));
    expect(stateCookie).toBeTruthy();
    // Lax comes back on the provider's top-level redirect to the callback.
    expect(stateCookie?.toLowerCase()).toContain("samesite=lax");
    expect(stateCookie?.toLowerCase()).toContain("httponly");

    const approval = await fetch(started.headers.location as string, {redirect: "manual"});
    const callback = new URL(approval.headers.get("location") ?? "");
    expect(callback.origin).toBe(API_ORIGIN);
    const returned = await supertest(app)
      .get(`${callback.pathname}${callback.search}`)
      .set("cookie", cookieHeaderFrom(started));

    expect(returned.status).toBe(302);
    const location = returned.headers.location as string;
    expect(location).toStartWith(`${callbackURL}#ott=`);
    const verified = await verify(app, fragmentParams(location).get("ott") ?? "");
    expect(verified.status).toBe(200);
    expect(verified.headers["set-auth-token"]).toBeTruthy();
  });

  it("sends a failed sign-in to a listed errorCallbackURL without a token", async () => {
    const {app} = buildApp();
    const started = await start(app, {
      callbackURL: `${WEB_ORIGIN}/after`,
      errorCallbackURL: `${WEB_ORIGIN}/sign-in-error`,
      provider: PROVIDER_ID,
    });
    const state = new URL(started.headers.location as string).searchParams.get("state") ?? "";

    const returned = await supertest(app)
      .get(`/api/auth/callback/${PROVIDER_ID}?error=access_denied&state=${state}`)
      .set("cookie", cookieHeaderFrom(started));

    expect(returned.status).toBe(302);
    expect(returned.headers.location).toStartWith(
      `${WEB_ORIGIN}/sign-in-error?error=access_denied`
    );
    expect(returned.headers.location).not.toContain("ott=");
  });

  it("fails the callback when the start's state cookie does not come back", async () => {
    const {app} = buildApp();
    const started = await start(app, {callbackURL: `${WEB_ORIGIN}/after`, provider: PROVIDER_ID});
    const approval = await fetch(started.headers.location as string, {redirect: "manual"});
    const callback = new URL(approval.headers.get("location") ?? "");

    const returned = await supertest(app).get(`${callback.pathname}${callback.search}`);

    expect(returned.status).toBe(302);
    expect(returned.headers.location).not.toContain("ott=");
    expect(returned.headers.location).toContain("error=state_mismatch");
  });

  const refused: {name: string; query: Record<string, string>}[] = [
    {name: "an exp:// app scheme", query: {callbackURL: "exp://127.0.0.1:8081/--/home"}},
    {name: "a relative path", query: {callbackURL: "/dashboard"}},
    {name: "a scheme-relative URL", query: {callbackURL: "//web.example.com/after"}},
    {name: "the API's own origin", query: {callbackURL: `${API_ORIGIN}/welcome`}},
    {name: "a trusted but unlisted origin", query: {callbackURL: "https://other.example.com/"}},
    {name: "an untrusted origin", query: {callbackURL: "https://evil.example/after"}},
    {name: "userinfo before another host", query: {callbackURL: `${WEB_ORIGIN}@evil.example/`}},
    {name: "the web host over http", query: {callbackURL: "http://web.example.com/after"}},
    {
      name: "an unlisted errorCallbackURL",
      query: {callbackURL: `${WEB_ORIGIN}/after`, errorCallbackURL: "https://evil.example/error"},
    },
    {name: "a missing callbackURL", query: {}},
  ];

  for (const {name, query} of refused) {
    it(`refuses ${name} with 400 and no redirect`, async () => {
      const {app} = buildApp();

      const res = await start(app, {provider: PROVIDER_ID, ...query});

      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
      expect(setCookies(res)).toEqual([]);
    });
  }

  it("sends an unknown provider back to the web app with an error", async () => {
    const {app} = buildApp();

    const res = await start(app, {callbackURL: `${WEB_ORIGIN}/after?handoff=n`, provider: "nope"});

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${WEB_ORIGIN}/after?handoff=n&error=provider_not_found`);
    expect(setCookies(res)).toEqual([]);
  });

  it("sends a provider that cannot start to the errorCallbackURL", async () => {
    const {app} = buildApp();

    const res = await start(app, {
      callbackURL: `${WEB_ORIGIN}/after`,
      errorCallbackURL: `${WEB_ORIGIN}/sign-in-error`,
      provider: "broken",
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${WEB_ORIGIN}/sign-in-error?error=sign_in_failed`);
  });

  it("refuses a listed web origin that is not in trustedOrigins", async () => {
    const listedOnly = "https://listed-only.example.com";
    const {app} = buildApp({oauthHandoff: {webOrigins: [WEB_ORIGIN, listedOnly]}});

    const res = await start(app, {callbackURL: `${listedOnly}/after`, provider: PROVIDER_ID});

    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it("refuses a request that is not a page navigation", async () => {
    const {app} = buildApp();

    const res = await start(app, {callbackURL: `${WEB_ORIGIN}/after`, provider: PROVIDER_ID}).set(
      "sec-fetch-dest",
      "image"
    );

    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(setCookies(res)).toEqual([]);
  });

  it("limits starts to three per ten seconds when Better Auth's limiter is on", async () => {
    const {app} = buildApp({
      options: {advanced: {disableOriginCheck: false}, rateLimit: {enabled: true}},
    });
    const query = {callbackURL: `${WEB_ORIGIN}/after`, provider: PROVIDER_ID};

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await start(app, query).set("x-forwarded-for", "203.0.113.9")).status);
    }

    expect(statuses).toEqual([302, 302, 302, 429]);
  });

  it("starts a built-in social provider", async () => {
    const {app} = buildApp({googleOAuth: {clientId: "google-id", clientSecret: "google-secret"}});

    const res = await start(app, {callbackURL: `${WEB_ORIGIN}/after`, provider: "google"});

    expect(res.status).toBe(302);
    const authorize = new URL(res.headers.location as string);
    expect(authorize.origin).toBe("https://accounts.google.com");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${API_ORIGIN}/api/auth/callback/google`
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(setCookies(res).some((cookie) => cookie.includes(".state="))).toBe(true);
  });

  it("sets a SameSite=None; Secure state cookie with crossDomainCookies", async () => {
    const {app} = buildApp({crossDomainCookies: true});

    const res = await start(app, {callbackURL: `${WEB_ORIGIN}/after`, provider: PROVIDER_ID});

    expect(res.status).toBe(302);
    const stateCookie = setCookies(res).find((cookie) => cookie.includes(".state="));
    expect(stateCookie?.toLowerCase()).toContain("samesite=none");
    expect(stateCookie?.toLowerCase()).toContain("secure");
  });

  it("does not exist when oauthHandoff is unset", async () => {
    const {app} = buildApp({oauthHandoff: undefined});

    const res = await start(app, {callbackURL: `${WEB_ORIGIN}/after`, provider: PROVIDER_ID});

    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });
});

describe("oauthHandoff callbackPaths", () => {
  const startFor = (app: express.Application, callbackURL: string): supertest.Test =>
    supertest(app)
      .get(
        `/api/auth/oauth-handoff/start?${new URLSearchParams({callbackURL, provider: PROVIDER_ID})}`
      )
      .set("sec-fetch-mode", "navigate");

  it("defaults to the web origin's root path", async () => {
    const {app} = buildApp({oauthHandoff: {webOrigins: [WEB_ORIGIN]}});

    const root = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/?handoff=n`});
    const other = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after`});
    const startOther = await startFor(app, `${WEB_ORIGIN}/after`);

    expect(root.headers.location).toStartWith(`${WEB_ORIGIN}/?handoff=n#ott=`);
    expect(other.headers.location).toBe(`${WEB_ORIGIN}/after`);
    expect(startOther.status).toBe(400);
    expect(startOther.headers.location).toBeUndefined();
  });

  it("hands a token only to the listed paths", async () => {
    const {app} = buildApp({
      oauthHandoff: {callbackPaths: ["/auth/return"], webOrigins: [WEB_ORIGIN]},
    });

    const listed = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/auth/return?handoff=n`});
    const root = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/`});
    const startListed = await startFor(app, `${WEB_ORIGIN}/auth/return?handoff=n`);
    const startRoot = await startFor(app, `${WEB_ORIGIN}/`);

    expect(listed.headers.location).toStartWith(`${WEB_ORIGIN}/auth/return?handoff=n#ott=`);
    expect(root.headers.location).toBe(`${WEB_ORIGIN}/`);
    expect(startListed.status).toBe(302);
    expect(startRoot.status).toBe(400);
  });

  it("checks only the origin of errorCallbackURL, which never carries a token", async () => {
    const {app} = buildApp();

    const res = await supertest(app)
      .get(
        `/api/auth/oauth-handoff/start?${new URLSearchParams({
          callbackURL: `${WEB_ORIGIN}/after`,
          errorCallbackURL: `${WEB_ORIGIN}/any/error/page`,
          provider: PROVIDER_ID,
        })}`
      )
      .set("sec-fetch-mode", "navigate");

    expect(res.status).toBe(302);
  });

  // The redirect must already be in the URL parser's normal form, and its path must then
  // match byte for byte; only the query and fragment are free.
  const pathCases: {location: string; name: string; ott: boolean}[] = [
    {location: `${WEB_ORIGIN}/after/`, name: "a trailing slash", ott: false},
    {location: `${WEB_ORIGIN}/AFTER`, name: "a different case", ott: false},
    {location: `${WEB_ORIGIN}//after`, name: "a doubled slash", ott: false},
    {location: `${WEB_ORIGIN}/x%2Fafter`, name: "an encoded slash", ott: false},
    {location: `${WEB_ORIGIN}/after%2F`, name: "a trailing encoded slash", ott: false},
    {location: `${WEB_ORIGIN}/after;x`, name: "a path parameter", ott: false},
    {location: `${WEB_ORIGIN}/x/%2e%2e/after`, name: "encoded dot segments", ott: false},
    {location: `${WEB_ORIGIN}/x/../after`, name: "dot segments", ott: false},
    {location: `${WEB_ORIGIN}/after?next=1`, name: "a listed path with a query", ott: true},
    {location: `${WEB_ORIGIN}/after#keep`, name: "a listed path with a fragment", ott: true},
  ];

  for (const {location, name, ott} of pathCases) {
    it(`${ott ? "hands" : "gives no"} ott to ${name}`, async () => {
      const {app} = buildApp();
      callbackOverride = {location};

      const callback = await completeSignIn(app, {callbackURL: `${WEB_ORIGIN}/after`});
      const started = await startFor(app, location);

      if (ott) {
        expect(callback.headers.location).toContain("ott=");
        expect(started.status).toBe(302);
      } else {
        expect(callback.headers.location).toBe(location);
        expect(started.status).toBe(400);
      }
    });
  }

  const invalidPaths: string[][] = [
    [],
    ["after"],
    ["//after"],
    ["/a/../b"],
    ["/%2e%2e/"],
    ["/a/./b"],
    ["/a%2Fb"],
    ["/a%5Cb"],
    ["/a\\b"],
    ["/a?x=1"],
    ["/a#x"],
    ["/a b"],
  ];

  for (const callbackPaths of invalidPaths) {
    it(`refuses callbackPaths ${JSON.stringify(callbackPaths)}`, () => {
      expect(() => buildApp({oauthHandoff: {callbackPaths, webOrigins: [WEB_ORIGIN]}})).toThrow(
        "oauthHandoff.callbackPaths must list exact absolute paths"
      );
    });
  }
});

describe("linking a provider through the handoff", () => {
  const LINK_TOKEN_ROWS = {identifier: {$regex: /^terreno-link-intent:/}};
  const START_URL = `${API_ORIGIN}/api/auth/oauth-handoff/link-start`;

  const betterAuthRows = (name: string): ReturnType<mongoose.mongo.Db["collection"]> => {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("The test database is not connected");
    }
    return db.collection(name);
  };

  interface SignedInUser {
    bearer: string;
    cookie: string;
    email: string;
    userId: string;
  }

  // Signs up with email and password; the provider then reports the same email, verified.
  const signUpUser = async (app: express.Application): Promise<SignedInUser> => {
    const email = `linker-${Math.random().toString(36).slice(2)}@example.com`;
    provider.setUser({email, id: `oidc-${Math.random().toString(36).slice(2)}`, name: "Linker"});
    const signUp = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("origin", WEB_ORIGIN)
      .set("content-type", "application/json")
      .send({email, name: "Linker", password: "password-123456"});
    expect(signUp.status).toBe(200);
    const bearer = signUp.headers["set-auth-token"] as string;
    expect(bearer).toBeTruthy();
    return {bearer, cookie: cookieHeaderFrom(signUp), email, userId: signUp.body.user.id};
  };

  // The web app's cross-site fetch, authenticated with its bearer.
  const linkIntent = (
    app: express.Application,
    bearer: string,
    body: Record<string, string>
  ): supertest.Test =>
    supertest(app)
      .post("/api/auth/oauth-handoff/link-intent")
      .set("origin", WEB_ORIGIN)
      .set("sec-fetch-site", "cross-site")
      .set("sec-fetch-mode", "cors")
      .set("authorization", `Bearer ${bearer}`)
      .set("content-type", "application/json")
      .send(body);

  // The hidden form's top-level POST navigation from the web app: no cookie, no bearer.
  const linkStart = (app: express.Application, token: string): supertest.Test =>
    supertest(app)
      .post("/api/auth/oauth-handoff/link-start")
      .set("origin", WEB_ORIGIN)
      .set("sec-fetch-site", "cross-site")
      .set("sec-fetch-mode", "navigate")
      .set("sec-fetch-dest", "document")
      .type("form")
      .send({token});

  const mintToken = async (
    app: express.Application,
    bearer: string,
    body: Record<string, string> = {callbackURL: `${WEB_ORIGIN}/after`, provider: PROVIDER_ID}
  ): Promise<string> => {
    const intent = await linkIntent(app, bearer, body);
    expect(intent.status).toBe(200);
    return intent.body.token as string;
  };

  const setCookies = (res: supertest.Response): string[] =>
    (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];

  it("links the provider for a signed-in bearer user, with no new session and no ott", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const sessionsBefore = await betterAuthRows("session").countDocuments({});

    const intent = await linkIntent(app, user.bearer, {
      callbackURL: `${WEB_ORIGIN}/after?tab=security`,
      errorCallbackURL: `${WEB_ORIGIN}/settings/security`,
      provider: PROVIDER_ID,
    });
    expect(intent.status).toBe(200);
    expect(intent.body.startURL).toBe(START_URL);
    expect(intent.headers["cache-control"]).toBe("no-store");

    const started = await linkStart(app, intent.body.token);
    expect(started.status).toBe(302);
    expect(started.headers.location).toStartWith(`${provider.issuer}/authorize?`);
    const startCookies = setCookies(started);
    expect(startCookies.some((cookie) => cookie.includes(".state="))).toBe(true);
    // Reading the session must not sign the browser in with a cookie on the API's origin.
    expect(startCookies.some((cookie) => cookie.includes("session_token="))).toBe(false);
    expect(startCookies.some((cookie) => cookie.includes("session_data="))).toBe(false);
    expect(started.headers["set-auth-token"]).toBeUndefined();

    const approval = await fetch(started.headers.location as string, {redirect: "manual"});
    const callback = new URL(approval.headers.get("location") ?? "");
    expect(callback.origin).toBe(API_ORIGIN);
    const returned = await supertest(app)
      .get(`${callback.pathname}${callback.search}`)
      .set("cookie", cookieHeaderFrom(started));

    expect(returned.status).toBe(302);
    // Linking creates no session, so the return carries no one-time token.
    expect(returned.headers.location).toBe(`${WEB_ORIGIN}/after?tab=security`);
    expect(await verificationRows().countDocuments(HANDOFF_TOKEN_ROWS)).toBe(0);
    const accounts = await betterAuthRows("account")
      .find({userId: new mongoose.Types.ObjectId(user.userId)})
      .toArray();
    expect(accounts.map((account) => account.providerId).sort()).toEqual([
      "credential",
      PROVIDER_ID,
    ]);
    expect(await betterAuthRows("session").countDocuments({})).toBe(sessionsBefore);
    expect(setCookies(returned).some((cookie) => cookie.includes("session_token="))).toBe(false);
  });

  it("accepts a cookie-authenticated intent from a listed web origin", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);

    const intent = await supertest(app)
      .post("/api/auth/oauth-handoff/link-intent")
      .set("origin", WEB_ORIGIN)
      .set("cookie", user.cookie)
      .set("content-type", "application/json")
      .send({callbackURL: `${WEB_ORIGIN}/after`, provider: PROVIDER_ID});

    expect(intent.status).toBe(200);
    expect(intent.body.token).toBeTruthy();
  });

  it("stores the link token hashed under its own identifier, expiring in three minutes", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);

    const token = await mintToken(app, user.bearer);

    const rows = await verificationRows().find(LINK_TOKEN_ROWS).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).not.toContain(token);
    expect(rows[0].value).not.toContain(token);
    const minutes = DateTime.fromJSDate(rows[0].expiresAt).diffNow("minutes").minutes;
    expect(minutes).toBeGreaterThan(2.5);
    expect(minutes).toBeLessThanOrEqual(3);
    // A link token is not a sign-in token.
    expect((await verify(app, token)).status).toBe(400);
  });

  it("refuses a reused token with 400 and no redirect", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer);
    expect((await linkStart(app, token)).status).toBe(302);

    const reused = await linkStart(app, token);

    expect(reused.status).toBe(400);
    expect(reused.headers.location).toBeUndefined();
    expect(setCookies(reused)).toEqual([]);
  });

  it("refuses an expired token with 400 and no redirect", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer);
    await verificationRows().updateMany(LINK_TOKEN_ROWS, {
      $set: {expiresAt: DateTime.now().minus({seconds: 1}).toJSDate()},
    });

    const expired = await linkStart(app, token);

    expect(expired.status).toBe(400);
    expect(expired.headers.location).toBeUndefined();
  });

  it("refuses an unknown or missing token with 400", async () => {
    const {app} = buildApp();

    const unknown = await linkStart(app, "not-a-real-token");
    const missing = await supertest(app)
      .post("/api/auth/oauth-handoff/link-start")
      .set("origin", WEB_ORIGIN)
      .type("form")
      .send({});

    expect(unknown.status).toBe(400);
    expect(unknown.headers.location).toBeUndefined();
    expect(missing.status).toBe(400);
  });

  it("lets only one of two concurrent starts use the token", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer);

    const results = await Promise.all([linkStart(app, token), linkStart(app, token)]);

    expect(results.map((res) => res.status).sort()).toEqual([302, 400]);
  });

  // Better Auth's own origin check refuses an untrusted URL in a POST body first, with 403; the
  // handoff refuses every other URL that is not absolute on a listed web origin with 400.
  const refusedURLs: {body: Record<string, string>; name: string; status: number}[] = [
    {
      body: {callbackURL: "https://other.example.com/after"},
      name: "a trusted but unlisted origin",
      status: 400,
    },
    {body: {callbackURL: "/after"}, name: "a relative path", status: 400},
    {body: {callbackURL: `${API_ORIGIN}/after`}, name: "the API's own origin", status: 400},
    {body: {callbackURL: "exp://127.0.0.1:8081/--/home"}, name: "an app scheme", status: 400},
    {
      body: {callbackURL: `${WEB_ORIGIN}/after`, errorCallbackURL: "https://other.example.com/e"},
      name: "a trusted but unlisted errorCallbackURL",
      status: 400,
    },
    {body: {callbackURL: "https://evil.example/after"}, name: "an untrusted origin", status: 403},
    {
      body: {callbackURL: `${WEB_ORIGIN}/after`, errorCallbackURL: "https://evil.example/error"},
      name: "an untrusted errorCallbackURL",
      status: 403,
    },
  ];

  for (const {body, name, status} of refusedURLs) {
    it(`refuses an intent for ${name} with ${status} and mints nothing`, async () => {
      const {app} = buildApp();
      const user = await signUpUser(app);

      const intent = await linkIntent(app, user.bearer, {provider: PROVIDER_ID, ...body});

      expect(intent.status).toBe(status);
      expect(intent.body.token).toBeUndefined();
      expect(await verificationRows().countDocuments(LINK_TOKEN_ROWS)).toBe(0);
    });
  }

  it("accepts any absolute path on a web origin as the link return, outside callbackPaths", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer, {
      callbackURL: `${WEB_ORIGIN}/settings/security`,
      errorCallbackURL: `${WEB_ORIGIN}/settings/security?failed=1`,
      provider: PROVIDER_ID,
    });

    const started = await linkStart(app, token);
    const approval = await fetch(started.headers.location as string, {redirect: "manual"});
    const callback = new URL(approval.headers.get("location") ?? "");
    const returned = await supertest(app)
      .get(`${callback.pathname}${callback.search}`)
      .set("cookie", cookieHeaderFrom(started));

    expect(started.status).toBe(302);
    expect(returned.status).toBe(302);
    expect(returned.headers.location).toBe(`${WEB_ORIGIN}/settings/security`);
    expect(
      await betterAuthRows("account").countDocuments({
        providerId: PROVIDER_ID,
        userId: new mongoose.Types.ObjectId(user.userId),
      })
    ).toBe(1);
  });

  it("links the token's user even when the browser sends another user's cookies", async () => {
    const {app} = buildApp();
    const other = await signUpUser(app);
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer);

    const started = await linkStart(app, token).set("cookie", other.cookie);
    const approval = await fetch(started.headers.location as string, {redirect: "manual"});
    const callback = new URL(approval.headers.get("location") ?? "");
    const returned = await supertest(app)
      .get(`${callback.pathname}${callback.search}`)
      .set("cookie", `${other.cookie}; ${cookieHeaderFrom(started)}`);

    expect(started.status).toBe(302);
    const startCookies = setCookies(started);
    expect(startCookies.some((cookie) => cookie.includes(".state="))).toBe(true);
    for (const name of ["session_token=", "session_data=", "dont_remember="]) {
      expect({name, set: startCookies.some((cookie) => cookie.includes(name))}).toEqual({
        name,
        set: false,
      });
    }
    expect(returned.headers.location).toBe(`${WEB_ORIGIN}/after`);
    const linkedTo = await betterAuthRows("account")
      .find({providerId: PROVIDER_ID})
      .map((account) => String(account.userId))
      .toArray();
    expect(linkedTo).toEqual([user.userId]);
  });

  it("limits link intents to three per ten seconds when Better Auth's limiter is on", async () => {
    const {app} = buildApp({
      options: {advanced: {disableOriginCheck: false}, rateLimit: {enabled: true}},
    });
    const user = await signUpUser(app);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push(
        (
          await linkIntent(app, user.bearer, {
            callbackURL: `${WEB_ORIGIN}/after`,
            provider: PROVIDER_ID,
          }).set("x-forwarded-for", "203.0.113.11")
        ).status
      );
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("refuses an intent without a session with 401", async () => {
    const {app} = buildApp();

    const intent = await supertest(app)
      .post("/api/auth/oauth-handoff/link-intent")
      .set("origin", WEB_ORIGIN)
      .set("content-type", "application/json")
      .send({callbackURL: `${WEB_ORIGIN}/after`, provider: PROVIDER_ID});

    expect(intent.status).toBe(401);
    expect(await verificationRows().countDocuments(LINK_TOKEN_ROWS)).toBe(0);
  });

  it("refuses the intent with 403 when accountLinking.mode is never", async () => {
    const {app} = buildApp({accountLinking: {mode: "never"}});
    const user = await signUpUser(app);

    const intent = await linkIntent(app, user.bearer, {
      callbackURL: `${WEB_ORIGIN}/after`,
      provider: PROVIDER_ID,
    });

    expect(intent.status).toBe(403);
    expect(intent.body.code).toBe("LINKING_DISABLED");
    expect(await verificationRows().countDocuments(LINK_TOKEN_ROWS)).toBe(0);
  });

  it("sends a session revoked after the intent back with error=session_expired", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer, {
      callbackURL: `${WEB_ORIGIN}/after`,
      errorCallbackURL: `${WEB_ORIGIN}/settings/security`,
      provider: PROVIDER_ID,
    });
    const signOut = await supertest(app)
      .post("/api/auth/sign-out")
      .set("origin", WEB_ORIGIN)
      .set("authorization", `Bearer ${user.bearer}`)
      .set("content-type", "application/json")
      .send({});
    expect(signOut.status).toBe(200);

    const started = await linkStart(app, token);

    expect(started.status).toBe(302);
    expect(started.headers.location).toBe(`${WEB_ORIGIN}/settings/security?error=session_expired`);
    expect(setCookies(started).some((cookie) => cookie.includes(".state="))).toBe(false);
    expect(await verificationRows().countDocuments(LINK_TOKEN_ROWS)).toBe(0);
    expect(
      await betterAuthRows("account").countDocuments({
        providerId: PROVIDER_ID,
        userId: new mongoose.Types.ObjectId(user.userId),
      })
    ).toBe(0);
  });

  it("sends an unknown provider back to callbackURL with error=provider_not_found", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer, {
      callbackURL: `${WEB_ORIGIN}/after?tab=security`,
      provider: "nope",
    });

    const started = await linkStart(app, token);

    expect(started.status).toBe(302);
    expect(started.headers.location).toBe(
      `${WEB_ORIGIN}/after?tab=security&error=provider_not_found`
    );
  });

  it("refuses a start that is not a page navigation and keeps the token", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer);

    const refused = await linkStart(app, token).set("sec-fetch-dest", "iframe");
    const retried = await linkStart(app, token);

    expect(refused.status).toBe(400);
    expect(refused.headers.location).toBeUndefined();
    expect(retried.status).toBe(302);
  });

  it("refuses a start posted from another origin and keeps the token", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer);

    const fromOther = await linkStart(app, token).set("origin", "https://other.example.com");
    const fromNull = await linkStart(app, token).set("origin", "null");
    const retried = await linkStart(app, token);

    expect(fromOther.status).toBe(403);
    expect(fromOther.headers.location).toBeUndefined();
    expect(fromNull.status).toBe(403);
    expect(retried.status).toBe(302);
  });

  it("refuses a start without an Origin header and keeps the token", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer);

    const withoutOrigin = await supertest(app)
      .post("/api/auth/oauth-handoff/link-start")
      .set("sec-fetch-dest", "document")
      .type("form")
      .send({token});
    const retried = await linkStart(app, token);

    expect(withoutOrigin.status).toBe(403);
    expect(withoutOrigin.headers.location).toBeUndefined();
    expect(retried.status).toBe(302);
  });

  it("refuses a JSON start, so the token only travels in a form body", async () => {
    const {app} = buildApp();
    const user = await signUpUser(app);
    const token = await mintToken(app, user.bearer);

    const json = await supertest(app)
      .post("/api/auth/oauth-handoff/link-start")
      .set("origin", WEB_ORIGIN)
      .set("content-type", "application/json")
      .send({token});

    expect(json.status).toBe(415);
    expect(await verificationRows().countDocuments(LINK_TOKEN_ROWS)).toBe(1);
  });

  it("limits link starts to three per ten seconds when Better Auth's limiter is on", async () => {
    const {app} = buildApp({
      options: {advanced: {disableOriginCheck: false}, rateLimit: {enabled: true}},
    });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push(
        (await linkStart(app, `token-${attempt}`).set("x-forwarded-for", "203.0.113.10")).status
      );
    }

    expect(statuses).toEqual([400, 400, 400, 429]);
  });

  it("has no link routes when oauthHandoff is unset", async () => {
    const {app} = buildApp({oauthHandoff: undefined});
    const user = await signUpUser(app);

    const intent = await linkIntent(app, user.bearer, {
      callbackURL: `${WEB_ORIGIN}/after`,
      provider: PROVIDER_ID,
    });
    const started = await linkStart(app, "anything");

    expect(intent.status).toBe(404);
    expect(started.status).toBe(404);
  });
});
