import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {spawnSync} from "node:child_process";
import {generateKeyPairSync} from "node:crypto";
import {once} from "node:events";
import {createServer, type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {join} from "node:path";
import {
  BetterAuthApp,
  type BetterAuthConfig,
  type BetterAuthMethods,
  type UserModel as TerrenoAuthUserModel,
} from "@terreno/api";
import express from "express";
import supertest from "supertest";
import {User} from "../models/user";
import {
  APPLE_SIGN_IN_ORIGIN,
  buildBetterAuthConfig,
  EXAMPLE_APP_NAME,
  getOAuthHandoffWebOrigins,
  getWebOrigins,
  MOCK_OIDC_PROVIDER_ID,
  OAUTH_HANDOFF_CALLBACK_PATHS,
  OAUTH_PROXY_PREVIEW_CLIENT_SECRET,
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

const methodsFor = async (config: BetterAuthConfig): Promise<BetterAuthMethods> => {
  const app = express();
  new BetterAuthApp({config, userModel: User as unknown as TerrenoAuthUserModel}).register(app);
  const res = await supertest(app).get("/api/auth/terreno/methods");
  expect(res.status).toBe(200);
  return res.body as BetterAuthMethods;
};

const requireConfig = (): BetterAuthConfig => {
  const config = buildBetterAuthConfig();
  if (!config) {
    throw new Error("Better Auth is the default provider, so a config is expected");
  }
  return config;
};

describe("buildBetterAuthConfig auth features", () => {
  const originalCorsOrigins = process.env.CORS_ORIGINS;
  const originalNodeEnv = process.env.NODE_ENV;

  // The preload unsets AUTH_ACCOUNT_LINKING, AUTH_SIGN_UP, PASSKEY_RP_ID and FRONTEND_URL.
  beforeEach(() => {
    Reflect.deleteProperty(process.env, "CORS_ORIGINS");
  });

  afterEach(() => {
    if (originalCorsOrigins === undefined) {
      Reflect.deleteProperty(process.env, "CORS_ORIGINS");
    } else {
      process.env.CORS_ORIGINS = originalCorsOrigins;
    }
    // The preload does not reset NODE_ENV, so a production case must not leak into later files.
    if (originalNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("leaves passkeys off in production while FRONTEND_URL is a loopback URL", async () => {
    process.env.NODE_ENV = "production";
    const config = requireConfig();
    expect(config.passkey).toBeUndefined();
    const methods = await methodsFor(config);
    expect(methods.passkey).toBe(false);
    expect(methods.twoFactor).toBe(true);

    process.env.FRONTEND_URL = "http://127.0.0.1:8082";
    expect(requireConfig().passkey).toBeUndefined();
  });

  it("keeps passkeys on in production once FRONTEND_URL is the deployed web app", async () => {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://app.example.com";
    const config = requireConfig();
    expect(config.passkey?.rpID).toBe("app.example.com");
    expect((await methodsFor(config)).passkey).toBe(true);
  });

  it("enables every auth feature with the default env", async () => {
    const config = requireConfig();
    expect(config.accountLinking).toEqual({mode: "verified-email"});
    expect(config.signUp).toEqual({mode: "open"});
    expect(config.twoFactor).toEqual({issuer: "Terreno Example"});
    expect(EXAMPLE_APP_NAME).toBe("Terreno Example");
    expect(config.passkey).toEqual({
      origin: ["http://localhost:8082"],
      rpID: "localhost",
      rpName: "Terreno Example",
    });
    expect(config.lastLoginMethod).toBe(true);
    expect(config.multiSession).toEqual({});
    expect(config.nativeApps).toBe(true);

    const methods = await methodsFor(config);
    expect(methods).toMatchObject({
      accountLinking: {mode: "verified-email"},
      emailPassword: true,
      multiSession: true,
      passkey: true,
      signUp: true,
      twoFactor: true,
    });
  });

  it("switches the linking mode with AUTH_ACCOUNT_LINKING", async () => {
    process.env.AUTH_ACCOUNT_LINKING = "explicit";
    const config = requireConfig();
    expect(config.accountLinking).toEqual({mode: "explicit"});
    expect((await methodsFor(config)).accountLinking).toEqual({mode: "explicit"});

    process.env.AUTH_ACCOUNT_LINKING = "never";
    expect(requireConfig().accountLinking).toEqual({mode: "never"});
  });

  it("refuses an unknown AUTH_ACCOUNT_LINKING", () => {
    process.env.AUTH_ACCOUNT_LINKING = "sometimes";
    expect(() => buildBetterAuthConfig()).toThrow(/AUTH_ACCOUNT_LINKING/);
  });

  it("closes sign-up with AUTH_SIGN_UP=closed", async () => {
    process.env.AUTH_SIGN_UP = "closed";
    const config = requireConfig();
    expect(config.signUp).toEqual({mode: "closed"});
    expect((await methodsFor(config)).signUp).toBe(false);
  });

  it("refuses an unknown AUTH_SIGN_UP", () => {
    process.env.AUTH_SIGN_UP = "invite-only";
    expect(() => buildBetterAuthConfig()).toThrow(/AUTH_SIGN_UP/);
  });

  it("binds passkeys to the FRONTEND_URL host and its origin", () => {
    process.env.FRONTEND_URL = "https://app.example.com/";
    expect(requireConfig().passkey).toEqual({
      origin: ["https://app.example.com"],
      rpID: "app.example.com",
      rpName: "Terreno Example",
    });
  });

  it("keeps only the dev origin that shares the loopback rpID", () => {
    process.env.FRONTEND_URL = "http://127.0.0.1:8082";
    expect(requireConfig().passkey?.origin).toEqual(["http://127.0.0.1:8082"]);
    expect(requireConfig().passkey?.rpID).toBe("127.0.0.1");
  });

  it("overrides the rpID with PASSKEY_RP_ID and adds the CORS origins on it", () => {
    process.env.FRONTEND_URL = "https://app.example.com";
    process.env.PASSKEY_RP_ID = "example.com";
    process.env.CORS_ORIGINS = "https://admin.example.com, https://preview.netlify.app";
    expect(requireConfig().passkey).toEqual({
      origin: ["https://app.example.com", "https://admin.example.com"],
      rpID: "example.com",
      rpName: "Terreno Example",
    });
  });

  it("refuses a PASSKEY_RP_ID that FRONTEND_URL is not on", () => {
    process.env.FRONTEND_URL = "https://app.example.com";
    process.env.PASSKEY_RP_ID = "other.com";
    expect(() => buildBetterAuthConfig()).toThrow(/PASSKEY_RP_ID/);
  });

  it("refuses a FRONTEND_URL that is not an http(s) URL", () => {
    process.env.FRONTEND_URL = "not a url";
    expect(() => buildBetterAuthConfig()).toThrow(/FRONTEND_URL/);
  });
});

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
    expect(config?.plugins?.map((plugin) => plugin.id)).toEqual([
      "generic-oauth",
      "mock-oidc-native-proxy",
    ]);
  });

  it("refuses to start with MOCK_OIDC_ISSUER in production", () => {
    process.env.NODE_ENV = "production";
    process.env.MOCK_OIDC_ISSUER = "http://127.0.0.1:4555";
    expect(() => buildBetterAuthConfig()).toThrow(/MOCK_OIDC_ISSUER must not be set in production/);
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

// A native app (Better Auth's Expo plugin) opens every provider through the server's
// `/expo-authorization-proxy`, which takes only https authorization URLs. The mock provider is
// plain http on this machine, so the example lets that one origin through.
describe("native sign-in with the mock OIDC provider", () => {
  const NATIVE_CALLBACK = "frontend:///login";

  beforeEach(() => {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_OAUTH_HANDOFF");
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, "MOCK_OIDC_ISSUER");
  });

  // Starts a sign-in the way the Expo client does, and returns the provider URL it must open.
  const startNativeSignIn = async (app: express.Express): Promise<string> => {
    const start = await supertest(app)
      .post("/api/auth/sign-in/social")
      .set("expo-origin", "frontend://")
      .send({callbackURL: NATIVE_CALLBACK, provider: MOCK_OIDC_PROVIDER_ID});
    expect(start.status).toBe(200);
    return start.body.url as string;
  };

  const appFor = (issuer: string): express.Express => {
    process.env.MOCK_OIDC_ISSUER = issuer;
    const app = express();
    new BetterAuthApp({
      config: requireConfig(),
      userModel: User as unknown as TerrenoAuthUserModel,
    }).register(app);
    return app;
  };

  it("sends the browser on to the mock provider with the state cookie set", async () => {
    const discovery = await startDiscoveryServer();
    try {
      const app = appFor(discovery.issuer);
      const authorizationURL = await startNativeSignIn(app);
      expect(authorizationURL.startsWith(`${discovery.issuer}/authorize?`)).toBe(true);

      const proxied = await supertest(app)
        .get("/api/auth/expo-authorization-proxy")
        .query({authorizationURL});
      expect(proxied.status).toBe(302);
      expect(proxied.headers.location).toBe(authorizationURL);
      const cookies = ([] as string[]).concat(proxied.headers["set-cookie"] ?? []);
      expect(cookies.some((cookie) => cookie.startsWith("better-auth.state="))).toBe(true);
    } finally {
      await discovery.close();
    }
  });

  it("refuses a mock-provider URL without state and look-alike or non-http URLs", async () => {
    const discovery = await startDiscoveryServer();
    try {
      const app = appFor(discovery.issuer);
      const issuer = new URL(discovery.issuer);
      const refused = [
        `${discovery.issuer}/authorize?client_id=x`,
        `http://${issuer.hostname}.evil.com:${issuer.port}/authorize?state=abc`,
        `http://${issuer.host}@evil.com/authorize?state=abc`,
        "javascript:alert(1)//?state=abc",
        "data:text/html,<script>alert(1)</script>?state=abc",
      ];
      for (const authorizationURL of refused) {
        const proxied = await supertest(app)
          .get("/api/auth/expo-authorization-proxy")
          .query({authorizationURL});
        expect(proxied.status, authorizationURL).toBe(400);
        expect(proxied.headers.location, authorizationURL).toBeUndefined();
      }
    } finally {
      await discovery.close();
    }
  });

  it("still refuses any other http authorization URL", async () => {
    const discovery = await startDiscoveryServer();
    try {
      const app = appFor(discovery.issuer);
      const proxied = await supertest(app)
        .get("/api/auth/expo-authorization-proxy")
        .query({authorizationURL: "http://127.0.0.1:1/authorize?state=abc"});
      expect(proxied.status).toBe(400);
    } finally {
      await discovery.close();
    }
  });
});

const AUTH_ENV_SCRIPT = join(import.meta.dir, "../../../scripts/ci/backend-auth-env.sh");

// The variables scripts/ci/backend-auth-env.sh prints for one deploy, as the deploy would set them.
const deployAuthEnv = (
  tag: string,
  stable: Record<string, string> = {}
): Record<string, string> => {
  const result = spawnSync("bash", [AUTH_ENV_SCRIPT, "env", tag], {
    encoding: "utf8",
    env: {PATH: process.env.PATH ?? "", ...stable},
  });
  if (result.status !== 0) {
    throw new Error(`backend-auth-env.sh failed: ${result.stderr}`);
  }
  const env: Record<string, string> = {};
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    const at = line.indexOf("=");
    env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
};

const DEPLOY_ENV_KEYS = [
  "BETTER_AUTH_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "CORS_ORIGINS",
  "FRONTEND_URL",
  "NODE_ENV",
  "OAUTH_PROXY_PRODUCTION_URL",
  "PASSKEY_RP_ID",
];

describe("buildBetterAuthConfig on the deploys", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of DEPLOY_ENV_KEYS) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    for (const key of DEPLOY_ENV_KEYS) {
      if (saved[key] === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  // Applies one deploy's env, as Cloud Run would, and builds the config it starts with.
  const configForDeploy = (tag: string, stable: Record<string, string> = {}): BetterAuthConfig => {
    Object.assign(process.env, deployAuthEnv(tag, stable), {NODE_ENV: "production"});
    return requireConfig();
  };

  it("leaves oauthProxy off without OAUTH_PROXY_PRODUCTION_URL", () => {
    expect(requireConfig().oauthProxy).toBeUndefined();
  });

  it("proxies a preview's OAuth through the stable backend", async () => {
    const config = configForDeploy("pr-42");
    expect(config.oauthProxy).toEqual({
      productionURL: "https://terreno-backend-example-7knxlrnpqq-uc.a.run.app",
    });
    expect(config.baseURL).toBe("https://pr-42---terreno-backend-example-7knxlrnpqq-uc.a.run.app");
    // netlify.app is a public suffix, so a preview's passkeys stay on its own host.
    expect(config.passkey?.rpID).toBe("pr-42--terreno-frontend.netlify.app");
    expect((await methodsFor(config)).passkey).toBe(true);
  });

  it("runs oauthProxy on stable naming itself, so it forwards preview returns", () => {
    const config = configForDeploy("prod");
    expect(config.baseURL).toBe("https://terreno-backend-example-7knxlrnpqq-uc.a.run.app");
    expect(config.oauthProxy?.productionURL).toBe(config.baseURL);
    // Before the move, stable's passkeys bind to the netlify.app host.
    expect(config.passkey?.rpID).toBe("terreno-frontend.netlify.app");
  });

  it("binds stable passkeys to the shared parent domain once both sites move", () => {
    const config = configForDeploy("prod", {
      STABLE_BACKEND_URL: "https://api.example.com",
      STABLE_FRONTEND_URL: "https://app.example.com",
    });
    expect(config.passkey?.rpID).toBe("example.com");
    expect(config.passkey?.origin).toEqual(["https://app.example.com"]);
    expect(config.oauthProxy?.productionURL).toBe("https://api.example.com");
    // Same-site subdomains work with host-only cookies; the session never spans the domain.
    const advanced = config.options?.advanced as {crossSubDomainCookies?: unknown} | undefined;
    expect(advanced?.crossSubDomainCookies).toBeUndefined();
    // The old Netlify host stays trusted during the move.
    expect(config.trustedOrigins).toContain("https://app.example.com");
    expect(config.trustedOrigins).toContain("https://terreno-frontend.netlify.app");
  });

  it("configures providers on a preview from client IDs alone", async () => {
    // A preview mounts only *_CLIENT_ID; stable exchanges each code with the real secret.
    Object.assign(process.env, {
      APPLE_CLIENT_ID: "com.example.web",
      GITHUB_CLIENT_ID: "github-id",
      GOOGLE_CLIENT_ID: "google-id",
    });
    const config = configForDeploy("pr-42");
    expect(config.googleOAuth).toEqual({
      clientId: "google-id",
      clientSecret: OAUTH_PROXY_PREVIEW_CLIENT_SECRET,
    });
    expect(config.githubOAuth?.clientSecret).toBe(OAUTH_PROXY_PREVIEW_CLIENT_SECRET);
    expect(config.appleOAuth).toEqual({
      clientId: "com.example.web",
      clientSecret: OAUTH_PROXY_PREVIEW_CLIENT_SECRET,
    });
    expect((await methodsFor(config)).providers).toEqual(["apple", "github", "google"]);
  });

  it("leaves providers off on stable without their real secrets", () => {
    Object.assign(process.env, {APPLE_CLIENT_ID: "com.example.web", GOOGLE_CLIENT_ID: "google-id"});
    const config = configForDeploy("prod");
    expect(config.googleOAuth).toBeUndefined();
    expect(config.appleOAuth).toBeUndefined();
  });

  it("refuses an OAUTH_PROXY_PRODUCTION_URL that is not an http(s) URL", () => {
    process.env.OAUTH_PROXY_PRODUCTION_URL = "ftp://stable.example.com";
    expect(() => buildBetterAuthConfig()).toThrow(/OAUTH_PROXY_PRODUCTION_URL/);
    process.env.OAUTH_PROXY_PRODUCTION_URL = "not a url";
    expect(() => buildBetterAuthConfig()).toThrow(/OAUTH_PROXY_PRODUCTION_URL/);
  });
});

describe("buildBetterAuthConfig Sign in with Apple", () => {
  const privateKey = generateKeyPairSync("ec", {namedCurve: "P-256"})
    .privateKey.export({format: "pem", type: "pkcs8"})
    .toString();

  it("uses the key form when the team ID, key ID and private key are set", async () => {
    process.env.APPLE_CLIENT_ID = "com.example.web";
    process.env.APPLE_TEAM_ID = "TEAM123456";
    process.env.APPLE_KEY_ID = "KEY1234567";
    // Secret Manager may hand back the PEM with escaped newlines.
    process.env.APPLE_PRIVATE_KEY = privateKey.replace(/\n/g, "\\n");
    process.env.APPLE_CLIENT_SECRET = "ignored-when-the-key-is-set";
    const config = requireConfig();
    expect(config.appleOAuth).toEqual({
      clientId: "com.example.web",
      keyId: "KEY1234567",
      privateKey: process.env.APPLE_PRIVATE_KEY,
      teamId: "TEAM123456",
    });
    expect(config.trustedOrigins).toContain(APPLE_SIGN_IN_ORIGIN);
    expect((await methodsFor(config)).providers).toContain("apple");
  });

  it("keeps the pre-made client secret form working", () => {
    process.env.APPLE_CLIENT_ID = "com.example.web";
    process.env.APPLE_CLIENT_SECRET = "pre-made-jwt";
    expect(requireConfig().appleOAuth).toEqual({
      clientId: "com.example.web",
      clientSecret: "pre-made-jwt",
    });
  });

  it("leaves Apple off without a secret or a complete key", () => {
    process.env.APPLE_CLIENT_ID = "com.example.web";
    process.env.APPLE_TEAM_ID = "TEAM123456";
    const config = requireConfig();
    expect(config.appleOAuth).toBeUndefined();
    expect(config.trustedOrigins).not.toContain(APPLE_SIGN_IN_ORIGIN);
  });
});
