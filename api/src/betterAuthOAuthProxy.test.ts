/**
 * oauth-proxy across two deploys: a "stable" API that owns the provider's registered callback,
 * and a "preview" API with its own database that shares only the secret. A sign-in started on
 * the preview goes to the provider with stable's callback, stable turns the provider's answer
 * into an encrypted profile and sends it back to the preview, and the preview creates the
 * session and hands it to its bearer-mode web app with a one-time token.
 */
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {once} from "node:events";
import type {IncomingMessage, Server, ServerResponse} from "node:http";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {genericOAuth} from "better-auth/plugins";
import express from "express";
import mongoose from "mongoose";
import type {BetterAuthConfig} from "./betterAuth";
import {createBetterAuth, type MongoClientLike, mountBetterAuthRoutes} from "./betterAuthSetup";
import {type MockOidcProvider, startMockOidcProvider} from "./tests/mockOidcProvider";

const PROVIDER_ID = "mock-oidc";
const SHARED_SECRET = "shared-secret-at-least-32-characters-long";
const STABLE_WEB_ORIGIN = "https://app.example.com";
const PREVIEW_WEB_ORIGIN = "https://deploy-preview-42--example.netlify.app";
// Sign in with Apple posts its form_post return from this origin.
const APPLE_ORIGIN = "https://appleid.apple.com";
const STABLE_DB = "terreno-oauth-proxy-stable";
const PREVIEW_DB = "terreno-oauth-proxy-preview";
const AUTH_COLLECTIONS = ["user", "session", "account", "verification"];

interface Deploy {
  close: () => Promise<void>;
  /** The API's origin, such as `http://127.0.0.1:41234`. */
  origin: string;
  /** Builds the deploy's Better Auth app once its origin is known. */
  setApp: (app: express.Application) => void;
}

// Listens first, so the Better Auth baseURL can name the real port.
const startDeploy = async (): Promise<Deploy> => {
  let current: express.Application | undefined;
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!current) {
      res.statusCode = 503;
      res.end();
      return;
    }
    current(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    close: async (): Promise<void> => {
      server.close();
      await once(server, "close");
    },
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    setApp: (app: express.Application): void => {
      current = app;
    },
  };
};

// Each deploy gets its own database on the test server, as previews do in Cloud Run.
const databaseNamed = (name: string): MongoClientLike => {
  const client = (
    mongoose.connection as unknown as {client?: {db: (n: string) => mongoose.mongo.Db}}
  ).client;
  if (!client) {
    throw new Error("The test database is not connected");
  }
  return {db: () => client.db(name)};
};

const countIn = async (dbName: string, collection: string): Promise<number> =>
  databaseNamed(dbName).db().collection(collection).countDocuments();

let provider: MockOidcProvider;
let stable: Deploy;
let preview: Deploy;

const mockProviderPlugin = (): ReturnType<typeof genericOAuth> =>
  genericOAuth({
    config: [
      {
        clientId: "mock-client",
        clientSecret: "mock-secret",
        discoveryUrl: `${provider.issuer}/.well-known/openid-configuration`,
        providerId: PROVIDER_ID,
      },
    ],
  });

const mountDeploy = (deploy: Deploy, dbName: string, config: Partial<BetterAuthConfig>): void => {
  const auth = createBetterAuth({
    config: {
      baseURL: deploy.origin,
      enabled: true,
      // Better Auth skips origin checks when NODE_ENV is "test"; turn them back on so every
      // callbackURL below passes the same check it would in production.
      options: {advanced: {disableOriginCheck: false}},
      plugins: [mockProviderPlugin()],
      secret: SHARED_SECRET,
      ...config,
    },
    mongoClient: databaseNamed(dbName),
  });
  const app = express();
  mountBetterAuthRoutes(app, auth);
  deploy.setApp(app);
};

const fetchManual = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, {...init, redirect: "manual"});

const locationOf = (res: Response): string => {
  const location = res.headers.get("location");
  if (!location) {
    throw new Error(`Expected a redirect, got ${res.status}: no location header`);
  }
  return location;
};

interface ProxiedReturn {
  /** The preview URL stable redirected to, carrying the encrypted profile. */
  proxyReturn: URL;
  /** The provider's authorize URL the preview sent the browser to. */
  authorize: URL;
}

// The browser's trip: the preview starts the sign-in, the provider approves, and the provider's
// redirect lands on stable's registered callback, which answers with a redirect to the preview.
const runToStableCallback = async (callbackURL: string): Promise<ProxiedReturn> => {
  const start = await fetchManual(
    `${preview.origin}/api/auth/oauth-handoff/start?${new URLSearchParams({
      callbackURL,
      provider: PROVIDER_ID,
    })}`,
    {headers: {"sec-fetch-dest": "document"}}
  );
  expect(start.status).toBe(302);
  const authorize = new URL(locationOf(start));
  expect(authorize.origin).toBe(provider.issuer);

  const approval = await fetchManual(authorize.toString());
  const callback = new URL(locationOf(approval));
  // The provider only ever sees stable's registered callback.
  expect(callback.origin).toBe(stable.origin);
  expect(callback.pathname).toBe(`/api/auth/callback/${PROVIDER_ID}`);

  // No cookie from the preview travels to stable: the state rides in the encrypted `state`.
  const stableCallback = await fetchManual(callback.toString());
  expect(stableCallback.status).toBe(302);
  return {authorize, proxyReturn: new URL(locationOf(stableCallback))};
};

// `name=value` pairs from a response's set-cookie headers, ready for a cookie request header.
const cookieHeader = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");

interface SocialStart {
  cookie: string;
  url: string;
}

// The web app's own `signIn.social` call (POST, JSON), as a cookie-mode client makes it.
const postSignInSocial = async (
  apiOrigin: string,
  webOrigin: string,
  callbackURL: string
): Promise<SocialStart> => {
  const res = await fetch(`${apiOrigin}/api/auth/sign-in/social`, {
    body: JSON.stringify({callbackURL, provider: PROVIDER_ID}),
    headers: {"content-type": "application/json", origin: webOrigin},
    method: "POST",
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {url: string};
  return {cookie: cookieHeader(res), url: body.url};
};

const verifyOnPreview = (token: string): Promise<Response> =>
  fetch(`${preview.origin}/api/auth/one-time-token/verify`, {
    body: JSON.stringify({token}),
    headers: {"content-type": "application/json", origin: PREVIEW_WEB_ORIGIN},
    method: "POST",
  });

const ottFrom = (location: string): string =>
  new URLSearchParams(new URL(location).hash.slice(1)).get("ott") ?? "";

beforeAll(async () => {
  provider = await startMockOidcProvider();
  stable = await startDeploy();
  preview = await startDeploy();
  // Stable runs the plugin too, naming itself: its callback hook is what forwards a preview's
  // return. Naming itself makes its own sign-ins skip the proxy, so they keep the state cookie.
  mountDeploy(stable, STABLE_DB, {
    oauthHandoff: {webOrigins: [STABLE_WEB_ORIGIN]},
    oauthProxy: {productionURL: stable.origin},
    trustedOrigins: [STABLE_WEB_ORIGIN, APPLE_ORIGIN],
  });
  mountDeploy(preview, PREVIEW_DB, {
    oauthHandoff: {callbackPaths: ["/", "/after"], webOrigins: [PREVIEW_WEB_ORIGIN]},
    oauthProxy: {productionURL: stable.origin},
    trustedOrigins: [PREVIEW_WEB_ORIGIN],
  });
});

afterAll(async () => {
  await preview?.close();
  await stable?.close();
  await provider?.close();
  await databaseNamed(STABLE_DB).db().dropDatabase();
  await databaseNamed(PREVIEW_DB).db().dropDatabase();
});

beforeEach(async () => {
  provider.setUser({
    email: `proxy-${Math.random().toString(36).slice(2)}@example.com`,
    id: `proxy-${Math.random().toString(36).slice(2)}`,
    name: "Proxy User",
  });
  for (const dbName of [STABLE_DB, PREVIEW_DB]) {
    for (const collection of AUTH_COLLECTIONS) {
      await databaseNamed(dbName).db().collection(collection).deleteMany({});
    }
  }
});

describe("oauthProxy between a preview and the stable deploy", () => {
  it("returns a preview-started sign-in through stable's callback with a one-time token", async () => {
    const {authorize, proxyReturn} = await runToStableCallback(`${PREVIEW_WEB_ORIGIN}/after`);

    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${stable.origin}/api/auth/callback/${PROVIDER_ID}`
    );
    expect(proxyReturn.origin).toBe(preview.origin);
    expect(proxyReturn.pathname).toBe(`/api/auth/callback/${PROVIDER_ID}/oauth-proxy`);
    expect(proxyReturn.searchParams.get("callbackURL")).toBe(`${PREVIEW_WEB_ORIGIN}/after`);
    expect(proxyReturn.searchParams.get("profile")).toBeTruthy();
    // Stable finished the provider's code exchange without writing anything of its own.
    for (const collection of AUTH_COLLECTIONS) {
      expect(await countIn(STABLE_DB, collection)).toBe(0);
    }

    const finish = await fetchManual(proxyReturn.toString());
    expect(finish.status).toBe(302);
    const location = locationOf(finish);
    expect(location).toStartWith(`${PREVIEW_WEB_ORIGIN}/after#ott=`);
    // The bearer web app gets its session from the token, not from a cookie on the preview API.
    const cookies = finish.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.includes("session_token="))).toBe(false);

    const verified = await verifyOnPreview(ottFrom(location));
    expect(verified.status).toBe(200);
    const bearer = verified.headers.get("set-auth-token") ?? "";
    expect(bearer).toBeTruthy();
    const session = await fetch(`${preview.origin}/api/auth/get-session`, {
      headers: {authorization: `Bearer ${bearer}`},
    });
    const body = (await session.json()) as {user: {email: string}};
    expect(body.user.email).toStartWith("proxy-");

    // The user, account and session live only in the preview's database.
    expect(await countIn(PREVIEW_DB, "user")).toBe(1);
    expect(await countIn(PREVIEW_DB, "account")).toBe(1);
    expect(await countIn(STABLE_DB, "user")).toBe(0);
    expect(await countIn(STABLE_DB, "session")).toBe(0);
  });

  it("proxies a form_post return (Apple's response_mode) from a trusted provider origin", async () => {
    const start = await fetchManual(
      `${preview.origin}/api/auth/oauth-handoff/start?${new URLSearchParams({
        callbackURL: `${PREVIEW_WEB_ORIGIN}/`,
        provider: PROVIDER_ID,
      })}`,
      {headers: {"sec-fetch-dest": "document"}}
    );
    const approval = new URL(locationOf(await fetchManual(locationOf(start))));

    // Apple posts `code` and `state` from appleid.apple.com to the registered callback. The
    // state rides in the encrypted package, so no SameSite=Lax cookie is needed; a SameSite=None
    // cookie the browser does send makes Better Auth check the POST's Origin, which is why the
    // stable deploy lists appleid.apple.com in trustedOrigins.
    const posted = await fetchManual(`${stable.origin}/api/auth/callback/${PROVIDER_ID}`, {
      body: new URLSearchParams({
        code: approval.searchParams.get("code") ?? "",
        state: approval.searchParams.get("state") ?? "",
      }).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "__Secure-better-auth.session_token=unrelated",
        origin: APPLE_ORIGIN,
        "sec-fetch-site": "cross-site",
      },
      method: "POST",
    });
    expect(posted.status).toBe(302);
    const proxyReturn = new URL(locationOf(posted));
    expect(proxyReturn.origin).toBe(preview.origin);

    const finish = await fetchManual(proxyReturn.toString());

    expect(locationOf(finish)).toStartWith(`${PREVIEW_WEB_ORIGIN}/#ott=`);
  });

  it("hands off on the deprecated /oauth-proxy-callback path too", async () => {
    const {proxyReturn} = await runToStableCallback(`${PREVIEW_WEB_ORIGIN}/`);
    const legacy = new URL(`${preview.origin}/api/auth/oauth-proxy-callback`);
    legacy.search = proxyReturn.search;

    const finish = await fetchManual(legacy.toString());

    expect(finish.status).toBe(302);
    const location = locationOf(finish);
    expect(location).toStartWith(`${PREVIEW_WEB_ORIGIN}/#ott=`);
    const verified = await verifyOnPreview(ottFrom(location));
    expect(verified.status).toBe(200);
  });

  it("refuses a profile replayed after its sign-in finished", async () => {
    const {proxyReturn} = await runToStableCallback(`${PREVIEW_WEB_ORIGIN}/after`);
    const first = await fetchManual(proxyReturn.toString());
    expect(locationOf(first)).toContain("#ott=");

    const replay = await fetchManual(proxyReturn.toString());

    expect(replay.status).toBe(302);
    expect(locationOf(replay)).not.toContain("ott=");
    expect(locationOf(replay)).toContain("error=state_mismatch");
  });

  it("refuses a profile from a deploy with a different secret", async () => {
    const stranger = await startDeploy();
    try {
      mountDeploy(stranger, PREVIEW_DB, {
        oauthHandoff: {webOrigins: [PREVIEW_WEB_ORIGIN]},
        oauthProxy: {productionURL: stable.origin},
        secret: "another-secret-at-least-32-characters-long",
        trustedOrigins: [PREVIEW_WEB_ORIGIN],
      });
      const {proxyReturn} = await runToStableCallback(`${PREVIEW_WEB_ORIGIN}/after`);
      const forged = new URL(`${stranger.origin}${proxyReturn.pathname}`);
      forged.search = proxyReturn.search;

      const finish = await fetchManual(forged.toString());

      expect(finish.status).toBe(302);
      expect(locationOf(finish)).toContain("error=invalid_profile");
      expect(locationOf(finish)).not.toContain("ott=");
    } finally {
      await stranger.close();
    }
  });

  it("returns a sign-in started on stable straight to its web app, with the state cookie", async () => {
    const start = await fetchManual(
      `${stable.origin}/api/auth/oauth-handoff/start?${new URLSearchParams({
        callbackURL: `${STABLE_WEB_ORIGIN}/`,
        provider: PROVIDER_ID,
      })}`,
      {headers: {"sec-fetch-dest": "document"}}
    );
    const approval = await fetchManual(locationOf(start));
    const callbackURL = locationOf(approval);

    // Without the browser's state cookie, Better Auth refuses the return (login CSRF guard).
    const withoutCookie = await fetchManual(callbackURL);
    expect(locationOf(withoutCookie)).toContain("error=state_mismatch");
    expect(locationOf(withoutCookie)).not.toContain("ott=");

    const finish = await fetchManual(callbackURL, {headers: {cookie: cookieHeader(start)}});

    // No hop through oauth-proxy's completion, which would skip the state-cookie check.
    expect(locationOf(finish)).toStartWith(`${STABLE_WEB_ORIGIN}/#ott=`);
    expect(await countIn(STABLE_DB, "user")).toBe(1);
    expect(await countIn(PREVIEW_DB, "user")).toBe(0);
  });

  it("leaves a direct sign-in on stable unproxied, even on another host name", async () => {
    // A Cloud Run tag URL (prod---...) reaches the same server under another host.
    const otherHost = stable.origin.replace("127.0.0.1", "localhost");
    const start = await postSignInSocial(otherHost, STABLE_WEB_ORIGIN, `${STABLE_WEB_ORIGIN}/home`);
    const authorize = new URL(start.url);
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${stable.origin}/api/auth/callback/${PROVIDER_ID}`
    );

    const approval = await fetchManual(authorize.toString());
    const finish = await fetchManual(locationOf(approval), {headers: {cookie: start.cookie}});

    expect(locationOf(finish)).toBe(`${STABLE_WEB_ORIGIN}/home`);
  });

  it("sends a direct sign-in on the preview through stable's callback", async () => {
    const start = await postSignInSocial(
      preview.origin,
      PREVIEW_WEB_ORIGIN,
      `${PREVIEW_WEB_ORIGIN}/home`
    );
    const authorize = new URL(start.url);
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${stable.origin}/api/auth/callback/${PROVIDER_ID}`
    );

    const approval = await fetchManual(authorize.toString());
    const proxyReturn = new URL(locationOf(await fetchManual(locationOf(approval))));
    expect(proxyReturn.origin).toBe(preview.origin);
    const finish = await fetchManual(proxyReturn.toString());

    // /home is not a handoff page, so the cookie client gets its session cookie and no token.
    expect(locationOf(finish)).toBe(`${PREVIEW_WEB_ORIGIN}/home`);
    expect(finish.headers.getSetCookie().some((cookie) => cookie.includes("session_token="))).toBe(
      true
    );
    expect(await countIn(PREVIEW_DB, "user")).toBe(1);
  });
});
