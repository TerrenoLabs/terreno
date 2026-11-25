import {beforeEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import supertest from "supertest";

import {BetterAuthApp} from "./betterAuthApp";
import type {BetterAuthInstance} from "./betterAuthSetup";
import {
  findBetterAuthUserIdByEmail,
  isBetterAuthTwoFactorEnabled,
  matchBetterAuthTotpStep,
} from "./betterAuthTwoFactor";
import {TerrenoApp} from "./terrenoApp";
import {
  betterAuthIdFor,
  resetAccountSecurityState,
  SecurityUser,
  securityUserModel,
  testBetterAuthConfig,
} from "./tests/accountSecurityTestApp";
import {enrollTwoFactor, PASSWORD, totpCode, uniqueEmail} from "./tests/betterAuthStubs";

const buildApp = (): {app: ReturnType<TerrenoApp["build"]>; auth: BetterAuthInstance} => {
  const betterAuthApp = new BetterAuthApp({
    config: testBetterAuthConfig(),
    userModel: securityUserModel,
  });
  const app = new TerrenoApp({skipListen: true, userModel: securityUserModel})
    .register(betterAuthApp)
    .build();
  return {app, auth: betterAuthApp.getAuth() as BetterAuthInstance};
};

/** A six-digit code that differs from `code`. */
const otherCode = (code: string): string =>
  String((Number(code) + 500_000) % 1_000_000).padStart(6, "0");

describe("Better Auth two-factor seam", () => {
  let setup: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAccountSecurityState();
    setup = buildApp();
  });

  const enrolledUser = async (): Promise<{betterAuthId: string; email: string; secret: Buffer}> => {
    const email = uniqueEmail("seam");
    const {secret} = await enrollTwoFactor(setup.app, email);
    const appUser = await SecurityUser.findOne({email});
    return {betterAuthId: await betterAuthIdFor(String(appUser?._id)), email, secret};
  };

  const plainUser = async (): Promise<string> => {
    const email = uniqueEmail("seam-plain");
    const signUp = await supertest(setup.app)
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({email, name: "Plain", password: PASSWORD});
    expect(signUp.status).toBe(200);
    const appUser = await SecurityUser.findOne({email});
    return betterAuthIdFor(String(appUser?._id));
  };

  it("finds the Better Auth user id by email, and null for an unknown or empty email", async () => {
    const {betterAuthId, email} = await enrolledUser();

    expect(betterAuthId).not.toBe("");
    expect(await findBetterAuthUserIdByEmail(setup.auth, email)).toBe(betterAuthId);
    expect(await findBetterAuthUserIdByEmail(setup.auth, uniqueEmail("nobody"))).toBeNull();
    expect(await findBetterAuthUserIdByEmail(setup.auth, "")).toBeNull();
  });

  it("reports two-factor on only for an enrolled user", async () => {
    const {betterAuthId} = await enrolledUser();
    const plainId = await plainUser();

    expect(await isBetterAuthTwoFactorEnabled(setup.auth, betterAuthId)).toBe(true);
    expect(await isBetterAuthTwoFactorEnabled(setup.auth, plainId)).toBe(false);
    expect(await isBetterAuthTwoFactorEnabled(setup.auth, "missing-user")).toBe(false);
    expect(await isBetterAuthTwoFactorEnabled(setup.auth, "")).toBe(false);
  });

  it("matches the authenticator's current code to its time step", async () => {
    const {betterAuthId, secret} = await enrolledUser();
    const now = DateTime.now();
    const step = Math.floor(now.toSeconds() / 30);

    const matched = await matchBetterAuthTotpStep(setup.auth, betterAuthId, totpCode(secret), now);

    // totpCode reads the clock itself, so a step boundary between the two reads is one step off.
    expect([step, step + 1]).toContain(matched as number);
  });

  it("accepts one step of drift and refuses a code from further away", async () => {
    const {betterAuthId, secret} = await enrolledUser();
    const code = totpCode(secret);
    const now = DateTime.now();

    const oneStepLater = await matchBetterAuthTotpStep(
      setup.auth,
      betterAuthId,
      code,
      now.plus({seconds: 30})
    );
    const threeStepsLater = await matchBetterAuthTotpStep(
      setup.auth,
      betterAuthId,
      code,
      now.plus({seconds: 90})
    );

    expect(oneStepLater).not.toBeNull();
    expect(threeStepsLater).toBeNull();
  });

  it("refuses a wrong or malformed code, and a user with no authenticator", async () => {
    const {betterAuthId, secret} = await enrolledUser();
    const plainId = await plainUser();
    const code = totpCode(secret);

    expect(await matchBetterAuthTotpStep(setup.auth, betterAuthId, otherCode(code))).toBeNull();
    expect(await matchBetterAuthTotpStep(setup.auth, betterAuthId, `${code}0`)).toBeNull();
    expect(await matchBetterAuthTotpStep(setup.auth, betterAuthId, "12a456")).toBeNull();
    expect(await matchBetterAuthTotpStep(setup.auth, plainId, code)).toBeNull();
    expect(await matchBetterAuthTotpStep(setup.auth, "", code)).toBeNull();
  });
});
