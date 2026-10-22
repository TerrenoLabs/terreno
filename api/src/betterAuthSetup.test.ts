import {afterAll, afterEach, describe, expect, it, mock} from "bun:test";
import type {BetterAuthPlugin} from "better-auth";
import {assert} from "chai";
import express, {type Request, type Response} from "express";
import {DateTime} from "luxon";
import {MongoMemoryServer} from "mongodb-memory-server";
import mongoose, {Schema} from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";
import supertest from "supertest";
import type {UserModel} from "./auth";
import type {BetterAuthConfig, BetterAuthSessionData, BetterAuthUser} from "./betterAuth";
import {
  applyBetterAuthPasswordResetToJwt,
  applyJwtPasswordResetToBetterAuth,
  type BetterAuthInstance,
  createBetterAuth,
  createBetterAuthEmailHooks,
  createBetterAuthSessionMiddleware,
  getBetterAuthSession,
  getMongoClientFromMongoose,
  hasBetterAuthSession,
  type MongoClientLike,
  mountBetterAuthRoutes,
  readPasswordFromBetterAuthResetRequest,
  resolveBetterAuthAppUser,
  setupBetterAuthUserSync,
  syncBetterAuthUser,
} from "./betterAuthSetup";

type SessionRequest = Request & {betterAuthSession?: BetterAuthSessionData};
const makeReq = (overrides: Partial<SessionRequest> = {}): SessionRequest =>
  ({headers: {}, ...overrides}) as SessionRequest;
const makeRes = (): Response => ({}) as Response;
const setGetSession = (auth: BetterAuthInstance, getSession: () => unknown): void => {
  (auth.api as unknown as {getSession: () => unknown}).getSession = getSession;
};

// Use a separate connection to avoid conflict with bunSetup.ts preload
let conn: mongoose.Connection;
let mongod: MongoMemoryServer;
let TestUser: UserModel;
let StrictUser: UserModel;
let DualAuthUser: UserModel;

// Simple user schema for testing
const testUserSchema = new Schema({
  admin: {default: false, type: Boolean},
  betterAuthId: {type: String},
  disabled: {default: false, type: Boolean},
  email: {required: true, type: String},
  name: {type: String},
  oauthProvider: {type: String},
});

const dualAuthUserSchema = new Schema({
  admin: {default: false, type: Boolean},
  betterAuthId: {type: String},
  email: {required: true, type: String},
  name: {type: String},
  tokenEpoch: {default: 0, type: Number},
});
dualAuthUserSchema.plugin(
  passportLocalMongoose as unknown as (schema: Schema, options?: Record<string, unknown>) => void,
  {
    usernameCaseInsensitive: true,
    usernameField: "email",
  }
);

const strictUserSchema = new Schema(
  {
    admin: {default: false, type: Boolean},
    betterAuthId: {type: String},
    email: {required: true, type: String},
    name: {type: String},
  },
  {strict: "throw"}
);

// Start memory server and create connection before tests run
const setup = (async () => {
  mongod = await MongoMemoryServer.create();
  conn = mongoose.createConnection(mongod.getUri());
  await conn.asPromise();
  TestUser = conn.model("BetterAuthTestUser", testUserSchema) as UserModel;
  StrictUser = conn.model("BetterAuthStrictUser", strictUserSchema) as UserModel;
  DualAuthUser = conn.model("BetterAuthDualUser", dualAuthUserSchema) as UserModel;
})();

// Helper to get the mongo client from our separate connection
const getClient = (): MongoClientLike => conn.getClient();

afterAll(async () => {
  await conn?.close();
  await mongod?.stop();
});

afterEach(async () => {
  await setup;
  await TestUser.deleteMany({});
  await StrictUser.deleteMany({});
  await DualAuthUser.deleteMany({});
});

describe("createBetterAuth", () => {
  it("throws if secret is not provided", async () => {
    await setup;
    const originalSecret = process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_SECRET;

    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
    };

    expect(() => createBetterAuth({config, mongoClient: getClient()})).toThrow(
      "BETTER_AUTH_SECRET must be set"
    );

    process.env.BETTER_AUTH_SECRET = originalSecret;
  });

  it("throws if baseURL is not provided", async () => {
    await setup;
    const originalUrl = process.env.BETTER_AUTH_URL;
    delete process.env.BETTER_AUTH_URL;

    const config: BetterAuthConfig = {
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    expect(() => createBetterAuth({config, mongoClient: getClient()})).toThrow(
      "BETTER_AUTH_URL must be set"
    );

    process.env.BETTER_AUTH_URL = originalUrl;
  });

  it("creates a Better Auth instance with valid config", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});

    expect(auth).toBeDefined();
    expect(auth.api).toBeDefined();
  });

  it("does not 429 a burst of email sign-ups when disableRateLimit is set", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      disableRateLimit: true,
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };
    const auth = createBetterAuth({config, mongoClient: getClient()});

    for (let index = 0; index < 6; index += 1) {
      const response = await auth.handler(
        new globalThis.Request("https://localhost:3000/api/auth/sign-up/email", {
          body: JSON.stringify({
            email: `seed-burst-${index}@example.com`,
            name: `Seed Burst ${index}`,
            password: "testpassword123",
          }),
          headers: {"Content-Type": "application/json"},
          method: "POST",
        })
      );
      assert.notEqual(response.status, 429, `sign-up ${index} was rate-limited`);
      assert.isTrue(response.ok, `sign-up ${index} failed: ${response.status}`);
    }
  });

  it("sets cross-site session cookies when crossDomainCookies is enabled", async () => {
    await setup;
    const origin = "https://frontend.example.com";
    const config: BetterAuthConfig = {
      baseURL: "https://api.example.com",
      crossDomainCookies: true,
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
      trustedOrigins: [origin],
    };
    const auth = createBetterAuth({config, mongoClient: getClient()});

    const response = await auth.handler(
      new globalThis.Request("https://api.example.com/api/auth/sign-up/email", {
        body: JSON.stringify({
          email: "cross-domain-cookie@example.com",
          name: "Cross Domain",
          password: "testpassword123",
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
        },
        method: "POST",
      })
    );
    const setCookie = response.headers.get("set-cookie") ?? "";

    assert.isTrue(response.ok);
    assert.include(setCookie.toLowerCase(), "samesite=none");
    assert.include(setCookie.toLowerCase(), "secure");
  });

  it("creates instance with social providers", async () => {
    await setup;
    const config: BetterAuthConfig = {
      appleOAuth: {clientId: "apple-id", clientSecret: "apple-secret"},
      baseURL: "http://localhost:3000",
      enabled: true,
      githubOAuth: {clientId: "github-id", clientSecret: "github-secret"},
      googleOAuth: {clientId: "google-id", clientSecret: "google-secret"},
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});

    expect(auth).toBeDefined();
  });

  it("uses env vars as fallback for secret and baseURL", async () => {
    await setup;
    process.env.BETTER_AUTH_SECRET = "env-secret-at-least-32-characters-long";
    process.env.BETTER_AUTH_URL = "http://localhost:4000";

    const config: BetterAuthConfig = {enabled: true};
    const auth = createBetterAuth({config, mongoClient: getClient()});

    expect(auth).toBeDefined();

    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
  });

  it("uses custom basePath when provided", async () => {
    await setup;
    const config: BetterAuthConfig = {
      basePath: "/custom/auth",
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});
    expect(auth).toBeDefined();
  });

  it("revokes Better Auth sessions on password reset", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };
    const auth = createBetterAuth({config, mongoClient: getClient()});
    const options = (
      auth as {
        options?: {emailAndPassword?: {revokeSessionsOnPasswordReset?: boolean}};
      }
    ).options;
    assert.isTrue(options?.emailAndPassword?.revokeSessionsOnPasswordReset);
  });

  it("wires JWT password sync when a user model is provided", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };
    const auth = createBetterAuth({
      config,
      mongoClient: getClient(),
      userModel: DualAuthUser,
    });
    const options = (
      auth as {
        options?: {emailAndPassword?: {onPasswordReset?: unknown}};
      }
    ).options;
    assert.isFunction(options?.emailAndPassword?.onPasswordReset);
  });

  it("sends reset and verification mail through the injected renderer", async () => {
    await setup;
    const renderedCalls: Array<{templateId: string; token: string}> = [];
    const sent: Array<{subject: string; text?: string; to: string}> = [];
    const hooks = createBetterAuthEmailHooks({
      enabled: true,
      publicAppUrl: "https://app.example.com",
      renderAuthMail: ({templateId, token}) => {
        renderedCalls.push({templateId, token});
        return {subject: templateId, text: `link-${token}`};
      },
      sendMail: async (message) => {
        sent.push({subject: message.subject, text: message.text, to: message.to});
      },
    });
    assert.isDefined(hooks);
    await hooks?.sendResetPassword({
      token: "reset-token",
      url: "https://better-auth.example/ignored",
      user: {email: "reset@example.com"},
    });
    await hooks?.sendVerificationEmail({
      token: "verify-token",
      url: "https://better-auth.example/ignored",
      user: {email: "verify@example.com"},
    });
    assert.deepEqual(renderedCalls, [
      {templateId: "resetPassword", token: "reset-token"},
      {templateId: "verifyEmail", token: "verify-token"},
    ]);
    assert.deepEqual(sent, [
      {subject: "resetPassword", text: "link-reset-token", to: "reset@example.com"},
      {subject: "verifyEmail", text: "link-verify-token", to: "verify@example.com"},
    ]);
  });

  it("does not send Better Auth recovery mail when publicAppUrl is missing", async () => {
    await setup;
    const sent: Array<{subject: string; to: string}> = [];
    const hooks = createBetterAuthEmailHooks({
      enabled: true,
      sendMail: async (message) => {
        sent.push({subject: message.subject, to: message.to});
      },
    });
    assert.isDefined(hooks);
    await expect(
      hooks?.sendResetPassword({
        token: "reset-token",
        url: "https://better-auth.example/ignored",
        user: {email: "reset@example.com"},
      })
    ).rejects.toThrow("publicAppUrl is required to send recovery mail");
    await expect(
      hooks?.sendVerificationEmail({
        token: "verify-token",
        url: "https://better-auth.example/ignored",
        user: {email: "verify@example.com"},
      })
    ).rejects.toThrow("publicAppUrl is required to send recovery mail");
    assert.deepEqual(sent, []);
  });
});

describe("applyJwtPasswordResetToBetterAuth", () => {
  it("updates the Better Auth credential hash and drops sessions", async () => {
    await setup;
    const auth = createBetterAuth({
      config: {
        baseURL: "http://localhost:3000",
        enabled: true,
        secret: "test-secret-at-least-32-characters-long",
      },
      mongoClient: getClient(),
    });
    const created = await auth.api.signUpEmail({
      body: {
        email: "dual@example.com",
        name: "Dual User",
        password: "old-password-123",
      },
    });
    const betterAuthId = created.user.id;
    await applyJwtPasswordResetToBetterAuth(
      auth,
      {betterAuthId, email: "dual@example.com"},
      "new-password-123"
    );
    await expect(
      auth.api.signInEmail({
        body: {email: "dual@example.com", password: "old-password-123"},
      })
    ).rejects.toThrow();
    const signedIn = await auth.api.signInEmail({
      body: {email: "dual@example.com", password: "new-password-123"},
    });
    assert.isDefined(signedIn.user);
  });
});

describe("readPasswordFromBetterAuthResetRequest", () => {
  it("reads newPassword from a JSON request body", async () => {
    const request = new globalThis.Request("http://localhost/api/auth/reset-password", {
      body: JSON.stringify({newPassword: "synced-password-123", token: "reset-token"}),
      headers: {"Content-Type": "application/json"},
      method: "POST",
    });
    const password = await readPasswordFromBetterAuthResetRequest(request);
    assert.equal(password, "synced-password-123");
  });
});

describe("applyBetterAuthPasswordResetToJwt", () => {
  it("updates the JWT password and tokenEpoch", async () => {
    await setup;
    const registerable = DualAuthUser as unknown as {
      authenticate: () => (
        email: string,
        password: string
      ) => Promise<{user: unknown; error?: Error}>;
      register: (
        user: {betterAuthId: string; email: string},
        password: string
      ) => Promise<{tokenEpoch?: number}>;
    };
    await registerable.register(
      {betterAuthId: "ba-dual-1", email: "dual-jwt@example.com"},
      "old-password-123"
    );
    const request = new globalThis.Request("http://localhost/api/auth/reset-password", {
      body: JSON.stringify({newPassword: "new-password-123"}),
      headers: {"Content-Type": "application/json"},
      method: "POST",
    });
    await applyBetterAuthPasswordResetToJwt(
      DualAuthUser,
      {email: "dual-jwt@example.com", id: "ba-dual-1"},
      request
    );
    const authenticate = registerable.authenticate();
    const oldPassword = await authenticate("dual-jwt@example.com", "old-password-123");
    assert.isNotOk(oldPassword.user);
    const newPassword = await authenticate("dual-jwt@example.com", "new-password-123");
    assert.isDefined(newPassword.user);
    const reloaded = await DualAuthUser.findOne({email: "dual-jwt@example.com"});
    assert.equal(reloaded?.tokenEpoch, 1);
  });

  it("skips JWT sync when no app user exists", async () => {
    await setup;
    const request = new globalThis.Request("http://localhost/api/auth/reset-password", {
      body: JSON.stringify({newPassword: "new-password-123"}),
      headers: {"Content-Type": "application/json"},
      method: "POST",
    });
    await applyBetterAuthPasswordResetToJwt(
      DualAuthUser,
      {email: "missing-jwt@example.com", id: "ba-missing"},
      request
    );
    const missing = await DualAuthUser.findOne({email: "missing-jwt@example.com"});
    assert.isNull(missing);
  });

  it("throws when the reset request does not carry a password", async () => {
    await setup;
    await DualAuthUser.create({
      betterAuthId: "ba-dual-nopw",
      email: "nopw-jwt@example.com",
    });
    const request = new globalThis.Request("http://localhost/api/auth/reset-password", {
      body: JSON.stringify({token: "reset-token"}),
      headers: {"Content-Type": "application/json"},
      method: "POST",
    });
    await expect(
      applyBetterAuthPasswordResetToJwt(
        DualAuthUser,
        {email: "nopw-jwt@example.com", id: "ba-dual-nopw"},
        request
      )
    ).rejects.toThrow("Password reset could not sync to JWT credentials");
  });
});

describe("readPasswordFromBetterAuthResetRequest edge cases", () => {
  it("returns an empty string when there is no request", async () => {
    assert.equal(await readPasswordFromBetterAuthResetRequest(undefined), "");
  });

  it("reads password from an already-parsed body", async () => {
    assert.equal(
      await readPasswordFromBetterAuthResetRequest({body: {password: "attached-pw"}}),
      "attached-pw"
    );
  });

  it("returns an empty string when the body is not an object and clone is unavailable", async () => {
    assert.equal(await readPasswordFromBetterAuthResetRequest({body: "raw"}), "");
  });

  it("returns an empty string when the body has no string password", async () => {
    assert.equal(await readPasswordFromBetterAuthResetRequest({body: {newPassword: 42}}), "");
  });

  it("returns an empty string when cloning the request fails to parse JSON", async () => {
    const request = {
      clone: () => ({
        json: async (): Promise<unknown> => {
          throw new Error("bad json");
        },
      }),
    };
    assert.equal(await readPasswordFromBetterAuthResetRequest(request), "");
  });
});

describe("createBetterAuthEmailHooks fallback rendering", () => {
  it("renders the built-in templates with interpolated links", async () => {
    const sent: Array<{html?: string; subject: string; text: string; to: string}> = [];
    const hooks = createBetterAuthEmailHooks({
      enabled: true,
      publicAppUrl: "https://app.example.com/",
      sendMail: async (message) => {
        sent.push(message);
      },
    });
    assert.isDefined(hooks);
    await hooks?.sendResetPassword({
      token: "a b",
      url: "ignored",
      user: {email: "reset@example.com"},
    });
    await hooks?.sendVerificationEmail({
      token: "v",
      url: "ignored",
      user: {email: "verify@example.com"},
    });
    assert.lengthOf(sent, 2);
    assert.equal(sent[0].subject, "Reset your password");
    assert.equal(sent[0].to, "reset@example.com");
    assert.include(sent[0].text, "https://app.example.com/resetPassword?token=a%20b");
    assert.include(sent[0].html ?? "", 'href="https://app.example.com/resetPassword?token=a%20b"');
    assert.equal(sent[1].subject, "Verify your email");
    assert.include(sent[1].text, "https://app.example.com/verifyEmail?token=v");
  });

  it("uses custom templates and tolerates missing html/text and unknown keys", async () => {
    const sent: Array<{html?: string; subject: string; text: string; to: string}> = [];
    const hooks = createBetterAuthEmailHooks({
      authMailTemplates: {
        resetPassword: {subject: "Reset for {{ publicAppUrl }} {{unknownKey}}"},
      },
      enabled: true,
      publicAppUrl: "https://app.example.com",
      sendMail: async (message) => {
        sent.push(message);
      },
    });
    await hooks?.sendResetPassword({
      token: "t",
      url: "ignored",
      user: {email: "reset@example.com"},
    });
    assert.lengthOf(sent, 1);
    assert.equal(sent[0].subject, "Reset for https://app.example.com ");
    assert.isUndefined(sent[0].html);
    assert.equal(sent[0].text, "");
  });

  it("returns undefined when sendMail is not configured", () => {
    assert.isUndefined(createBetterAuthEmailHooks({enabled: true}));
  });
});

describe("createBetterAuth email and password-reset wiring", () => {
  const baseConfig: BetterAuthConfig = {
    baseURL: "http://localhost:3000",
    enabled: true,
    secret: "test-secret-at-least-32-characters-long",
  };

  it("enables email verification when mail hooks are configured", async () => {
    await setup;
    const auth = createBetterAuth({
      config: {
        ...baseConfig,
        publicAppUrl: "https://app.example.com",
        sendMail: async () => {},
      },
      mongoClient: getClient(),
    });
    const options = (
      auth as {
        options?: {
          emailAndPassword?: {sendResetPassword?: unknown};
          emailVerification?: {sendOnSignUp?: boolean; sendVerificationEmail?: unknown};
        };
      }
    ).options;
    assert.isTrue(options?.emailVerification?.sendOnSignUp);
    assert.isFunction(options?.emailVerification?.sendVerificationEmail);
    assert.isFunction(options?.emailAndPassword?.sendResetPassword);
  });

  it("syncs the JWT password through the onPasswordReset hook", async () => {
    await setup;
    const auth = createBetterAuth({
      config: baseConfig,
      mongoClient: getClient(),
      userModel: DualAuthUser,
    });
    const registerable = DualAuthUser as unknown as {
      register: (user: {betterAuthId: string; email: string}, password: string) => Promise<unknown>;
    };
    await registerable.register(
      {betterAuthId: "ba-hook-1", email: "hook@example.com"},
      "old-password-123"
    );
    const options = (
      auth as {
        options?: {
          emailAndPassword?: {
            onPasswordReset?: (
              data: {user: {email?: string; id?: string}},
              request?: Request
            ) => Promise<void>;
          };
        };
      }
    ).options;
    const request = new globalThis.Request("http://localhost/api/auth/reset-password", {
      body: JSON.stringify({newPassword: "hooked-password-123"}),
      headers: {"Content-Type": "application/json"},
      method: "POST",
    });
    await options?.emailAndPassword?.onPasswordReset?.(
      {user: {email: "hook@example.com", id: "ba-hook-1"}},
      request as unknown as Request
    );
    const reloaded = await DualAuthUser.findOne({email: "hook@example.com"});
    assert.equal(reloaded?.tokenEpoch, 1);
  });
});

describe("applyJwtPasswordResetToBetterAuth lookups", () => {
  const makeAuth = (): BetterAuthInstance =>
    createBetterAuth({
      config: {
        baseURL: "http://localhost:3000",
        enabled: true,
        secret: "test-secret-at-least-32-characters-long",
      },
      mongoClient: getClient(),
    });

  it("finds the Better Auth user by email when betterAuthId is missing", async () => {
    await setup;
    const auth = makeAuth();
    await auth.api.signUpEmail({
      body: {email: "by-email@example.com", name: "By Email", password: "old-password-123"},
    });
    await applyJwtPasswordResetToBetterAuth(
      auth,
      {email: "by-email@example.com"},
      "new-password-123"
    );
    const signedIn = await auth.api.signInEmail({
      body: {email: "by-email@example.com", password: "new-password-123"},
    });
    assert.isDefined(signedIn.user);
  });

  it("falls back to findUserById and no-ops when the user does not exist", async () => {
    await setup;
    const auth = makeAuth();
    const ctx = (await auth.$context) as {
      internalAdapter: {
        findUserByEmail: (email: string) => Promise<unknown>;
        findUserById: (id: string) => Promise<unknown>;
      };
    };
    const emailCalls: string[] = [];
    const idCalls: string[] = [];
    ctx.internalAdapter.findUserByEmail = async (email: string): Promise<null> => {
      emailCalls.push(email);
      return null;
    };
    ctx.internalAdapter.findUserById = async (id: string): Promise<null> => {
      idCalls.push(id);
      return null;
    };
    await applyJwtPasswordResetToBetterAuth(
      auth,
      {betterAuthId: "", email: "ghost@example.com"},
      "new-password-123"
    );
    assert.deepEqual(emailCalls, ["ghost@example.com"]);
    assert.deepEqual(idCalls, []);
  });

  it("creates a credential account when the user only has a social account", async () => {
    await setup;
    const auth = makeAuth();
    const ctx = (await auth.$context) as {
      internalAdapter: {
        createUser: (user: {email: string; emailVerified: boolean; name: string}) => Promise<{
          id: string;
        }>;
        findAccounts: (userId: string) => Promise<Array<{providerId?: string}>>;
      };
    };
    const created = await ctx.internalAdapter.createUser({
      email: "social@example.com",
      emailVerified: true,
      name: "Social",
    });
    await applyJwtPasswordResetToBetterAuth(auth, {betterAuthId: created.id}, "new-password-123");
    const accounts = await ctx.internalAdapter.findAccounts(created.id);
    assert.isTrue(accounts.some((account) => account.providerId === "credential"));
    const signedIn = await auth.api.signInEmail({
      body: {email: "social@example.com", password: "new-password-123"},
    });
    assert.isDefined(signedIn.user);
  });
});

describe("syncBetterAuthUser", () => {
  const makeBetterAuthUser = (overrides: Partial<BetterAuthUser> = {}): BetterAuthUser => ({
    createdAt: new Date(),
    email: "test@example.com",
    emailVerified: true,
    id: "ba-user-123",
    image: null,
    name: "Test User",
    updatedAt: new Date(),
    ...overrides,
  });

  it("creates a new user when none exists", async () => {
    await setup;
    const baUser = makeBetterAuthUser();
    const result = await syncBetterAuthUser(TestUser, baUser);

    expect(result).toBeDefined();
    expect(result.email).toBe("test@example.com");
    expect(result.name).toBe("Test User");
    expect(result.betterAuthId).toBe("ba-user-123");
    expect(result.admin).toBe(false);
  });

  it("creates a user on a strict-throw schema that omits oauthProvider", async () => {
    await setup;
    const baUser = makeBetterAuthUser({email: "strict@example.com"});
    const result = await syncBetterAuthUser(StrictUser, baUser);

    assert.equal(result.email, "strict@example.com");
    assert.equal(result.betterAuthId, "ba-user-123");
    const saved = await StrictUser.findOne({email: "strict@example.com"}).lean();
    assert.isOk(saved);
    assert.notProperty(saved, "oauthProvider");
  });

  it("sets oauthProvider on create when a provider is passed", async () => {
    await setup;
    const baUser = makeBetterAuthUser({email: "oauth-create@example.com"});
    const result = await syncBetterAuthUser(TestUser, baUser, "google");

    assert.equal(result.oauthProvider, "google");
    const saved = await TestUser.findOne({email: "oauth-create@example.com"}).lean();
    assert.equal(saved.oauthProvider, "google");
  });

  it("updates an existing user matched by betterAuthId", async () => {
    await setup;
    await TestUser.create({
      betterAuthId: "ba-user-123",
      email: "old@example.com",
      name: "Old Name",
    });

    const baUser = makeBetterAuthUser({email: "new@example.com", name: "New Name"});
    const result = await syncBetterAuthUser(TestUser, baUser);

    expect(result.email).toBe("new@example.com");
    expect(result.name).toBe("New Name");
    expect(result.betterAuthId).toBe("ba-user-123");

    const count = await TestUser.countDocuments();
    expect(count).toBe(1);
  });

  it("links existing user matched by email", async () => {
    await setup;
    await TestUser.create({
      email: "test@example.com",
      name: "Existing User",
    });

    const baUser = makeBetterAuthUser();
    const result = await syncBetterAuthUser(TestUser, baUser);

    expect(result.betterAuthId).toBe("ba-user-123");
    expect(result.email).toBe("test@example.com");

    const count = await TestUser.countDocuments();
    expect(count).toBe(1);
  });

  it("sets oauthProvider when linking by email", async () => {
    await setup;
    await TestUser.create({
      email: "test@example.com",
      name: "Existing User",
    });

    const baUser = makeBetterAuthUser();
    const result = await syncBetterAuthUser(TestUser, baUser, "google");

    expect(result.oauthProvider).toBe("google");
  });

  it("uses email prefix as name when name is null", async () => {
    await setup;
    const baUser = makeBetterAuthUser({name: null});
    const result = await syncBetterAuthUser(TestUser, baUser);

    expect(result.name).toBe("test");
  });

  it("does not overwrite name when betterAuthUser.name is null", async () => {
    await setup;
    await TestUser.create({
      betterAuthId: "ba-user-123",
      email: "test@example.com",
      name: "Keep This Name",
    });

    const baUser = makeBetterAuthUser({name: null});
    const result = await syncBetterAuthUser(TestUser, baUser);

    expect(result.name).toBe("Keep This Name");
  });

  it("logs and rethrows when the lookup fails", async () => {
    await setup;
    const failure = new Error("lookup exploded");
    const throwingModel = {
      findOneOrNone: () => {
        throw failure;
      },
    } as unknown as UserModel;

    const baUser = makeBetterAuthUser();
    await expect(syncBetterAuthUser(throwingModel, baUser)).rejects.toThrow("lookup exploded");
  });
});

describe("createBetterAuthSessionMiddleware", () => {
  it("calls next when no session exists", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});
    const middleware = createBetterAuthSessionMiddleware(auth);
    const req = makeReq();
    const res = makeRes();
    const next = mock(() => {});

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it("calls next on error without crashing", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});

    // Override getSession to throw
    const origGetSession = auth.api.getSession;
    setGetSession(auth, () => {
      throw new Error("Session error");
    });

    const middleware = createBetterAuthSessionMiddleware(auth);
    const req = makeReq();
    const res = makeRes();
    const next = mock(() => {});

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();

    setGetSession(auth, origGetSession);
  });

  it("attaches basic user data when no userModel is provided", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});

    const mockSession = {
      session: {id: "session-1", userId: "user-1"},
      user: {
        email: "user@example.com",
        id: "user-1",
        name: "Test User",
      },
    };

    // Override getSession to return mock session
    setGetSession(auth, async () => mockSession);

    const middleware = createBetterAuthSessionMiddleware(auth);
    const req = makeReq();
    const res = makeRes();
    const next = mock(() => {});

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user.email).toBe("user@example.com");
    expect(req.user.betterAuthId).toBe("user-1");
    expect(req.user.admin).toBe(false);
    expect(req.betterAuthSession).toBe(mockSession);
  });

  it("looks up app user by betterAuthId when userModel is provided", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    // Create an existing app user
    const appUser = await TestUser.create({
      betterAuthId: "user-1",
      email: "user@example.com",
      name: "App User",
    });

    const auth = createBetterAuth({config, mongoClient: getClient()});

    const mockSession = {
      session: {id: "session-1", userId: "user-1"},
      user: {
        email: "user@example.com",
        id: "user-1",
        name: "Test User",
      },
    };

    setGetSession(auth, async () => mockSession);

    const middleware = createBetterAuthSessionMiddleware(auth, TestUser);
    const req = makeReq();
    const res = makeRes();
    const next = mock(() => {});

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user._id.toString()).toBe(appUser._id.toString());
    expect(req.betterAuthSession).toBe(mockSession);
  });

  it("creates app user via sync when not found by betterAuthId", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});

    const mockSession = {
      session: {id: "session-1", userId: "new-user-1"},
      user: {
        email: "newuser@example.com",
        id: "new-user-1",
        name: "New User",
      },
    };

    setGetSession(auth, async () => mockSession);

    const middleware = createBetterAuthSessionMiddleware(auth, TestUser);
    const req = makeReq();
    const res = makeRes();
    const next = mock(() => {});

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user.betterAuthId).toBe("new-user-1");
    expect(req.user.email).toBe("newuser@example.com");

    // Verify user was persisted
    const count = await TestUser.countDocuments();
    expect(count).toBe(1);
  });
});

describe("createBetterAuth options and plugins passthrough", () => {
  const config: BetterAuthConfig = {
    baseURL: "http://localhost:3000",
    enabled: true,
    secret: "test-secret-at-least-32-characters-long",
  };

  const signInRequest = (email: string): globalThis.Request =>
    new globalThis.Request("http://localhost:3000/api/auth/sign-in/email", {
      body: JSON.stringify({email, password: "password-123456"}),
      headers: {"Content-Type": "application/json"},
      method: "POST",
    });

  it("applies requireEmailVerification from options and keeps Terreno's defaults", async () => {
    await setup;
    const auth = createBetterAuth({
      config: {...config, options: {emailAndPassword: {requireEmailVerification: true}}},
      mongoClient: getClient(),
    });
    const email = `unverified-${DateTime.now().toMillis()}@example.com`;
    await auth.api.signUpEmail({body: {email, name: "Unverified", password: "password-123456"}});

    const response = await auth.handler(signInRequest(email));

    expect(response.status).toBe(403);
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(auth.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
    expect(auth.options.session?.cookieCache).toEqual({enabled: true, maxAge: 300});
  });

  it("lets an explicit option override a Terreno default", async () => {
    await setup;
    const auth = createBetterAuth({
      config: {...config, options: {session: {cookieCache: {enabled: false}}}},
      mongoClient: getClient(),
    });

    expect(auth.options.session?.cookieCache).toEqual({enabled: false, maxAge: 300});
  });

  it("replaces arrays instead of merging them by index", async () => {
    await setup;
    const auth = createBetterAuth({
      config: {
        ...config,
        options: {trustedOrigins: ["https://a.example.com"]},
        trustedOrigins: ["https://b.example.com", "https://c.example.com"],
      },
      mongoClient: getClient(),
    });

    expect(auth.options.trustedOrigins).toEqual(["https://a.example.com"]);
  });

  it("appends plugins after bearer and leaves defaults alone without the new fields", async () => {
    await setup;
    const plugin = {id: "terreno-test"} satisfies BetterAuthPlugin;
    const withPlugin = createBetterAuth({
      config: {...config, plugins: [plugin]},
      mongoClient: getClient(),
    });
    const plain = createBetterAuth({config, mongoClient: getClient()});

    expect(withPlugin.options.plugins?.map((p) => p.id)).toEqual([
      "bearer",
      "terreno-methods",
      "terreno-test",
    ]);
    expect(plain.options.plugins?.map((p) => p.id)).toEqual(["bearer", "terreno-methods"]);
    expect(plain.options.trustedOrigins).toEqual([]);
  });
});

describe("resolveBetterAuthAppUser", () => {
  it("resolves concurrent first contacts for a new user to one app user", async () => {
    await setup;
    const betterAuthUser: BetterAuthUser = {
      createdAt: new Date(),
      email: "first-contact@example.com",
      emailVerified: false,
      id: new mongoose.Types.ObjectId().toString(),
      name: "First Contact",
      updatedAt: new Date(),
    };

    const results = await Promise.all([
      resolveBetterAuthAppUser({betterAuthUser, userModel: TestUser}),
      resolveBetterAuthAppUser({betterAuthUser, userModel: TestUser}),
      resolveBetterAuthAppUser({betterAuthUser, userModel: TestUser}),
    ]);

    expect(new Set(results.map((result) => String(result.user.id))).size).toBe(1);
    expect(await TestUser.countDocuments({betterAuthId: betterAuthUser.id})).toBe(1);
  });

  it("uses the user a concurrent request created when the insert hits a duplicate key", async () => {
    // Another request (a REST call racing the socket handshake) inserts the same user
    // between this lookup and this insert.
    let insertedByOtherRequest: Record<string, unknown> | null = null;
    class RacingUser {
      constructor(doc: Record<string, unknown>) {
        Object.assign(this, doc);
      }
      async save(): Promise<void> {
        insertedByOtherRequest = {...this, id: "app-user-1"};
        throw Object.assign(new Error("E11000 duplicate key error"), {code: 11000});
      }
      static async findOneOrNone(
        query: Record<string, unknown>
      ): Promise<Record<string, unknown> | null> {
        return query.betterAuthId ? insertedByOtherRequest : null;
      }
    }

    const {isDisabled, user} = await resolveBetterAuthAppUser({
      betterAuthUser: {
        createdAt: new Date(),
        email: "raced@example.com",
        emailVerified: false,
        id: "ba-raced",
        name: "Raced",
        updatedAt: new Date(),
      },
      userModel: RacingUser as unknown as UserModel,
    });

    expect(user.id).toBe("app-user-1");
    expect(isDisabled).toBe(false);
  });
});

describe("createBetterAuthSessionMiddleware with disabled users", () => {
  const config: BetterAuthConfig = {
    baseURL: "http://localhost:3000",
    enabled: true,
    secret: "test-secret-at-least-32-characters-long",
  };

  // A real bearer session for a Better Auth user linked to an app user.
  const signUpLinkedUser = async (
    auth: BetterAuthInstance,
    email: string,
    disabled: boolean
  ): Promise<{token: string; betterAuthId: string}> => {
    const created = await auth.api.signUpEmail({
      body: {email, name: "Linked User", password: "password-123456"},
    });
    await TestUser.create({betterAuthId: created.user.id, disabled, email});
    return {betterAuthId: created.user.id, token: created.token as string};
  };

  // Mounted in TerrenoApp's order: session middleware first, then Better Auth's routes,
  // then a route that requires an authenticated user.
  const buildApp = (auth: BetterAuthInstance): express.Application => {
    const app = express();
    app.use(createBetterAuthSessionMiddleware(auth, TestUser));
    mountBetterAuthRoutes(app, auth);
    app.get("/protected", (req, res) => {
      if (!req.user) {
        return res.status(401).json({status: 401, title: "Unauthorized"});
      }
      return res.json({id: req.user.id});
    });
    return app;
  };

  it("does not authenticate a session that belongs to a disabled user", async () => {
    await setup;
    const auth = createBetterAuth({config, mongoClient: getClient()});
    const {token} = await signUpLinkedUser(auth, "disabled-session@example.com", true);

    const res = await supertest(buildApp(auth))
      .get("/protected")
      .set("authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it("stops authenticating once a user is disabled while their session is live", async () => {
    await setup;
    const auth = createBetterAuth({config, mongoClient: getClient()});
    const {betterAuthId, token} = await signUpLinkedUser(auth, "disabled-later@example.com", false);
    const app = buildApp(auth);

    const before = await supertest(app).get("/protected").set("authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);

    await TestUser.updateOne({betterAuthId}, {disabled: true});

    const after = await supertest(app).get("/protected").set("authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it("still lets a disabled user sign out", async () => {
    await setup;
    const auth = createBetterAuth({config, mongoClient: getClient()});
    const {token} = await signUpLinkedUser(auth, "disabled-signout@example.com", true);

    const res = await supertest(buildApp(auth))
      .post("/api/auth/sign-out")
      .set("authorization", `Bearer ${token}`)
      .set("origin", "http://localhost:3000")
      .send({});

    expect(res.status).toBe(200);
  });
});

describe("mountBetterAuthRoutes", () => {
  it("mounts routes at the default path", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});
    const app = express();

    expect(() => mountBetterAuthRoutes(app, auth)).not.toThrow();
  });

  it("mounts routes at a custom path", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});
    const app = express();

    expect(() => mountBetterAuthRoutes(app, auth, "/custom/auth")).not.toThrow();
  });

  it("delegates matched requests to the Better Auth node handler", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});

    type RouteHandler = (req: unknown, res: unknown) => unknown;
    let registered: RouteHandler | undefined;
    let registeredPath: string | undefined;
    const fakeApp = {
      all: (path: string, handler: RouteHandler) => {
        registeredPath = path;
        registered = handler;
      },
    } as unknown as express.Application;

    mountBetterAuthRoutes(fakeApp, auth, "/api/auth");
    expect(registeredPath).toBe("/api/auth/*path");
    expect(registered).toBeDefined();

    // Invoke the registered handler so the wildcard delegation runs.
    const req = {headers: {}, method: "GET", on: () => {}, url: "/api/auth/session"};
    const res = {
      end: mock(() => {}),
      getHeader: () => undefined,
      setHeader: mock(() => {}),
      write: mock(() => {}),
      writeHead: mock(() => {}),
    };
    try {
      await registered?.(req, res);
    } catch {
      // The bare req/res may not satisfy the underlying handler; we only need
      // the delegating arrow itself to execute.
    }
  });
});

describe("getMongoClientFromMongoose", () => {
  it("returns the mongo client when connected", () => {
    // Default mongoose connection is set up by bunSetup.ts preload
    const client = getMongoClientFromMongoose();
    expect(client).toBeDefined();
  });

  it("throws when the mongoose connection has no client", () => {
    const connection = mongoose.connection as unknown as {client?: unknown};
    const originalClient = connection.client;
    connection.client = undefined;
    try {
      expect(() => getMongoClientFromMongoose()).toThrow("Mongoose is not connected");
    } finally {
      connection.client = originalClient;
    }
  });
});

describe("getBetterAuthSession", () => {
  it("returns null when no session is set", () => {
    const req = makeReq();
    expect(getBetterAuthSession(req)).toBeNull();
  });

  it("returns session data when set", () => {
    const sessionData = {session: {id: "s1"}, user: {id: "u1"}} as unknown as BetterAuthSessionData;
    const req = makeReq({betterAuthSession: sessionData});
    expect(getBetterAuthSession(req)).toBe(sessionData);
  });
});

describe("hasBetterAuthSession", () => {
  it("returns false when no session is set", () => {
    const req = makeReq();
    expect(hasBetterAuthSession(req)).toBe(false);
  });

  it("returns true when session is set", () => {
    const req = makeReq({
      betterAuthSession: {session: {}, user: {}} as unknown as BetterAuthSessionData,
    });
    expect(hasBetterAuthSession(req)).toBe(true);
  });
});

describe("setupBetterAuthUserSync", () => {
  it("does not throw", async () => {
    await setup;
    const config: BetterAuthConfig = {
      baseURL: "http://localhost:3000",
      enabled: true,
      secret: "test-secret-at-least-32-characters-long",
    };

    const auth = createBetterAuth({config, mongoClient: getClient()});

    expect(() => setupBetterAuthUserSync(auth, TestUser)).not.toThrow();
  });
});
