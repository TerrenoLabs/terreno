/**
 * Better Auth's `POST {basePath}/reset-password` over HTTP with a user model: Terreno copies the
 * new password to the app User's passport hash and bumps `tokenEpoch`. Better Auth has already
 * read the request body by the time its `onPasswordReset` hook runs, so the password must come
 * from the parsed endpoint body, not from the request.
 */

import {beforeAll, beforeEach, describe, expect, it} from "bun:test";
import supertest from "supertest";

import {
  access,
  buildApp,
  captureMail,
  resetAccountSecurityState,
  resetTokenFrom,
  SecurityUser,
  signInWithPassword,
  signUp,
} from "./tests/accountSecurityTestApp";

const NEW_PASSWORD = "new-password-654321";

interface PassportProbe {
  authenticate: (password: string) => Promise<{user?: unknown}>;
}

/** Whether `password` verifies against the app User's passport (JWT) hash. */
const jwtPasswordMatches = async (userId: string, password: string): Promise<boolean> => {
  const stored = await SecurityUser.collection
    .find({_id: new SecurityUser.base.Types.ObjectId(userId)})
    .limit(1)
    .next();
  if (!stored) {
    return false;
  }
  const probe = SecurityUser.hydrate(stored) as unknown as PassportProbe;
  const result = await probe.authenticate(password);
  return Boolean(result.user);
};

describe("Better Auth password reset over HTTP", () => {
  beforeAll(async () => {
    await access.roles.seedDefaults();
  });

  beforeEach(async () => {
    await resetAccountSecurityState();
  });

  it("resets the password, syncs the JWT hash, and bumps tokenEpoch", async () => {
    const mail = captureMail();
    const {app} = buildApp({config: mail.config});
    const user = await signUp(app, "http-reset");
    mail.sent.length = 0;

    const request = await supertest(app)
      .post("/api/auth/request-password-reset")
      .set("content-type", "application/json")
      .send({email: user.email});
    expect(request.status).toBe(200);
    const resetMails = mail.sent.filter((sent) => sent.subject === "Reset your password");
    expect(resetMails).toHaveLength(1);
    const token = resetTokenFrom(resetMails[0]);
    expect(token).not.toBe("");

    const reset = await supertest(app)
      .post("/api/auth/reset-password")
      .set("content-type", "application/json")
      .send({newPassword: NEW_PASSWORD, token});

    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({status: true});
    const signIn = await supertest(app)
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({email: user.email, password: NEW_PASSWORD});
    expect(signIn.status).toBe(200);
    expect((await signInWithPassword(app, user.email)).status).toBe(401);
    const appUser = await SecurityUser.findById(user.id);
    expect(appUser?.tokenEpoch).toBe(1);
    expect(await jwtPasswordMatches(user.id, NEW_PASSWORD)).toBe(true);
  });

  it("syncs the JWT hash for a direct auth.api.resetPassword call with no request", async () => {
    const mail = captureMail();
    const {app, betterAuthApp} = buildApp({config: mail.config});
    const user = await signUp(app, "direct-reset");
    mail.sent.length = 0;
    await supertest(app)
      .post("/api/auth/request-password-reset")
      .set("content-type", "application/json")
      .send({email: user.email})
      .expect(200);
    const token = resetTokenFrom(mail.sent[mail.sent.length - 1]);

    const result = await betterAuthApp.ensureAuth().api.resetPassword({
      body: {newPassword: NEW_PASSWORD, token},
    });

    expect(result).toEqual({status: true});
    expect((await SecurityUser.findById(user.id))?.tokenEpoch).toBe(1);
    expect(await jwtPasswordMatches(user.id, NEW_PASSWORD)).toBe(true);
  });

  it("refuses a reused reset token and leaves tokenEpoch alone", async () => {
    const mail = captureMail();
    const {app} = buildApp({config: mail.config});
    const user = await signUp(app, "http-reset-reuse");
    mail.sent.length = 0;
    await supertest(app)
      .post("/api/auth/request-password-reset")
      .set("content-type", "application/json")
      .send({email: user.email})
      .expect(200);
    const token = resetTokenFrom(mail.sent[mail.sent.length - 1]);
    await supertest(app)
      .post("/api/auth/reset-password")
      .set("content-type", "application/json")
      .send({newPassword: NEW_PASSWORD, token})
      .expect(200);

    const reuse = await supertest(app)
      .post("/api/auth/reset-password")
      .set("content-type", "application/json")
      .send({newPassword: "another-password-1", token});

    expect(reuse.status).toBe(400);
    expect((await SecurityUser.findById(user.id))?.tokenEpoch).toBe(1);
  });
});
