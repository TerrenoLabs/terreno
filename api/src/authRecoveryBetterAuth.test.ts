/**
 * The legacy JWT recovery routes (`POST /auth/forgotPassword`, `POST /auth/resetPassword`) on an
 * app that also runs Better Auth. JWT login (`POST /auth/login`) has no second factor, so these
 * routes must only replace an existing JWT password: an account without one (for example a
 * social-only account) is not mailed a legacy link and a legacy token cannot give it a password.
 */

import {beforeAll, beforeEach, describe, expect, it} from "bun:test";
import supertest from "supertest";

import {AuthToken} from "./authTokens";
import type {AuthRecoveryMail} from "./expressServer";
import {
  access,
  buildApp,
  resetAccountSecurityState,
  SecurityUser,
  signUp,
} from "./tests/accountSecurityTestApp";
import {
  betterAuthAccounts,
  newStubIdentity,
  stubGoogleIdTokenOptions,
} from "./tests/betterAuthStubs";

const NEW_PASSWORD = "legacy-reset-password-987";
const OLD_JWT_PASSWORD = "old-jwt-password-123";

const legacyTokenFrom = (mail: AuthRecoveryMail | undefined): string => {
  const match = /resetPassword\?token=([0-9a-f]+)/i.exec(mail?.text ?? "");
  return match?.[1] ?? "";
};

/** An app with Better Auth (Google ID-token sign-in) and legacy recovery mail captured. */
const buildRecoveryApp = (
  identity = newStubIdentity("legacy-reset")
): {
  app: ReturnType<typeof buildApp>["app"];
  identity: typeof identity;
  sent: AuthRecoveryMail[];
} => {
  const sent: AuthRecoveryMail[] = [];
  const {app} = buildApp({
    authOptions: {
      publicAppUrl: "https://app.example.com",
      sendMail: async (message): Promise<void> => {
        sent.push(message);
      },
    },
    config: {
      googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
      options: stubGoogleIdTokenOptions(identity),
    },
  });
  return {app, identity, sent};
};

const signInWithGoogle = async (
  app: ReturnType<typeof buildApp>["app"],
  email: string
): Promise<string> => {
  await supertest(app)
    .post("/api/auth/sign-in/social")
    .send({idToken: {token: "stub-id-token"}, provider: "google"})
    .expect(200);
  const stored = await SecurityUser.collection.findOne({email});
  return String(stored?._id);
};

describe("legacy JWT password reset with Better Auth on", () => {
  beforeAll(async () => {
    await access.roles.seedDefaults();
  });

  beforeEach(async () => {
    await resetAccountSecurityState();
    await AuthToken.deleteMany({});
  });

  it("does not mail a legacy reset link to a social-only account", async () => {
    const {app, identity, sent} = buildRecoveryApp();
    await signInWithGoogle(app, identity.email);

    const known = await supertest(app)
      .post("/auth/forgotPassword")
      .send({email: identity.email})
      .expect(202);
    const unknown = await supertest(app)
      .post("/auth/forgotPassword")
      .send({email: "nobody-legacy@example.com"})
      .expect(202);

    // The response does not say whether the account exists or which kind it is.
    expect(known.body).toEqual(unknown.body);
    expect(sent).toHaveLength(0);
    expect(await AuthToken.countDocuments({type: "passwordReset"})).toBe(0);
  });

  it("refuses a legacy reset token for a social-only account and sets no password", async () => {
    const {app, identity} = buildRecoveryApp();
    const userId = await signInWithGoogle(app, identity.email);
    // A link mailed before this rule, or a token issued by app code.
    const {token} = await AuthToken.issueFor({_id: userId}, "passwordReset");

    const reset = await supertest(app)
      .post("/auth/resetPassword")
      .send({password: NEW_PASSWORD, token});

    expect(reset.status).toBe(400);
    expect(reset.body.data?.token).toBeUndefined();
    const stored = await SecurityUser.collection.findOne({email: identity.email});
    expect(stored?.hash).toBeUndefined();
    expect(stored?.salt).toBeUndefined();
    await supertest(app)
      .post("/auth/login")
      .send({email: identity.email, password: NEW_PASSWORD})
      .expect(401);
    const credential = await betterAuthAccounts().findOne({
      providerId: "credential",
      userId: stored?.betterAuthId,
    });
    expect(credential).toBeNull();
    // The token is spent either way.
    await supertest(app)
      .post("/auth/resetPassword")
      .send({password: NEW_PASSWORD, token})
      .expect(400);
  });

  it("refuses the legacy POST /resetPassword alias the same way", async () => {
    const {app, identity} = buildRecoveryApp();
    const userId = await signInWithGoogle(app, identity.email);
    const {token} = await AuthToken.issueFor({_id: userId}, "passwordReset");

    await supertest(app).post("/resetPassword").send({password: NEW_PASSWORD, token}).expect(400);

    const stored = await SecurityUser.collection.findOne({email: identity.email});
    expect(stored?.hash).toBeUndefined();
  });

  it("still resets an account that already has a JWT password", async () => {
    const {app, sent} = buildRecoveryApp();
    const user = await signUp(app, "legacy-reset-dual");
    const appUser = (await SecurityUser.findById(user.id)) as unknown as {
      save: () => Promise<unknown>;
      setPassword: (password: string) => Promise<unknown>;
    };
    await appUser.setPassword(OLD_JWT_PASSWORD);
    await appUser.save();

    await supertest(app).post("/auth/forgotPassword").send({email: user.email}).expect(202);
    expect(sent).toHaveLength(1);
    const token = legacyTokenFrom(sent[0]);

    const reset = await supertest(app)
      .post("/auth/resetPassword")
      .send({password: NEW_PASSWORD, token})
      .expect(200);
    expect(typeof reset.body.data.token).toBe("string");
    await supertest(app)
      .post("/auth/login")
      .send({email: user.email, password: NEW_PASSWORD})
      .expect(200);
    await supertest(app)
      .post("/auth/login")
      .send({email: user.email, password: OLD_JWT_PASSWORD})
      .expect(401);
  });
});
