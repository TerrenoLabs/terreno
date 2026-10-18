import {beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import type express from "express";
import mongoose, {Schema} from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";
import supertest from "supertest";

import type {UserModel as AuthUserModel} from "./auth";
import {AuthToken} from "./authTokens";
import {TerrenoApp} from "./terrenoApp";
import {setupDb, UserModel} from "./tests";

interface CapturedMail {
  html?: string;
  subject: string;
  text: string;
  to: string;
}

const tokenFromVerifyUrl = (text: string): string => {
  const match = text.match(/token=([0-9a-f]+)/i);
  assert.isNotNull(match);
  return match?.[1] ?? "";
};

describe("email verification gating", () => {
  let gatedApp: express.Application;
  let openApp: express.Application;
  let gatedMail: CapturedMail[];
  let openMail: CapturedMail[];

  beforeEach(async () => {
    await setupDb();
    await AuthToken.deleteMany({});
    gatedMail = [];
    openMail = [];

    gatedApp = new TerrenoApp({
      authOptions: {
        publicAppUrl: "https://app.example.com",
        requireEmailVerification: true,
        sendMail: async (message) => {
          gatedMail.push(message);
        },
      },
      skipListen: true,
      userModel: UserModel,
    }).build();

    openApp = new TerrenoApp({
      authOptions: {
        publicAppUrl: "https://app.example.com",
        sendMail: async (message) => {
          openMail.push(message);
        },
      },
      skipListen: true,
      userModel: UserModel,
    }).build();
  });

  it("returns 403 email-not-verified on login when the user is unverified", async () => {
    const response = await supertest(gatedApp)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(403);
    assert.equal(response.body.code, "email-not-verified");
  });

  it("allows login when requireEmailVerification is off", async () => {
    await supertest(openApp)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(200);
  });

  it("lets an unverified user verify then login when gating is on", async () => {
    const signup = await supertest(gatedApp)
      .post("/auth/signup")
      .send({email: "new-verify@example.com", password: "password"})
      .expect(200);
    assert.isString(signup.body.data.token);
    assert.equal(gatedMail.length, 1);
    const token = tokenFromVerifyUrl(gatedMail[0]?.text ?? "");

    await supertest(gatedApp)
      .post("/auth/login")
      .send({
        email: "new-verify@example.com",
        password: "password",
      })
      .expect(403);

    await supertest(gatedApp).post("/auth/verifyEmail").send({token}).expect(200);

    await supertest(gatedApp)
      .post("/auth/login")
      .send({email: "new-verify@example.com", password: "password"})
      .expect(200);
  });

  it("does not issue an unusable verification token on signup when routes are disabled", async () => {
    const noVerificationRoutesApp = new TerrenoApp({
      authOptions: {
        emailVerification: false,
        publicAppUrl: "https://app.example.com",
        sendMail: async (message) => {
          openMail.push(message);
        },
      },
      skipListen: true,
      userModel: UserModel,
    }).build();

    await supertest(noVerificationRoutesApp)
      .post("/auth/signup")
      .send({email: "custom-verification@example.com", password: "password"})
      .expect(200);

    assert.equal(openMail.length, 0);
    assert.equal(await AuthToken.countDocuments({type: "emailVerification"}), 0);
  });

  it("resends verification mail for an authenticated unverified user", async () => {
    const login = await supertest(openApp)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(200);

    await supertest(openApp)
      .post("/auth/sendVerification")
      .set("Authorization", `Bearer ${login.body.data.token}`)
      .expect(202);
    assert.equal(openMail.length, 1);
    assert.include(openMail[0]?.text ?? "", "https://app.example.com/verifyEmail?token=");
  });

  it("returns a delivery error instead of reporting a false resend success", async () => {
    const failingApp = new TerrenoApp({
      authOptions: {
        publicAppUrl: "https://app.example.com",
        sendMail: async () => {
          throw new Error("delivery failed");
        },
      },
      skipListen: true,
      userModel: UserModel,
    }).build();
    const login = await supertest(failingApp)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(200);

    await supertest(failingApp)
      .post("/auth/sendVerification")
      .set("Authorization", `Bearer ${login.body.data.token}`)
      .expect(500);
  });

  it("returns 501 when resend cannot send because publicAppUrl is missing", async () => {
    const noUrlApp = new TerrenoApp({
      authOptions: {
        sendMail: async (message) => {
          openMail.push(message);
        },
      },
      skipListen: true,
      userModel: UserModel,
    }).build();
    const login = await supertest(noUrlApp)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(200);
    const before = await AuthToken.countDocuments({type: "emailVerification"});

    await supertest(noUrlApp)
      .post("/auth/sendVerification")
      .set("Authorization", `Bearer ${login.body.data.token}`)
      .expect(501);
    assert.equal(openMail.length, 0);
    assert.equal(await AuthToken.countDocuments({type: "emailVerification"}), before);
  });

  it("does not send verification mail when the user is already verified", async () => {
    const login = await supertest(openApp)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(200);
    const users = await UserModel.find({email: "notAdmin@example.com"});
    const user = users[0];
    assert.isNotNull(user);
    (user as {emailVerified?: boolean}).emailVerified = true;
    await user?.save();

    await supertest(openApp)
      .post("/auth/sendVerification")
      .set("Authorization", `Bearer ${login.body.data.token}`)
      .expect(202);
    assert.equal(openMail.length, 0);
  });

  it("rejects verifyEmail without a token and with an invalid token", async () => {
    await supertest(gatedApp).post("/auth/verifyEmail").send({}).expect(400);
    await supertest(gatedApp)
      .post("/auth/verifyEmail")
      .send({token: "not-a-real-token"})
      .expect(400);
  });

  it("requires authentication to resend verification", async () => {
    await supertest(openApp).post("/auth/sendVerification").expect(401);
  });

  it("returns 400 when the consumed verification token has no user", async () => {
    const orphanId = new mongoose.Types.ObjectId();
    const issued = await AuthToken.issueFor({_id: orphanId}, "emailVerification");
    await supertest(gatedApp).post("/auth/verifyEmail").send({token: issued.token}).expect(400);
  });

  it("rejects an old verification token after PATCH /auth/me changes the mailbox", async () => {
    const login = await supertest(openApp)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(200);
    const userId = login.body.data.userId as string;
    const accessToken = login.body.data.token as string;
    const issued = await AuthToken.issueFor({_id: userId}, "emailVerification");

    await supertest(openApp)
      .patch("/auth/me")
      .set("authorization", `Bearer ${accessToken}`)
      .send({email: "new-mailbox@example.com"})
      .expect(200);

    await supertest(openApp).post("/auth/verifyEmail").send({token: issued.token}).expect(400);

    const reloaded = await UserModel.findById(userId);
    assert.equal((reloaded as unknown as {emailVerified?: boolean})?.emailVerified, false);
  });

  it("rejects an old password-reset token after PATCH /auth/me changes the mailbox", async () => {
    const login = await supertest(openApp)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"})
      .expect(200);
    const userId = login.body.data.userId as string;
    const accessToken = login.body.data.token as string;
    const issued = await AuthToken.issueFor({_id: userId}, "passwordReset");

    await supertest(openApp)
      .patch("/auth/me")
      .set("authorization", `Bearer ${accessToken}`)
      .send({email: "new-mailbox@example.com"})
      .expect(200);

    await supertest(openApp)
      .post("/auth/resetPassword")
      .send({password: "brand-new-password", token: issued.token})
      .expect(400);
  });

  it("invalidates unused password-reset tokens on mailbox change without emailVerified", async () => {
    const jwtResetOnlySchema = new Schema({
      email: {type: String},
      tokenEpoch: {default: 0, type: Number},
    });
    jwtResetOnlySchema.plugin(
      passportLocalMongoose as unknown as (
        schema: Schema,
        options?: Record<string, unknown>
      ) => void,
      {
        usernameCaseInsensitive: true,
        usernameField: "email",
      }
    );
    const JwtResetOnlyUser = (mongoose.models.JwtResetOnlyUser ??
      mongoose.model("JwtResetOnlyUser", jwtResetOnlySchema)) as AuthUserModel;
    await JwtResetOnlyUser.deleteMany({});
    const registerable = JwtResetOnlyUser as unknown as {
      register: (
        user: {email: string},
        password: string
      ) => Promise<{_id: {toString: () => string}}>;
    };
    const user = await registerable.register({email: "reset-only@example.com"}, "password");
    const userId = String(user._id);
    const app = new TerrenoApp({
      authOptions: {
        publicAppUrl: "https://app.example.com",
        sendMail: async () => undefined,
      },
      skipListen: true,
      userModel: JwtResetOnlyUser,
    }).build();
    const login = await supertest(app)
      .post("/auth/login")
      .send({email: "reset-only@example.com", password: "password"})
      .expect(200);
    const accessToken = login.body.data.token as string;
    const issued = await AuthToken.issueFor({_id: userId}, "passwordReset");

    await supertest(app)
      .patch("/auth/me")
      .set("authorization", `Bearer ${accessToken}`)
      .send({email: "new-reset-only@example.com"})
      .expect(200);

    await supertest(app)
      .post("/auth/resetPassword")
      .send({password: "brand-new-password", token: issued.token})
      .expect(400);
    assert.equal(JwtResetOnlyUser.schema.path("emailVerified"), undefined);
  });
});
