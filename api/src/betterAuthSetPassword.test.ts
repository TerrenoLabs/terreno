import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import {DateTime} from "luxon";
import supertest from "supertest";
import {flushSecurityNotificationsForTests} from "./accountSecurity/securityNotifications";
import type {BetterAuthApp} from "./betterAuthApp";
import {
  betterAuthCollection,
  buildApp,
  captureMail,
  resetAccountSecurityState,
  SecurityUser,
  selfSecurityEventsFor,
  signUp,
} from "./tests/accountSecurityTestApp";
import {
  newStubIdentity,
  PASSWORD,
  type StubIdentity,
  stubGoogleIdTokenOptions,
} from "./tests/betterAuthStubs";

const NEW_PASSWORD = "first-password-987654";

interface OAuthOnlyApp {
  app: express.Application;
  betterAuthApp: BetterAuthApp;
  identity: StubIdentity;
  sent: ReturnType<typeof captureMail>["sent"];
}

/** An app whose `google` provider accepts any ID token for a fresh identity. */
const buildOAuthApp = (): OAuthOnlyApp => {
  const identity = newStubIdentity("set-password");
  const mail = captureMail();
  const {app, betterAuthApp} = buildApp({
    config: {
      ...mail.config,
      googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
      options: stubGoogleIdTokenOptions(identity),
    },
  });
  return {app, betterAuthApp, identity, sent: mail.sent};
};

/** Signs in with Google (an ID token), creating an OAuth-only user; returns the bearer token. */
const signInWithGoogle = async (app: express.Application): Promise<string> => {
  const res = await supertest(app)
    .post("/api/auth/sign-in/social")
    .send({idToken: {token: "stub-id-token"}, provider: "google"});
  expect(res.status).toBe(200);
  const token = (res.headers["set-auth-token"] as string | undefined) ?? res.body.token;
  expect(typeof token).toBe("string");
  return token as string;
};

const setPassword = (
  app: express.Application,
  token: string | undefined,
  newPassword: string
): supertest.Test => {
  const request = supertest(app).post("/api/auth/terreno/set-password");
  if (token) {
    request.set("authorization", `Bearer ${token}`);
  }
  return request.send({newPassword});
};

describe("POST {basePath}/terreno/set-password", () => {
  beforeEach(async () => {
    await resetAccountSecurityState();
  });

  afterEach(async () => {
    await flushSecurityNotificationsForTests();
  });

  it("adds a password an OAuth-only user can then sign in with", async () => {
    const {app, betterAuthApp, identity} = buildOAuthApp();
    const token = await signInWithGoogle(app);

    const before = await supertest(app)
      .post("/api/auth/sign-in/email")
      .send({email: identity.email, password: NEW_PASSWORD});
    expect(before.status).not.toBe(200);

    const res = await setPassword(app, token, NEW_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({status: true});
    expect(res.headers["cache-control"]).toBe("no-store");
    const signIn = await supertest(app)
      .post("/api/auth/sign-in/email")
      .send({email: identity.email, password: NEW_PASSWORD});
    expect(signIn.status).toBe(200);
    const context = await betterAuthApp.ensureAuth().$context;
    const accounts = await context.internalAdapter.findAccounts(signIn.body.user.id);
    expect(accounts.map((account) => account.providerId).sort()).toEqual(["credential", "google"]);
  });

  it("sets the app User's JWT password too", async () => {
    const {app, identity} = buildOAuthApp();
    const token = await signInWithGoogle(app);

    expect((await setPassword(app, token, NEW_PASSWORD)).status).toBe(200);

    const login = await supertest(app)
      .post("/auth/login")
      .send({email: identity.email, password: NEW_PASSWORD});
    expect(login.status).toBe(200);
  });

  it("sets the JWT password of an unlinked app User with the same verified email", async () => {
    const {app, identity} = buildOAuthApp();
    const token = await signInWithGoogle(app);
    await SecurityUser.updateOne({email: identity.email}, {$unset: {betterAuthId: 1}});

    expect((await setPassword(app, token, NEW_PASSWORD)).status).toBe(200);

    const login = await supertest(app)
      .post("/auth/login")
      .send({email: identity.email, password: NEW_PASSWORD});
    expect(login.status).toBe(200);
  });

  it("leaves an unlinked app User alone when the Better Auth email is unverified", async () => {
    const identity = {...newStubIdentity("set-password-unverified"), emailVerified: false};
    const {app} = buildApp({
      config: {
        googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
        options: stubGoogleIdTokenOptions(identity),
      },
    });
    const token = await signInWithGoogle(app);
    await SecurityUser.updateOne({email: identity.email}, {$unset: {betterAuthId: 1}});

    expect((await setPassword(app, token, NEW_PASSWORD)).status).toBe(200);

    const login = await supertest(app)
      .post("/auth/login")
      .send({email: identity.email, password: NEW_PASSWORD});
    expect(login.status).toBe(401);
  });

  it("records password-set and emails the user", async () => {
    const {app, identity, sent} = buildOAuthApp();
    const token = await signInWithGoogle(app);

    expect((await setPassword(app, token, NEW_PASSWORD)).status).toBe(200);

    const user = await SecurityUser.findOne({email: identity.email});
    const events = await selfSecurityEventsFor(String(user?._id));
    expect(events.map((event) => (event.after as {securityAction: string}).securityAction)).toEqual(
      ["password-set"]
    );
    await flushSecurityNotificationsForTests();
    const notices = sent.filter((mail) => mail.subject === "A password was added to your account");
    expect(notices).toHaveLength(1);
    expect(notices[0].to).toBe(identity.email);
    expect(notices[0].text).toContain("You added a password to your account");
    expect(notices[0].text).not.toContain(NEW_PASSWORD);
  });

  it("fills in a credential account that has no password yet", async () => {
    const {app, betterAuthApp, identity} = buildOAuthApp();
    const token = await signInWithGoogle(app);
    const context = await betterAuthApp.ensureAuth().$context;
    const session = await supertest(app)
      .get("/api/auth/get-session")
      .set("authorization", `Bearer ${token}`);
    const userId = session.body.user.id as string;
    await context.internalAdapter.createAccount({
      accountId: userId,
      providerId: "credential",
      userId,
    });

    const res = await setPassword(app, token, NEW_PASSWORD);

    expect(res.status).toBe(200);
    const accounts = await context.internalAdapter.findAccounts(userId);
    expect(accounts.filter((account) => account.providerId === "credential")).toHaveLength(1);
    const signIn = await supertest(app)
      .post("/api/auth/sign-in/email")
      .send({email: identity.email, password: NEW_PASSWORD});
    expect(signIn.status).toBe(200);
  });

  it("refuses with 409 when the user already has a password", async () => {
    const {app} = buildOAuthApp();
    const user = await signUp(app, "has-password");

    const res = await setPassword(app, user.token, NEW_PASSWORD);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PASSWORD_ALREADY_SET");
    const signIn = await supertest(app)
      .post("/api/auth/sign-in/email")
      .send({email: user.email, password: PASSWORD});
    expect(signIn.status).toBe(200);
  });

  it("refuses a second set after the first succeeded", async () => {
    const {app} = buildOAuthApp();
    const token = await signInWithGoogle(app);
    expect((await setPassword(app, token, NEW_PASSWORD)).status).toBe(200);

    const again = await setPassword(app, token, "another-password-1234");

    expect(again.status).toBe(409);
  });

  it("leaves one password when two sets race", async () => {
    const {app, betterAuthApp} = buildOAuthApp();
    const token = await signInWithGoogle(app);

    const responses = await Promise.all([
      setPassword(app, token, NEW_PASSWORD),
      setPassword(app, token, "racing-password-1234"),
    ]);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    const session = await supertest(app)
      .get("/api/auth/get-session")
      .set("authorization", `Bearer ${token}`);
    const context = await betterAuthApp.ensureAuth().$context;
    const accounts = await context.internalAdapter.findAccounts(session.body.user.id);
    expect(accounts.filter((account) => account.providerId === "credential")).toHaveLength(1);
  });

  it("answers 403 SESSION_NOT_FRESH for a session signed in too long ago", async () => {
    const {app} = buildOAuthApp();
    const token = await signInWithGoogle(app);
    // The only session in the (reset) collection is the one just signed in.
    const aged = await betterAuthCollection("session").updateMany(
      {},
      {$set: {createdAt: DateTime.now().minus({days: 2}).toJSDate()}}
    );
    expect(aged.matchedCount).toBe(1);

    const res = await setPassword(app, token, NEW_PASSWORD);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SESSION_NOT_FRESH");
  });

  it("answers 401 without a session", async () => {
    const {app} = buildOAuthApp();

    const res = await setPassword(app, undefined, NEW_PASSWORD);

    expect(res.status).toBe(401);
  });

  it("answers 401 for a revoked session", async () => {
    const {app} = buildOAuthApp();
    const token = await signInWithGoogle(app);
    const signOut = await supertest(app)
      .post("/api/auth/sign-out")
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(signOut.status).toBe(200);

    const res = await setPassword(app, token, NEW_PASSWORD);

    expect(res.status).toBe(401);
  });

  it("enforces Better Auth's password length policy", async () => {
    const {app} = buildOAuthApp();
    const token = await signInWithGoogle(app);

    const short = await setPassword(app, token, "short");
    const long = await setPassword(app, token, "x".repeat(200));

    expect(short.status).toBe(400);
    expect(short.body.code).toBe("PASSWORD_TOO_SHORT");
    expect(long.status).toBe(400);
    expect(long.body.code).toBe("PASSWORD_TOO_LONG");
  });

  it("refuses when email and password sign-in is off", async () => {
    const identity = newStubIdentity("set-password-off");
    const {app} = buildApp({
      config: {
        googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
        options: {
          ...stubGoogleIdTokenOptions(identity),
          emailAndPassword: {enabled: false},
        },
      },
    });
    const token = await signInWithGoogle(app);

    const res = await setPassword(app, token, NEW_PASSWORD);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMAIL_PASSWORD_DISABLED");
  });
});

describe("POST {basePath}/change-password with a userModel", () => {
  beforeEach(async () => {
    await resetAccountSecurityState();
  });

  it("replaces the app User's JWT password and bumps its tokenEpoch", async () => {
    const {app} = buildApp();
    const user = await signUp(app, "change-password-jwt");
    // Give the app User the same JWT password the Better Auth sign-up used.
    const appUser = await SecurityUser.findById(user.id);
    await (appUser as unknown as {setPassword: (password: string) => Promise<void>}).setPassword(
      PASSWORD
    );
    await appUser?.save();
    const before = await supertest(app)
      .post("/auth/login")
      .send({email: user.email, password: PASSWORD});
    expect(before.status).toBe(200);
    const epochBefore = (await SecurityUser.findById(user.id))?.tokenEpoch ?? 0;

    const res = await supertest(app)
      .post("/api/auth/change-password")
      .set("authorization", `Bearer ${user.token}`)
      .send({currentPassword: PASSWORD, newPassword: NEW_PASSWORD});
    expect(res.status).toBe(200);

    const oldLogin = await supertest(app)
      .post("/auth/login")
      .send({email: user.email, password: PASSWORD});
    const newLogin = await supertest(app)
      .post("/auth/login")
      .send({email: user.email, password: NEW_PASSWORD});
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
    expect((await SecurityUser.findById(user.id))?.tokenEpoch).toBe(epochBefore + 1);
  });

  it("leaves the JWT password alone when the change is refused", async () => {
    const {app} = buildApp();
    const user = await signUp(app, "change-password-refused");
    const epochBefore = (await SecurityUser.findById(user.id))?.tokenEpoch ?? 0;

    const res = await supertest(app)
      .post("/api/auth/change-password")
      .set("authorization", `Bearer ${user.token}`)
      .send({currentPassword: "not-the-password-1", newPassword: NEW_PASSWORD});

    expect(res.status).toBe(400);
    expect((await SecurityUser.findById(user.id))?.tokenEpoch ?? 0).toBe(epochBefore);
  });
});
