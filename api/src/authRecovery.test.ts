import {beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import type express from "express";
import mongoose from "mongoose";
import supertest from "supertest";

import {MAX_PASSWORD_LENGTH} from "./auth";
import {AuthToken} from "./authTokens";
import {TerrenoApp} from "./terrenoApp";
import {setupDb, UserModel} from "./tests";

interface CapturedMail {
  html?: string;
  subject: string;
  text: string;
  to: string;
}

const tokenFromResetUrl = (text: string): string => {
  const match = text.match(/token=([0-9a-f]+)/i);
  assert.isNotNull(match);
  return match?.[1] ?? "";
};

describe("password reset routes", () => {
  let app: express.Application;
  let sentMail: CapturedMail[];

  beforeEach(async () => {
    await setupDb();
    await AuthToken.deleteMany({});
    sentMail = [];

    app = new TerrenoApp({
      authOptions: {
        publicAppUrl: "https://app.example.com",
        sendMail: async (message) => {
          sentMail.push(message);
        },
      },
      skipListen: true,
      userModel: UserModel,
    }).build();
  });

  it("returns 202 for existing and missing emails and only mails existing users", async () => {
    const existing = await supertest(app)
      .post("/auth/forgotPassword")
      .send({email: "notAdmin@example.com"})
      .expect(202);
    const missing = await supertest(app)
      .post("/auth/forgotPassword")
      .send({email: "nobody@example.com"})
      .expect(202);

    assert.deepEqual(existing.body, missing.body);
    assert.equal(sentMail.length, 1);
    assert.equal(sentMail[0]?.to, "notAdmin@example.com");
    assert.include(sentMail[0]?.text ?? "", "https://app.example.com/resetPassword?token=");
  });

  it("finds an existing user email case-insensitively", async () => {
    const users = await UserModel.find({email: "notAdmin@example.com"});
    const user = users[0];
    assert.isDefined(user);
    if (!user) {
      return;
    }
    user.email = "Mixed.Case@Example.com";
    await user.save();

    await supertest(app)
      .post("/auth/forgotPassword")
      .send({email: "mixed.case@example.com"})
      .expect(202);

    assert.equal(sentMail.length, 1);
    assert.equal(sentMail[0]?.to, "Mixed.Case@Example.com");
  });

  it("resets the password once, then rejects the token and old refresh tokens", async () => {
    const login = await supertest(app)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(200);
    const oldRefresh = login.body.data.refreshToken as string;

    await supertest(app)
      .post("/auth/forgotPassword")
      .send({email: "notAdmin@example.com"})
      .expect(202);
    const token = tokenFromResetUrl(sentMail[0]?.text ?? "");

    const reset = await supertest(app)
      .post("/auth/resetPassword")
      .send({password: "new-password-123", token})
      .expect(200);
    assert.isString(reset.body.data.token);

    await supertest(app)
      .post("/auth/resetPassword")
      .send({password: "another-password", token})
      .expect(400);

    await supertest(app)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(401);
    await supertest(app)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "new-password-123"})
      .expect(200);

    const refresh = await supertest(app)
      .post("/auth/refresh_token")
      .send({refreshToken: oldRefresh})
      .expect(401);
    assert.equal(refresh.body.message, "Invalid refresh token");
  });

  it("honors the RTK client POST /resetPassword path and body shape", async () => {
    await supertest(app)
      .post("/auth/forgotPassword")
      .send({email: "notAdmin@example.com"})
      .expect(202);
    const token = tokenFromResetUrl(sentMail[0]?.text ?? "");

    await supertest(app)
      .post("/resetPassword")
      .send({
        _id: "unused",
        email: "notAdmin@example.com",
        newPassword: "rtk-new-password",
        oldPassword: "password",
        password: "rtk-new-password",
        token,
      })
      .expect(200);

    await supertest(app)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "rtk-new-password"})
      .expect(200);
  });

  it("can disable only the legacy POST /resetPassword alias", async () => {
    const noLegacyAliasApp = new TerrenoApp({
      authOptions: {
        legacyResetPasswordRoute: false,
        publicAppUrl: "https://app.example.com",
      },
      skipListen: true,
      userModel: UserModel,
    }).build();

    await supertest(noLegacyAliasApp).post("/resetPassword").send({}).expect(404);
    await supertest(noLegacyAliasApp).post("/auth/resetPassword").send({}).expect(400);
  });

  it("can disable all password reset routes", async () => {
    const noPasswordResetApp = new TerrenoApp({
      authOptions: {
        passwordReset: false,
        publicAppUrl: "https://app.example.com",
      },
      skipListen: true,
      userModel: UserModel,
    }).build();

    await supertest(noPasswordResetApp).post("/auth/forgotPassword").send({}).expect(404);
    await supertest(noPasswordResetApp).post("/auth/resetPassword").send({}).expect(404);
    await supertest(noPasswordResetApp).post("/resetPassword").send({}).expect(404);
  });

  it("can disable all email verification routes", async () => {
    const noEmailVerificationApp = new TerrenoApp({
      authOptions: {
        emailVerification: false,
        publicAppUrl: "https://app.example.com",
      },
      skipListen: true,
      userModel: UserModel,
    }).build();

    await supertest(noEmailVerificationApp).post("/auth/sendVerification").send({}).expect(404);
    await supertest(noEmailVerificationApp).post("/auth/verifyEmail").send({}).expect(404);
  });

  it("syncs a successful JWT reset to Better Auth when a bridge is configured", async () => {
    const synced: Array<{email?: string; password: string}> = [];
    const bridgedApp = new TerrenoApp({
      authOptions: {
        publicAppUrl: "https://app.example.com",
        sendMail: async (message) => {
          sentMail.push(message);
        },
        syncPasswordResetToBetterAuth: async (user, password) => {
          synced.push({email: (user as {email?: string}).email, password});
        },
      },
      skipListen: true,
      userModel: UserModel,
    }).build();

    await supertest(bridgedApp)
      .post("/auth/forgotPassword")
      .send({email: "notAdmin@example.com"})
      .expect(202);
    const token = tokenFromResetUrl(sentMail[sentMail.length - 1]?.text ?? "");

    await supertest(bridgedApp)
      .post("/auth/resetPassword")
      .send({password: "bridged-password-123", token})
      .expect(200);

    assert.equal(synced.length, 1);
    assert.equal(synced[0]?.email, "notAdmin@example.com");
    assert.equal(synced[0]?.password, "bridged-password-123");
  });

  it("does not consume a reset token when the new password is too long", async () => {
    await supertest(app)
      .post("/auth/forgotPassword")
      .send({email: "notAdmin@example.com"})
      .expect(202);
    const token = tokenFromResetUrl(sentMail[0]?.text ?? "");

    await supertest(app)
      .post("/auth/resetPassword")
      .send({password: "x".repeat(MAX_PASSWORD_LENGTH + 1), token})
      .expect(400);

    await supertest(app)
      .post("/auth/resetPassword")
      .send({password: "valid-after-too-long", token})
      .expect(200);
  });

  it("accepts newPassword when password is omitted", async () => {
    await supertest(app)
      .post("/auth/forgotPassword")
      .send({email: "notAdmin@example.com"})
      .expect(202);
    const token = tokenFromResetUrl(sentMail[0]?.text ?? "");

    await supertest(app)
      .post("/auth/resetPassword")
      .send({newPassword: "only-new-password", token})
      .expect(200);
  });

  it("returns 202 without issuing a token when publicAppUrl is missing", async () => {
    const noUrlApp = new TerrenoApp({
      authOptions: {
        sendMail: async (message) => {
          sentMail.push(message);
        },
      },
      skipListen: true,
      userModel: UserModel,
    }).build();
    const before = await AuthToken.countDocuments({});
    await supertest(noUrlApp)
      .post("/auth/forgotPassword")
      .send({email: "notAdmin@example.com"})
      .expect(202);
    assert.equal(sentMail.length, 0);
    assert.equal(await AuthToken.countDocuments({}), before);
  });

  it("returns 202 for a non-string email and for a missing body", async () => {
    await supertest(app).post("/auth/forgotPassword").send({email: 12}).expect(202);
    await supertest(app).post("/auth/forgotPassword").send({}).expect(202);
    assert.equal(sentMail.length, 0);
  });

  it("rejects reset without a token or password", async () => {
    await supertest(app).post("/auth/resetPassword").send({password: "enough-chars"}).expect(400);
    await supertest(app).post("/auth/resetPassword").send({token: "deadbeef"}).expect(400);
  });

  it("returns 400 when the consumed reset token has no user", async () => {
    const orphanId = new mongoose.Types.ObjectId();
    const issued = await AuthToken.issueFor({_id: orphanId}, "passwordReset");
    await supertest(app)
      .post("/auth/resetPassword")
      .send({password: "valid-password", token: issued.token})
      .expect(400);
  });

  it("logs recovery mail to the console when sendMail is unset outside production", async () => {
    const consoleApp = new TerrenoApp({
      authOptions: {
        publicAppUrl: "https://app.example.com",
      },
      skipListen: true,
      userModel: UserModel,
    }).build();
    await supertest(consoleApp)
      .post("/auth/forgotPassword")
      .send({email: "notAdmin@example.com"})
      .expect(202);
  });

  it("still returns 202 when production mail is unset", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const consoleApp = new TerrenoApp({
        authOptions: {
          publicAppUrl: "https://app.example.com",
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      await supertest(consoleApp)
        .post("/auth/forgotPassword")
        .send({email: "notAdmin@example.com"})
        .expect(202);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
