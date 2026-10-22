import {afterAll, describe, expect, it} from "bun:test";
import {createHmac, createVerify, generateKeyPairSync, randomUUID} from "node:crypto";
import type {BetterAuthPlugin} from "better-auth";
import {genericOAuth, twoFactor} from "better-auth/plugins";
import express from "express";
import {DateTime} from "luxon";
import mongoose, {Schema} from "mongoose";
import supertest from "supertest";
import type {UserModel} from "./auth";
import type {BetterAuthConfig} from "./betterAuth";
import {createAppleClientSecret, resolveAppleProvider} from "./betterAuthFeatures";
import {
  type BetterAuthInstance,
  createBetterAuth,
  createBetterAuthSessionMiddleware,
  getMongoClientFromMongoose,
  mountBetterAuthRoutes,
} from "./betterAuthSetup";
import {type APIError, isAPIError} from "./errors";

const API_ORIGIN = "http://localhost:3000";
const SECRET = "test-secret-at-least-32-characters-long";
const PASSWORD = "password-123456";
const STUB_PROVIDER = "stub-oidc";

interface FeatureApp {
  app: express.Application;
  auth: BetterAuthInstance;
}

const buildApp = (overrides: Partial<BetterAuthConfig> = {}): FeatureApp => {
  const config: BetterAuthConfig = {
    baseURL: API_ORIGIN,
    enabled: true,
    secret: SECRET,
    ...overrides,
  };
  const auth = createBetterAuth({config, mongoClient: getMongoClientFromMongoose()});
  const app = express();
  mountBetterAuthRoutes(app, auth, config.basePath);
  return {app, auth};
};

const pluginIds = (auth: BetterAuthInstance): string[] =>
  (auth.options.plugins ?? []).map((plugin) => plugin.id);

const uniqueEmail = (label: string): string => `${label}-${randomUUID()}@example.com`;

const newStubIdentity = (label: string): StubIdentity => ({
  email: uniqueEmail(label),
  id: randomUUID(),
});

// Better Auth's user collection on the default connection.
const betterAuthUsers = (): ReturnType<mongoose.mongo.Db["collection"]> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("The test database is not connected");
  }
  return db.collection("user");
};

interface StubIdentity {
  email: string;
  id: string;
}

// A generic OAuth provider that answers the token exchange and userinfo in-process with
// `identity`, so the full sign-in and callback flow runs without a network provider.
const stubOidcPlugin = (identity: StubIdentity): BetterAuthPlugin =>
  genericOAuth({
    config: [
      {
        authorizationUrl: "https://stub.example.com/authorize",
        clientId: "stub-client",
        clientSecret: "stub-secret",
        getToken: async () => ({accessToken: "stub-access-token", tokenType: "Bearer"}),
        getUserInfo: async () => ({
          email: identity.email,
          emailVerified: true,
          id: identity.id,
          name: "Stub User",
        }),
        providerId: STUB_PROVIDER,
        tokenUrl: "https://stub.example.com/token",
      },
    ],
  }) as unknown as BetterAuthPlugin;

const setCookies = (res: supertest.Response): string[] =>
  (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];

const cookieHeaderFrom = (res: supertest.Response): string =>
  setCookies(res)
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32Decode = (value: string): Buffer => {
  let bits = "";
  for (const char of value.replace(/=+$/, "").toUpperCase()) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
};

// The current RFC 6238 code (SHA-1, 6 digits, 30-second steps) an authenticator app would show.
const totpCode = (secret: Buffer): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(DateTime.now().toSeconds() / 30)));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
};

interface TwoFactorEnrollment {
  backupCodes: string[];
  totpURI: string;
}

// Signs up, enables two-factor, and confirms it with a TOTP code, as the Security screen does.
const enrollTwoFactor = async (
  app: express.Application,
  email: string
): Promise<{enrollment: TwoFactorEnrollment; secret: Buffer}> => {
  const signUp = await supertest(app)
    .post("/api/auth/sign-up/email")
    .set("content-type", "application/json")
    .send({email, name: "Two Factor", password: PASSWORD});
  expect(signUp.status).toBe(200);
  const bearer = `Bearer ${signUp.body.token}`;
  const enable = await supertest(app)
    .post("/api/auth/two-factor/enable")
    .set("authorization", bearer)
    .set("content-type", "application/json")
    .send({password: PASSWORD});
  expect(enable.status).toBe(200);
  const enrollment = enable.body as TwoFactorEnrollment;
  const secret = base32Decode(new URL(enrollment.totpURI).searchParams.get("secret") ?? "");
  const confirm = await supertest(app)
    .post("/api/auth/two-factor/verify-totp")
    .set("authorization", bearer)
    .set("content-type", "application/json")
    .send({code: totpCode(secret)});
  expect(confirm.status).toBe(200);
  return {enrollment, secret};
};

// Starts a sign-in with the stub provider and completes its callback, returning the redirect.
const signInWithStub = async (
  app: express.Application,
  extra: {requestSignUp?: boolean} = {}
): Promise<URL> => {
  const start = await supertest(app)
    .post("/api/auth/sign-in/social")
    .set("content-type", "application/json")
    .send({callbackURL: `${API_ORIGIN}/done`, provider: STUB_PROVIDER, ...extra});
  expect(start.status).toBe(200);
  const state = new URL(start.body.url).searchParams.get("state");
  const callback = await supertest(app)
    .get(`/api/auth/callback/${STUB_PROVIDER}?code=stub-code&state=${state}`)
    .set("cookie", cookieHeaderFrom(start));
  expect(callback.status).toBe(302);
  return new URL(callback.headers.location, API_ORIGIN);
};

describe("buildFeaturePlugins", () => {
  it("each feature mounts only when configured", async () => {
    const features: {
      config: Partial<BetterAuthConfig>;
      method: "get" | "post";
      path: string;
    }[] = [
      {
        config: {twoFactor: {issuer: "Terreno"}},
        method: "post",
        path: "/api/auth/two-factor/enable",
      },
      {
        config: {passkey: {origin: [API_ORIGIN], rpID: "localhost", rpName: "Terreno"}},
        method: "get",
        path: "/api/auth/passkey/generate-register-options",
      },
      {
        config: {multiSession: {maximumSessions: 3}},
        method: "get",
        path: "/api/auth/multi-session/list-device-sessions",
      },
      {config: {nativeApps: true}, method: "get", path: "/api/auth/expo-authorization-proxy"},
      {
        config: {oauthProxy: {productionURL: "https://api.example.com"}},
        method: "get",
        path: "/api/auth/oauth-proxy-callback",
      },
    ];
    const absent = buildApp().app;
    for (const feature of features) {
      const enabled = buildApp(feature.config).app;
      const on = await supertest(enabled)[feature.method](feature.path).send({});
      const off = await supertest(absent)[feature.method](feature.path).send({});
      expect({on: on.status !== 404, path: feature.path}).toEqual({on: true, path: feature.path});
      expect({off: off.status, path: feature.path}).toEqual({off: 404, path: feature.path});
    }
  });

  it("adds no plugins when no feature is configured", () => {
    expect(pluginIds(buildApp().auth)).toEqual(["bearer", "terreno-methods"]);
  });

  it("puts feature plugins before config.plugins", () => {
    const consumer = {id: "consumer-plugin"} satisfies BetterAuthPlugin;
    const {auth} = buildApp({
      lastLoginMethod: true,
      multiSession: {},
      nativeApps: true,
      oauthProxy: {productionURL: "https://api.example.com"},
      passkey: {origin: [API_ORIGIN], rpID: "localhost", rpName: "Terreno"},
      plugins: [consumer],
      twoFactor: {issuer: "Terreno"},
    });
    expect(pluginIds(auth)).toEqual([
      "bearer",
      "terreno-methods",
      "two-factor",
      "passkey",
      "last-login-method",
      "multi-session",
      "oauth-proxy",
      "expo",
      "consumer-plugin",
    ]);
  });

  it("enrolls two-factor with the configured issuer and backup codes", async () => {
    const {app} = buildApp({
      twoFactor: {backupCodes: {amount: 6, length: 8}, issuer: "Terreno Test"},
    });
    const {enrollment} = await enrollTwoFactor(app, uniqueEmail("two-factor-enroll"));
    const uri = new URL(enrollment.totpURI);
    expect(uri.searchParams.get("issuer")).toBe("Terreno Test");
    expect(enrollment.backupCodes).toHaveLength(6);
    for (const code of enrollment.backupCodes) {
      expect(code.replace(/-/g, "")).toHaveLength(8);
    }
  });

  it("trusts a device for trustDeviceDays, and 30 days by default", async () => {
    for (const {days, expected} of [
      {days: 7, expected: 7},
      {days: undefined, expected: 30},
    ]) {
      const {app} = buildApp({twoFactor: {issuer: "Terreno", trustDeviceDays: days}});
      const email = uniqueEmail("two-factor-trust");
      const {secret} = await enrollTwoFactor(app, email);
      const signIn = await supertest(app)
        .post("/api/auth/sign-in/email")
        .set("content-type", "application/json")
        .send({email, password: PASSWORD});
      expect(signIn.body.twoFactorRedirect).toBe(true);
      const verify = await supertest(app)
        .post("/api/auth/two-factor/verify-totp")
        .set("content-type", "application/json")
        .set("cookie", cookieHeaderFrom(signIn))
        .send({code: totpCode(secret), trustDevice: true});
      expect(verify.status).toBe(200);
      const trustCookie = setCookies(verify).find((cookie) => cookie.includes("trust_device="));
      expect(trustCookie).toContain(`Max-Age=${expected * 24 * 60 * 60}`);
    }
  });

  it("stores the last login method on the Better Auth user", async () => {
    const {app} = buildApp({lastLoginMethod: true});
    const email = uniqueEmail("last-login");
    const res = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({email, name: "Last Login", password: PASSWORD});
    expect(res.status).toBe(200);
    const stored = await betterAuthUsers().findOne({email});
    expect(stored?.lastLoginMethod).toBe("email");
  });
});

describe("passkey config validation", () => {
  const passkey = {origin: ["https://app.example.com"], rpID: "example.com", rpName: "Example"};

  const refusal = (origin: string[], rpID = passkey.rpID): unknown => {
    try {
      buildApp({passkey: {...passkey, origin, rpID}});
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it("accepts origins on the rpID and its subdomains", () => {
    expect(refusal(["https://example.com", "https://app.example.com"])).toBeUndefined();
    expect(refusal(["http://localhost:8082"], "localhost")).toBeUndefined();
  });

  it("refuses each invalid origin list", () => {
    const cases: {detail: string; origin: string[]}[] = [
      {detail: "must list at least one origin", origin: []},
      {detail: "is not an absolute URL", origin: ["app.example.com"]},
      {detail: "must be a bare http(s) origin", origin: ["https://app.example.com/"]},
      {detail: "must be a bare http(s) origin", origin: ["https://app.example.com/login"]},
      {detail: "must be a bare http(s) origin", origin: ["ftp://app.example.com"]},
      {detail: "is not on passkey.rpID", origin: ["https://example.org"]},
      {detail: "is not on passkey.rpID", origin: ["https://notexample.com"]},
      {
        detail: "is not on passkey.rpID",
        origin: ["https://app.example.com", "http://localhost:8082"],
      },
    ];
    for (const {detail, origin} of cases) {
      const error = refusal(origin);
      expect(isAPIError(error)).toBe(true);
      expect({message: (error as APIError).message, origin}).toEqual({
        message: "passkey config is invalid",
        origin,
      });
      expect((error as APIError).detail).toContain(detail);
    }
  });
});

describe("GET {basePath}/terreno/methods with features", () => {
  it("reports the enabled features", async () => {
    const {app} = buildApp({
      multiSession: {maximumSessions: 2},
      passkey: {origin: [API_ORIGIN], rpID: "localhost", rpName: "Terreno"},
      twoFactor: {issuer: "Terreno"},
    });
    const res = await supertest(app).get("/api/auth/terreno/methods");
    expect(res.body).toMatchObject({multiSession: true, passkey: true, twoFactor: true});
  });

  it("reports a twoFactor plugin added through config.plugins", async () => {
    const {app} = buildApp({plugins: [twoFactor({issuer: "Consumer"})]});
    const res = await supertest(app).get("/api/auth/terreno/methods");
    expect(res.body.twoFactor).toBe(true);
  });

  it("reports the configured account linking mode", async () => {
    for (const mode of ["verified-email", "explicit", "never"] as const) {
      const {app, auth} = buildApp({accountLinking: {mode}});
      const res = await supertest(app).get("/api/auth/terreno/methods");
      expect(res.body.accountLinking).toEqual({mode});
      expect(auth.options.account?.accountLinking?.requireLocalEmailVerified).toBe(true);
    }
  });

  it("lets config.options override the linking mode", async () => {
    const {app} = buildApp({
      accountLinking: {mode: "never"},
      options: {account: {accountLinking: {enabled: true}}},
    });
    const res = await supertest(app).get("/api/auth/terreno/methods");
    expect(res.body.accountLinking).toEqual({mode: "verified-email"});
  });
});

describe("signUp: closed", () => {
  it("refuses email sign-up", async () => {
    const {app} = buildApp({signUp: {mode: "closed"}});
    const email = uniqueEmail("closed-email");
    const res = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({email, name: "Closed", password: PASSWORD});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
    expect(await betterAuthUsers().countDocuments({email})).toBe(0);
  });

  it("refuses a social sign-in for an unknown email with signup_disabled", async () => {
    for (const requestSignUp of [undefined, true]) {
      const identity = newStubIdentity("closed-oauth");
      const {app} = buildApp({plugins: [stubOidcPlugin(identity)], signUp: {mode: "closed"}});
      const redirect = await signInWithStub(app, {requestSignUp});
      expect({error: redirect.searchParams.get("error"), requestSignUp}).toEqual({
        error: "signup_disabled",
        requestSignUp,
      });
      expect(await betterAuthUsers().countDocuments({email: identity.email})).toBe(0);
    }
  });

  it("refuses an ID-token sign-in for an unknown email even with requestSignUp", async () => {
    const email = uniqueEmail("closed-id-token");
    const {app} = buildApp({
      googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
      options: {
        socialProviders: {
          google: {
            getUserInfo: async () => ({
              data: {sub: "google-sub"},
              user: {email, emailVerified: true, id: "google-sub", name: "Google User"},
            }),
            verifyIdToken: async () => true,
          },
        },
      },
      signUp: {mode: "closed"},
    });
    const res = await supertest(app)
      .post("/api/auth/sign-in/social")
      .set("content-type", "application/json")
      .send({idToken: {token: "stub-id-token"}, provider: "google", requestSignUp: true});
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("signup disabled");
    expect(await betterAuthUsers().countDocuments({email})).toBe(0);
  });

  it("still signs in existing users", async () => {
    const email = uniqueEmail("closed-existing");
    const identity = newStubIdentity("closed-existing-oauth");
    const open = buildApp({plugins: [stubOidcPlugin(identity)]});
    const signUp = await supertest(open.app)
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({email, name: "Existing", password: PASSWORD});
    expect(signUp.status).toBe(200);
    const firstOAuth = await signInWithStub(open.app);
    expect(firstOAuth.searchParams.get("error")).toBeNull();

    const closed = buildApp({plugins: [stubOidcPlugin(identity)], signUp: {mode: "closed"}});
    const signIn = await supertest(closed.app)
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({email, password: PASSWORD});
    expect(signIn.status).toBe(200);
    const oauth = await signInWithStub(closed.app);
    expect(oauth.searchParams.get("error")).toBeNull();
    expect(oauth.pathname).toBe("/done");
  });

  it("reports sign-up off on the methods endpoint", async () => {
    const {app} = buildApp({signUp: {mode: "closed"}});
    const res = await supertest(app).get("/api/auth/terreno/methods");
    expect(res.body.emailPassword).toBe(true);
    expect(res.body.signUp).toBe(false);
  });

  it("leaves sign-up open by default and for mode open", async () => {
    for (const signUp of [undefined, {mode: "open" as const}]) {
      const {app, auth} = buildApp({signUp});
      const res = await supertest(app).get("/api/auth/terreno/methods");
      expect(res.body.signUp).toBe(true);
      expect(pluginIds(auth)).toEqual(["bearer", "terreno-methods"]);
    }
  });
});

describe("appleOAuth with a Sign in with Apple key", () => {
  const {privateKey, publicKey} = generateKeyPairSync("ec", {namedCurve: "P-256"});
  const pem = privateKey.export({format: "pem", type: "pkcs8"}).toString();
  const key = {clientId: "com.example.web", keyId: "KEY123", privateKey: pem, teamId: "TEAM123"};

  const decode = (part: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

  it("signs an ES256 client secret Apple accepts", () => {
    const secret = createAppleClientSecret(key);
    const [header, payload, signature] = secret.split(".");
    expect(decode(header)).toEqual({alg: "ES256", kid: "KEY123"});
    const claims = decode(payload) as {aud: string; exp: number; iat: number; iss: string};
    expect(claims).toMatchObject({aud: "https://appleid.apple.com", iss: "TEAM123"});
    expect(decode(payload).sub).toBe("com.example.web");
    expect(Math.abs(claims.iat - DateTime.now().toSeconds())).toBeLessThan(60);
    expect(claims.exp - claims.iat).toBe(180 * 24 * 60 * 60);
    const isValid = createVerify("SHA256")
      .update(`${header}.${payload}`)
      .verify({dsaEncoding: "ieee-p1363", key: publicKey}, Buffer.from(signature, "base64url"));
    expect(isValid).toBe(true);
  });

  it("accepts a key whose newlines arrive escaped", () => {
    const secret = createAppleClientSecret({...key, privateKey: pem.replace(/\n/g, "\\n")});
    expect(secret.split(".")).toHaveLength(3);
  });

  it("refuses a key that is not a PEM private key", () => {
    let thrown: unknown;
    try {
      createAppleClientSecret({...key, privateKey: "not-a-key"});
    } catch (error) {
      thrown = error;
    }
    expect(isAPIError(thrown)).toBe(true);
    expect((thrown as Error).message).toBe(
      "appleOAuth.privateKey must be a PEM (PKCS#8) Sign in with Apple key"
    );
  });

  it("configures Better Auth's Apple provider from the key", async () => {
    const {app, auth} = buildApp({appleOAuth: {...key, appBundleIdentifier: "com.example.app"}});
    const apple = auth.options.socialProviders?.apple as {
      appBundleIdentifier?: string;
      clientId: string;
      clientSecret: string;
    };
    expect(apple.clientId).toBe("com.example.web");
    expect(apple.appBundleIdentifier).toBe("com.example.app");
    expect(apple.clientSecret.split(".")).toHaveLength(3);
    const res = await supertest(app).get("/api/auth/terreno/methods");
    expect(res.body.providers).toEqual(["apple"]);
  });

  it("keeps the client secret form as it is", () => {
    expect(resolveAppleProvider({clientId: "web", clientSecret: "premade"})).toEqual({
      clientId: "web",
      clientSecret: "premade",
    });
  });
});

describe("app User sync with feature fields", () => {
  // A consumer User schema that throws on any field it does not declare.
  const StrictFeatureUser = mongoose.model(
    "BetterAuthFeatureStrictUser",
    new Schema(
      {
        admin: {default: false, description: "Admin flag", type: Boolean},
        betterAuthId: {description: "Better Auth user id", type: String},
        email: {description: "Email", required: true, type: String},
        name: {description: "Display name", type: String},
      },
      {strict: "throw"}
    )
  ) as unknown as UserModel;

  afterAll(async () => {
    await (StrictFeatureUser as unknown as mongoose.Model<unknown>).deleteMany({});
  });

  it("syncs a user with two-factor and last-login fields into a strict schema", async () => {
    const {auth} = buildApp({lastLoginMethod: true, twoFactor: {issuer: "Terreno"}});
    const app = express();
    app.use(createBetterAuthSessionMiddleware(auth, StrictFeatureUser));
    mountBetterAuthRoutes(app, auth);
    app.get("/me", (req, res) => {
      res.json({email: (req.user as {email?: string} | undefined)?.email ?? null});
    });
    const email = uniqueEmail("strict-sync");
    const signUp = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({email, name: "Strict Sync", password: PASSWORD});
    expect(signUp.status).toBe(200);
    const stored = await betterAuthUsers().findOne({email});
    expect(stored?.twoFactorEnabled).toBe(false);
    expect(stored?.lastLoginMethod).toBe("email");

    const me = await supertest(app).get("/me").set("authorization", `Bearer ${signUp.body.token}`);
    expect(me.body.email).toBe(email);
  });
});
