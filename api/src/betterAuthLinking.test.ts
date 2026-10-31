import {afterEach, describe, expect, it} from "bun:test";
import express from "express";
import mongoose, {Schema} from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";
import supertest from "supertest";
import {type HasSetPassword, setPasswordForUser, type UserModel} from "./auth";
import type {BetterAuthConfig, BetterAuthUser} from "./betterAuth";
import {BetterAuthApp} from "./betterAuthApp";
import {
  type BetterAuthInstance,
  createBetterAuth,
  createBetterAuthSessionMiddleware,
  getMongoClientFromMongoose,
  mountBetterAuthRoutes,
  syncBetterAuthUser,
  VERIFY_EMAIL_TO_USE_ACCOUNT,
} from "./betterAuthSetup";
import {isAPIError} from "./errors";
import {TerrenoApp} from "./terrenoApp";
import {
  API_ORIGIN,
  betterAuthAccounts,
  betterAuthUsers,
  newStubIdentity,
  PASSWORD,
  SECRET,
  type StubIdentity,
  signInWithStub,
  stubGoogleIdTokenOptions,
  stubOidcPlugin,
  uniqueEmail,
} from "./tests/betterAuthStubs";

// A legacy (JWT/passport) app User model, as an app that adds Better Auth later has it.
// `configure` adjusts the schema before the model is compiled (once per name).
const legacyUserModel = (
  name: string,
  passportOptions: Record<string, unknown> = {},
  configure?: (schema: Schema) => void
): mongoose.Model<Record<string, unknown>> => {
  const existing = mongoose.models[name] as mongoose.Model<Record<string, unknown>> | undefined;
  if (existing) {
    return existing;
  }
  const schema = new Schema({
    admin: {default: false, description: "Whether the user is an admin", type: Boolean},
    betterAuthId: {description: "The linked Better Auth user id", type: String},
    email: {description: "The user's email", required: true, type: String},
    name: {description: "The user's display name", type: String},
    oauthProvider: {description: "The provider the user first signed in with", type: String},
  });
  schema.plugin(
    passportLocalMongoose as unknown as (schema: Schema, options?: Record<string, unknown>) => void,
    {usernameCaseInsensitive: true, usernameField: "email", ...passportOptions}
  );
  configure?.(schema);
  return mongoose.model<Record<string, unknown>>(name, schema);
};

const LinkingUser = legacyUserModel("BetterAuthLinkingUser");
const userModel = LinkingUser as unknown as UserModel;

const OTHER_PASSWORD = "another-password-987";

interface LinkingApp {
  app: express.Application;
  auth: BetterAuthInstance;
}

// Mounted as BetterAuthApp mounts it: session middleware, then Better Auth's routes, then a
// route that reports the app User the request resolved to.
const buildApp = (overrides: Partial<BetterAuthConfig> = {}): LinkingApp => {
  const config: BetterAuthConfig = {
    baseURL: API_ORIGIN,
    enabled: true,
    secret: SECRET,
    ...overrides,
  };
  const auth = createBetterAuth({config, mongoClient: getMongoClientFromMongoose(), userModel});
  const app = express();
  app.use(createBetterAuthSessionMiddleware(auth, userModel));
  mountBetterAuthRoutes(app, auth, config.basePath);
  app.get("/me", (req, res) => {
    const user = req.user as {email?: string; id?: string} | undefined;
    if (!user) {
      return res.status(401).json({title: "Unauthorized"});
    }
    return res.json({email: user.email, id: user.id});
  });
  return {app, auth};
};

// An app that offers Google ID-token sign-in, with Google reporting `identity`.
const buildGoogleApp = (
  identity: StubIdentity,
  overrides: Partial<BetterAuthConfig> = {}
): LinkingApp =>
  buildApp({
    googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
    options: stubGoogleIdTokenOptions(identity),
    ...overrides,
  });

const signUpEmail = (
  app: express.Application,
  email: string,
  password = PASSWORD
): Promise<supertest.Response> =>
  supertest(app)
    .post("/api/auth/sign-up/email")
    .set("content-type", "application/json")
    .send({email, name: "Email User", password});

const signInWithGoogle = (app: express.Application): Promise<supertest.Response> =>
  supertest(app)
    .post("/api/auth/sign-in/social")
    .set("content-type", "application/json")
    .send({idToken: {token: "stub-id-token"}, provider: "google"});

const linkGoogle = (app: express.Application, token: string): Promise<supertest.Response> =>
  supertest(app)
    .post("/api/auth/link-social")
    .set("authorization", `Bearer ${token}`)
    .set("content-type", "application/json")
    .send({idToken: {token: "stub-id-token"}, provider: "google"});

// Marks the Better Auth user's email verified, as clicking the verification link does.
const markEmailVerified = async (email: string): Promise<void> => {
  await betterAuthUsers().updateOne({email}, {$set: {emailVerified: true}});
};

const accountCount = async (email: string): Promise<number> => {
  const user = await betterAuthUsers().findOne({email});
  if (!user) {
    return 0;
  }
  return betterAuthAccounts().countDocuments({userId: user._id});
};

const appUsers = (email: string): Promise<number> => LinkingUser.countDocuments({email});

// A legacy app User with a passport-local-mongoose hash, or none (a GitHub-JWT user).
const createLegacyUser = async (
  email: string,
  password?: string,
  model: mongoose.Model<Record<string, unknown>> = LinkingUser
): Promise<mongoose.HydratedDocument<Record<string, unknown>>> => {
  const user = new model({email, name: "Legacy User"});
  if (password) {
    await setPasswordForUser(user as unknown as HasSetPassword, password);
  }
  await user.save();
  return user;
};

// Proves nothing was left behind for `email` at the Better Auth layer.
const expectNoBetterAuthUser = async (email: string): Promise<void> => {
  expect(await betterAuthUsers().countDocuments({email})).toBe(0);
  expect(await accountCount(email)).toBe(0);
};

const signInEmail = (
  app: express.Application,
  email: string,
  password = PASSWORD
): Promise<supertest.Response> =>
  supertest(app)
    .post("/api/auth/sign-in/email")
    .set("content-type", "application/json")
    .send({email, password});

afterEach(async () => {
  await LinkingUser.deleteMany({});
});

describe("accountLinking: verified-email", () => {
  it("joins a verified Google sign-in to the verified email account", async () => {
    const identity = newStubIdentity("verified-join");
    const {app} = buildGoogleApp(identity, {accountLinking: {mode: "verified-email"}});
    const signUp = await signUpEmail(app, identity.email);
    expect(signUp.status).toBe(200);
    await markEmailVerified(identity.email);

    const google = await signInWithGoogle(app);

    expect(google.status).toBe(200);
    expect(google.body.user.email).toBe(identity.email);
    expect(await betterAuthUsers().countDocuments({email: identity.email})).toBe(1);
    expect(await accountCount(identity.email)).toBe(2);
    expect(await appUsers(identity.email)).toBe(1);
    const me = await supertest(app).get("/me").set("authorization", `Bearer ${google.body.token}`);
    expect(me.body.email).toBe(identity.email);
  });

  it("refuses with account_not_linked while the local email is unverified", async () => {
    const identity = newStubIdentity("verified-unverified-local");
    const {app} = buildGoogleApp(identity, {
      accountLinking: {mode: "verified-email"},
      plugins: [stubOidcPlugin(identity)],
    });
    expect((await signUpEmail(app, identity.email)).status).toBe(200);

    const google = await signInWithGoogle(app);
    const redirect = await signInWithStub(app);

    expect(google.status).toBe(401);
    expect(google.body.message).toBe("account not linked");
    expect(redirect.searchParams.get("error")).toBe("account_not_linked");
    expect(await betterAuthUsers().countDocuments({email: identity.email})).toBe(1);
    expect(await accountCount(identity.email)).toBe(1);
    expect(await appUsers(identity.email)).toBe(1);
  });
});

describe("accountLinking: explicit", () => {
  it("refuses the implicit sign-in, then links from the signed-in session", async () => {
    const identity = newStubIdentity("explicit-link");
    const {app} = buildGoogleApp(identity, {
      accountLinking: {mode: "explicit"},
      plugins: [stubOidcPlugin(identity)],
    });
    const signUp = await signUpEmail(app, identity.email);
    await markEmailVerified(identity.email);

    const google = await signInWithGoogle(app);
    const redirect = await signInWithStub(app);

    expect(google.status).toBe(401);
    expect(google.body.message).toBe("account not linked");
    expect(redirect.searchParams.get("error")).toBe("account_not_linked");
    expect(await accountCount(identity.email)).toBe(1);

    const link = await linkGoogle(app, signUp.body.token);
    expect(link.status).toBe(200);
    expect(await accountCount(identity.email)).toBe(2);

    const after = await signInWithGoogle(app);
    expect(after.status).toBe(200);
    expect(await betterAuthUsers().countDocuments({email: identity.email})).toBe(1);
    expect(await appUsers(identity.email)).toBe(1);
  });
});

describe("accountLinking: never", () => {
  it("refuses /link-social with 403 and a same-email social sign-in", async () => {
    const identity = newStubIdentity("never-link");
    const {app} = buildGoogleApp(identity, {accountLinking: {mode: "never"}});
    const signUp = await signUpEmail(app, identity.email);
    await markEmailVerified(identity.email);

    const link = await linkGoogle(app, signUp.body.token);
    const redirectLink = await supertest(app)
      .post("/api/auth/link-social")
      .set("authorization", `Bearer ${signUp.body.token}`)
      .set("content-type", "application/json")
      .send({callbackURL: `${API_ORIGIN}/done`, provider: "google"});
    const google = await signInWithGoogle(app);

    expect(link.status).toBe(403);
    expect(link.body.code).toBe("LINKING_DISABLED");
    expect(redirectLink.status).toBe(403);
    expect(google.status).toBe(401);
    expect(google.body.message).toBe("account not linked");
    expect(await accountCount(identity.email)).toBe(1);
  });

  it("refuses /link-social when options turn linking off", async () => {
    const identity = newStubIdentity("options-never-link");
    const {app} = buildApp({
      googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
      options: {
        ...stubGoogleIdTokenOptions(identity),
        account: {accountLinking: {enabled: false}},
      },
    });
    const signUp = await signUpEmail(app, identity.email);

    const link = await linkGoogle(app, signUp.body.token);

    expect(link.status).toBe(403);
    expect(link.body.code).toBe("LINKING_DISABLED");
  });

  it("leaves /link-social alone in the other modes", async () => {
    const identity = newStubIdentity("other-modes-link");
    const {app} = buildGoogleApp(identity, {accountLinking: {mode: "verified-email"}});
    const signUp = await signUpEmail(app, identity.email);

    const link = await linkGoogle(app, signUp.body.token);

    expect(link.status).toBe(200);
  });
});

describe("unverified provider emails", () => {
  for (const mode of ["verified-email", "explicit"] as const) {
    it(`never links an unverified provider email in ${mode} mode`, async () => {
      const identity: StubIdentity = {
        ...newStubIdentity(`unverified-${mode}`),
        emailVerified: false,
      };
      const {app} = buildGoogleApp(identity, {
        accountLinking: {mode},
        plugins: [stubOidcPlugin(identity)],
      });
      const signUp = await signUpEmail(app, identity.email);
      await markEmailVerified(identity.email);

      const google = await signInWithGoogle(app);
      const redirect = await signInWithStub(app);
      const link = await linkGoogle(app, signUp.body.token);

      expect(google.status).toBe(401);
      expect(redirect.searchParams.get("error")).toBe("account_not_linked");
      expect(link.status).toBe(401);
      expect(link.body.code).toBe("LINKING_NOT_ALLOWED");
      expect(await accountCount(identity.email)).toBe(1);
    });
  }
});

describe("unlinking", () => {
  it("refuses to unlink the only remaining sign-in method", async () => {
    const {app} = buildApp();
    const email = uniqueEmail("unlink-last");
    const signUp = await signUpEmail(app, email);

    const accounts = await supertest(app)
      .get("/api/auth/list-accounts")
      .set("authorization", `Bearer ${signUp.body.token}`);
    expect(accounts.body).toHaveLength(1);

    const unlink = await supertest(app)
      .post("/api/auth/unlink-account")
      .set("authorization", `Bearer ${signUp.body.token}`)
      .set("content-type", "application/json")
      .send({accountId: accounts.body[0].id});

    expect(unlink.status).toBe(400);
    expect(unlink.body.code).toBe("FAILED_TO_UNLINK_LAST_ACCOUNT");
    expect(await accountCount(email)).toBe(1);
  });
});

describe("legacy app User migration", () => {
  it("links a Better Auth sign-up whose password matches the legacy hash", async () => {
    const {app} = buildApp();
    const email = uniqueEmail("legacy-same");
    const legacy = await createLegacyUser(email, PASSWORD);

    const signUp = await signUpEmail(app, email);

    expect(signUp.status).toBe(200);
    expect(await appUsers(email)).toBe(1);
    const stored = await LinkingUser.findById(legacy._id).lean();
    expect(stored?.betterAuthId).toBe(signUp.body.user.id);
    const me = await supertest(app).get("/me").set("authorization", `Bearer ${signUp.body.token}`);
    expect(me.body.id).toBe(String(legacy._id));
  });

  it("refuses a sign-up with a different password before anything is created", async () => {
    const sent: string[] = [];
    const {app} = buildApp({
      publicAppUrl: "http://localhost:8082",
      sendMail: async (message): Promise<void> => {
        sent.push(message.to);
      },
    });
    const email = uniqueEmail("legacy-different");
    const legacy = await createLegacyUser(email, PASSWORD);

    const signUp = await signUpEmail(app, email, OTHER_PASSWORD);

    expect(signUp.status).toBe(409);
    expect(signUp.body.message).toBe(VERIFY_EMAIL_TO_USE_ACCOUNT);
    expect(signUp.body.code).toBe("VERIFY_EMAIL_TO_USE_ACCOUNT");
    await expectNoBetterAuthUser(email);
    expect(sent).toEqual([]);
    expect(await appUsers(email)).toBe(1);
    expect((await LinkingUser.findById(legacy._id).lean())?.betterAuthId).toBeUndefined();

    // The attacker's password opens nothing: there is no Better Auth user to sign in to.
    const signIn = await signInEmail(app, email, OTHER_PASSWORD);
    expect(signIn.status).toBe(401);
  });

  it("refuses a sign-up for a User bound to another Better Auth account before anything is created", async () => {
    const {app} = buildApp();
    const email = uniqueEmail("legacy-bound");
    const legacy = await createLegacyUser(email, PASSWORD);
    await LinkingUser.updateOne({_id: legacy._id}, {$set: {betterAuthId: "ba-gone"}});

    const signUp = await signUpEmail(app, email);

    expect(signUp.status).toBe(409);
    expect(signUp.body.code).toBe("ACCOUNT_ALREADY_EXISTS");
    await expectNoBetterAuthUser(email);
    expect((await LinkingUser.findById(legacy._id).lean())?.betterAuthId).toBe("ba-gone");
  });

  it("leaves nothing for a later verification to link when a legacy User has no hash", async () => {
    const identity = newStubIdentity("legacy-no-hash");
    const {app} = buildGoogleApp(identity);
    const legacy = await createLegacyUser(identity.email);

    const signUp = await signUpEmail(app, identity.email);

    expect(signUp.status).toBe(409);
    expect(signUp.body.message).toBe(VERIFY_EMAIL_TO_USE_ACCOUNT);
    await expectNoBetterAuthUser(identity.email);

    // Verifying the email (the link mail, an admin action) has no Better Auth user to act on,
    // so the refused sign-up's password never opens the legacy User.
    await markEmailVerified(identity.email);
    const signIn = await signInEmail(app, identity.email);
    expect(signIn.status).toBe(401);
    expect((await LinkingUser.findById(legacy._id).lean())?.betterAuthId).toBeUndefined();

    // A provider sign-in with a verified email is the way in.
    const google = await signInWithGoogle(app);
    expect(google.status).toBe(200);
    expect(await appUsers(identity.email)).toBe(1);
    expect((await LinkingUser.findById(legacy._id).lean())?.betterAuthId).toBe(google.body.user.id);
  });

  it("links a legacy User to a verified Google sign-in and records the provider", async () => {
    const identity = newStubIdentity("legacy-google");
    const {app} = buildGoogleApp(identity);
    const legacy = await createLegacyUser(identity.email, PASSWORD);

    const google = await signInWithGoogle(app);

    expect(google.status).toBe(200);
    expect(await appUsers(identity.email)).toBe(1);
    const stored = await LinkingUser.findById(legacy._id).lean();
    expect(stored?.betterAuthId).toBe(google.body.user.id);
    expect(stored?.oauthProvider).toBe("google");
  });

  it("refuses an unverified provider email for a legacy User before anything is created", async () => {
    const identity: StubIdentity = {...newStubIdentity("legacy-unverified"), emailVerified: false};
    const {app} = buildApp({plugins: [stubOidcPlugin(identity)]});
    await createLegacyUser(identity.email, PASSWORD);

    const redirect = await signInWithStub(app);

    expect(redirect.searchParams.get("error")).toBe("VERIFY_EMAIL_TO_USE_ACCOUNT");
    await expectNoBetterAuthUser(identity.email);
    expect(await appUsers(identity.email)).toBe(1);
    expect((await LinkingUser.findOne({email: identity.email}).lean())?.betterAuthId).toBe(
      undefined
    );
  });

  it("refuses an unverified ID-token email for a legacy User before anything is created", async () => {
    const identity: StubIdentity = {
      ...newStubIdentity("legacy-unverified-id-token"),
      emailVerified: false,
    };
    const {app} = buildGoogleApp(identity);
    await createLegacyUser(identity.email, PASSWORD);

    const google = await signInWithGoogle(app);

    expect(google.status).toBe(409);
    expect(google.body.code).toBe("VERIFY_EMAIL_TO_USE_ACCOUNT");
    await expectNoBetterAuthUser(identity.email);
  });

  it("records the provider on a User created by an ID-token sign-in", async () => {
    const identity = newStubIdentity("new-google");
    const {app} = buildGoogleApp(identity);

    const google = await signInWithGoogle(app);

    expect(google.status).toBe(200);
    const stored = await LinkingUser.findOne({email: identity.email}).lean();
    expect(stored?.betterAuthId).toBe(google.body.user.id);
    expect(stored?.oauthProvider).toBe("google");
  });

  it("records the provider on a User created by an OAuth redirect sign-in", async () => {
    const identity = newStubIdentity("new-stub");
    const {app} = buildApp({plugins: [stubOidcPlugin(identity)]});

    const redirect = await signInWithStub(app);

    expect(redirect.searchParams.get("error")).toBeNull();
    const stored = await LinkingUser.findOne({email: identity.email}).lean();
    expect(stored?.oauthProvider).toBe("stub-oidc");
  });

  it("creates a User for an unverified sign-up when no User has the email", async () => {
    const {app} = buildApp();
    const email = uniqueEmail("fresh");

    const signUp = await signUpEmail(app, email);

    expect(signUp.status).toBe(200);
    const stored = await LinkingUser.findOne({email}).lean();
    expect(stored?.betterAuthId).toBe(signUp.body.user.id);
    expect(stored?.oauthProvider).toBeUndefined();
  });
});

describe("TerrenoApp wiring without a userModel on BetterAuthApp", () => {
  // TerrenoApp's userModel is the only one in play; BetterAuthApp must adopt it so the guard
  // runs, since TerrenoApp's session middleware links app Users with it.
  const buildTerrenoApp = (config: Partial<BetterAuthConfig> = {}): express.Application =>
    new TerrenoApp({
      configureApp: (app: express.Application): void => {
        app.get("/me", (req, res) => {
          const user = req.user as {id?: string} | undefined;
          return user ? res.json({id: user.id}) : res.status(401).json({});
        });
      },
      skipListen: true,
      userModel,
    } as never)
      .register(
        new BetterAuthApp({config: {baseURL: API_ORIGIN, enabled: true, secret: SECRET, ...config}})
      )
      .build();

  it("refuses an unverified sign-up for a legacy User and leaves nothing behind", async () => {
    const sent: string[] = [];
    const app = buildTerrenoApp({
      publicAppUrl: "http://localhost:8082",
      sendMail: async (message): Promise<void> => {
        sent.push(message.to);
      },
    });
    const email = uniqueEmail("terreno-app-guard");
    const legacy = await createLegacyUser(email, PASSWORD);

    const signUp = await signUpEmail(app, email, OTHER_PASSWORD);

    expect(signUp.status).toBe(409);
    expect(signUp.body.code).toBe("VERIFY_EMAIL_TO_USE_ACCOUNT");
    await expectNoBetterAuthUser(email);
    expect(sent).toEqual([]);
    await markEmailVerified(email);
    expect((await signInEmail(app, email, OTHER_PASSWORD)).status).toBe(401);
    expect((await LinkingUser.findById(legacy._id).lean())?.betterAuthId).toBeUndefined();
  });

  it("links a sign-up whose password matches the legacy hash", async () => {
    const app = buildTerrenoApp();
    const email = uniqueEmail("terreno-app-link");
    const legacy = await createLegacyUser(email, PASSWORD);

    const signUp = await signUpEmail(app, email);

    expect(signUp.status).toBe(200);
    const me = await supertest(app).get("/me").set("authorization", `Bearer ${signUp.body.token}`);
    expect(me.body.id).toBe(String(legacy._id));
    expect(await appUsers(email)).toBe(1);
  });

  it("refuses at boot when Better Auth was created before the userModel arrived", () => {
    const betterAuthApp = new BetterAuthApp({
      config: {baseURL: API_ORIGIN, enabled: true, secret: SECRET},
    });
    betterAuthApp.ensureAuth();

    expect(() => betterAuthApp.adoptUserModel(userModel)).toThrow(
      "BetterAuthApp created Better Auth before it was given a userModel"
    );
  });

  it("keeps a userModel BetterAuthApp was given", () => {
    const betterAuthApp = new BetterAuthApp({
      config: {baseURL: API_ORIGIN, enabled: true, secret: SECRET},
      userModel,
    });
    betterAuthApp.ensureAuth();

    expect(() => betterAuthApp.adoptUserModel(userModel)).not.toThrow();
  });
});

describe("legacy Users stored with a mixed-case email", () => {
  const mixedCase = (label: string): string => {
    const email = uniqueEmail(label);
    return `${email[0].toUpperCase()}${email.slice(1, email.indexOf("@"))}@Example.COM`;
  };

  it("refuses an unverified sign-up on the lowercased email and leaves nothing behind", async () => {
    const {app} = buildApp();
    const stored = mixedCase("mixed-refuse");
    const legacy = await createLegacyUser(stored, PASSWORD);

    const signUp = await signUpEmail(app, stored.toLowerCase(), OTHER_PASSWORD);

    expect(signUp.status).toBe(409);
    await expectNoBetterAuthUser(stored.toLowerCase());
    expect(await LinkingUser.countDocuments({})).toBe(1);
    expect((await LinkingUser.findById(legacy._id).lean())?.betterAuthId).toBeUndefined();
  });

  it("links the mixed-case User on a matching password without a duplicate", async () => {
    const {app} = buildApp();
    const stored = mixedCase("mixed-link");
    const legacy = await createLegacyUser(stored, PASSWORD);

    const signUp = await signUpEmail(app, stored);

    expect(signUp.status).toBe(200);
    expect(await LinkingUser.countDocuments({})).toBe(1);
    expect((await LinkingUser.findById(legacy._id).lean())?.betterAuthId).toBe(signUp.body.user.id);
  });

  it("matches the email literally, not as a pattern", async () => {
    const {app} = buildApp();
    const suffix = new mongoose.Types.ObjectId().toString();
    // Unescaped, the "." in the sign-up email would match the "x" in the legacy one.
    await createLegacyUser(`axb-${suffix}@example.com`, PASSWORD);

    const signUp = await signUpEmail(app, `a.b-${suffix}@example.com`, OTHER_PASSWORD);

    expect(signUp.status).toBe(200);
    expect(await LinkingUser.countDocuments({})).toBe(2);
  });
});

describe("legacy password checks with limitAttempts", () => {
  const LimitedUser = legacyUserModel("BetterAuthLinkingLimitedUser", {
    limitAttempts: true,
    maxAttempts: 2,
  });

  afterEach(async () => {
    await LimitedUser.deleteMany({});
  });

  it("does not count Better Auth sign-ups against the legacy JWT login", async () => {
    const auth = createBetterAuth({
      config: {baseURL: API_ORIGIN, enabled: true, secret: SECRET},
      mongoClient: getMongoClientFromMongoose(),
      userModel: LimitedUser as unknown as UserModel,
    });
    const app = express();
    mountBetterAuthRoutes(app, auth);
    const email = uniqueEmail("limited");
    const legacy = await createLegacyUser(email, PASSWORD, LimitedUser);

    for (const attempt of [1, 2, 3]) {
      const signUp = await signUpEmail(app, email, `${OTHER_PASSWORD}-${attempt}`);
      expect(signUp.status).toBe(409);
    }

    const stored = await LimitedUser.findById(legacy._id).lean();
    expect(stored?.attempts).toBe(0);
    const jwtLogin = await (
      LimitedUser as unknown as {
        authenticate: () => (
          email: string,
          password: string,
          done: (error: unknown, user: unknown) => void
        ) => void;
      }
    ).authenticate();
    const loggedIn = await new Promise<unknown>((resolve, reject) => {
      jwtLogin(email, PASSWORD, (error, user) => (error ? reject(error) : resolve(user)));
    });
    expect(loggedIn).toBeTruthy();

    const signUp = await signUpEmail(app, email);
    expect(signUp.status).toBe(200);
    expect((await LimitedUser.findById(legacy._id).lean())?.betterAuthId).toBe(signUp.body.user.id);
  });
});

describe("app User sync on sign-in failures", () => {
  it("still signs in when the sync fails for a reason other than an unverified email", async () => {
    // A consumer User schema that requires a field the sync does not set.
    const Demanding =
      (mongoose.models.BetterAuthLinkingDemandingUser as mongoose.Model<unknown> | undefined) ??
      mongoose.model(
        "BetterAuthLinkingDemandingUser",
        new Schema({
          betterAuthId: {description: "The linked Better Auth user id", type: String},
          email: {description: "The user's email", required: true, type: String},
          orgId: {description: "The user's organization", required: true, type: String},
        })
      );
    const auth = createBetterAuth({
      config: {baseURL: API_ORIGIN, enabled: true, secret: SECRET},
      mongoClient: getMongoClientFromMongoose(),
      userModel: Demanding as unknown as UserModel,
    });
    const app = express();
    mountBetterAuthRoutes(app, auth);
    const email = uniqueEmail("sync-failure");

    const signUp = await signUpEmail(app, email);

    expect(signUp.status).toBe(200);
    expect(await Demanding.countDocuments({email})).toBe(0);
  });

  it("fails the sign-in when a password-proven link cannot be saved, then links on retry", async () => {
    let isLinkFailing = true;
    const FlakyUser = legacyUserModel("BetterAuthLinkingFlakyUser", {}, (schema) => {
      schema.pre("save", function () {
        if (isLinkFailing && this.isModified("betterAuthId")) {
          throw new Error("primary stepped down");
        }
      });
    });
    const auth = createBetterAuth({
      config: {baseURL: API_ORIGIN, enabled: true, secret: SECRET},
      mongoClient: getMongoClientFromMongoose(),
      userModel: FlakyUser as unknown as UserModel,
    });
    const app = express();
    mountBetterAuthRoutes(app, auth);
    const email = uniqueEmail("flaky-link");
    const legacy = await createLegacyUser(email, PASSWORD, FlakyUser);

    try {
      const signUp = await signUpEmail(app, email);

      expect(signUp.status).toBe(500);
      expect(signUp.body.code).toBe("APP_USER_LINK_FAILED");
      expect(signUp.body.token).toBeUndefined();
      expect((await FlakyUser.findById(legacy._id).lean())?.betterAuthId).toBeUndefined();

      isLinkFailing = false;
      const signIn = await signInEmail(app, email);
      expect(signIn.status).toBe(200);
      expect((await FlakyUser.findById(legacy._id).lean())?.betterAuthId).toBe(signIn.body.user.id);
    } finally {
      await FlakyUser.deleteMany({});
    }
  });
});

describe("syncBetterAuthUser email matches", () => {
  const unverifiedUser = (email: string): BetterAuthUser => ({
    createdAt: new Date(),
    email,
    emailVerified: false,
    id: new mongoose.Types.ObjectId().toString(),
    image: null,
    name: "Unverified",
    updatedAt: new Date(),
  });

  it("throws a 409 APIError instead of claiming the User for an unverified email", async () => {
    const email = uniqueEmail("sync-unverified");
    await createLegacyUser(email, PASSWORD);

    let caught: unknown;
    try {
      await syncBetterAuthUser(userModel, unverifiedUser(email));
    } catch (error) {
      caught = error;
    }

    expect(isAPIError(caught)).toBe(true);
    expect((caught as {status?: number}).status).toBe(409);
    expect((caught as Error).message).toBe(VERIFY_EMAIL_TO_USE_ACCOUNT);
    expect(await appUsers(email)).toBe(1);
  });

  it("links an unverified user when the password matches the legacy hash", async () => {
    const email = uniqueEmail("sync-password");
    await createLegacyUser(email, PASSWORD);
    const betterAuthUser = unverifiedUser(email);

    const linked = await syncBetterAuthUser(userModel, betterAuthUser, undefined, {
      password: PASSWORD,
    });

    expect(linked.betterAuthId).toBe(betterAuthUser.id);
  });

  it("keeps the legacy password a password-proven link relied on", async () => {
    const email = uniqueEmail("sync-password-keeps");
    const legacy = await createLegacyUser(email, PASSWORD);

    await syncBetterAuthUser(userModel, unverifiedUser(email), undefined, {password: PASSWORD});

    const stored = await LinkingUser.collection.findOne({
      _id: legacy._id as mongoose.Types.ObjectId,
    });
    expect(typeof stored?.hash).toBe("string");
  });

  it("refuses a password-proven claim on a User bound to another Better Auth account", async () => {
    const email = uniqueEmail("sync-password-bound");
    const legacy = await createLegacyUser(email, PASSWORD);
    await LinkingUser.updateOne({_id: legacy._id}, {$set: {betterAuthId: "ba-other"}});

    await expect(
      syncBetterAuthUser(userModel, unverifiedUser(email), undefined, {password: PASSWORD})
    ).rejects.toThrow("An account with this email already exists");

    expect((await LinkingUser.findById(legacy._id).lean())?.betterAuthId).toBe("ba-other");
  });

  it("refuses when the passport password check throws", async () => {
    const BrokenUser = legacyUserModel("BetterAuthLinkingBrokenUser", {}, (schema) => {
      schema.methods.authenticate = async (): Promise<never> => {
        throw new Error("hash store unavailable");
      };
    });
    const email = uniqueEmail("sync-throws");
    await createLegacyUser(email, PASSWORD, BrokenUser);

    try {
      await expect(
        syncBetterAuthUser(BrokenUser as unknown as UserModel, unverifiedUser(email), undefined, {
          password: PASSWORD,
        })
      ).rejects.toThrow(VERIFY_EMAIL_TO_USE_ACCOUNT);
    } finally {
      await BrokenUser.deleteMany({});
    }
  });

  it("refuses a password against a model without passport-local-mongoose", async () => {
    const Plain =
      (mongoose.models.BetterAuthLinkingPlainUser as mongoose.Model<unknown> | undefined) ??
      mongoose.model(
        "BetterAuthLinkingPlainUser",
        new Schema({
          betterAuthId: {description: "The linked Better Auth user id", type: String},
          email: {description: "The user's email", required: true, type: String},
        })
      );
    const email = uniqueEmail("sync-plain");
    await Plain.create({email});

    try {
      await expect(
        syncBetterAuthUser(Plain as unknown as UserModel, unverifiedUser(email), undefined, {
          password: PASSWORD,
        })
      ).rejects.toThrow(VERIFY_EMAIL_TO_USE_ACCOUNT);
    } finally {
      await Plain.deleteMany({});
    }
  });
});
