import {describe, expect, it} from "bun:test";
import express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";
import type {BetterAuthConfig} from "./betterAuth";
import {AUTH_CHALLENGE_EMPTY, AUTH_CHALLENGE_HEADER} from "./betterAuthChallengeHeaders";
import {buildFeaturePlugins} from "./betterAuthFeatures";
import {
  createBetterAuth,
  getMongoClientFromMongoose,
  mountBetterAuthRoutes,
} from "./betterAuthSetup";
import {
  API_ORIGIN,
  cookieHeaderFrom,
  enrollTwoFactor,
  PASSWORD,
  SECRET,
  setCookies,
  totpCode,
  totpSecretFromURI,
  uniqueEmail,
} from "./tests/betterAuthStubs";
import {createSoftwareAuthenticator} from "./tests/softwareAuthenticator";

// Every request below is cookie-free, as a bearer-mode web client on another site sends it,
// unless a case says otherwise.

const RP_ID = "localhost";
const TWO_FACTOR_COOKIE = "better-auth.two_factor";
const TRUST_DEVICE_COOKIE = "better-auth.trust_device";
const PASSKEY_COOKIE = "better-auth.better-auth-passkey";
const SESSION_COOKIE = "better-auth.session_token";
const DONT_REMEMBER_COOKIE = "better-auth.dont_remember";

const buildApp = (overrides: Partial<BetterAuthConfig> = {}): express.Application => {
  const config: BetterAuthConfig = {
    baseURL: API_ORIGIN,
    enabled: true,
    passkey: {origin: [API_ORIGIN], rpID: RP_ID, rpName: "Terreno"},
    secret: SECRET,
    twoFactor: {issuer: "Terreno"},
    ...overrides,
  };
  const auth = createBetterAuth({config, mongoClient: getMongoClientFromMongoose()});
  const app = express();
  mountBetterAuthRoutes(app, auth, config.basePath);
  return app;
};

const challengeOf = (res: supertest.Response): URLSearchParams =>
  new URLSearchParams(String(res.headers[AUTH_CHALLENGE_HEADER.toLowerCase()] ?? ""));

const exposedHeaders = (res: supertest.Response): string[] =>
  String(res.headers["access-control-expose-headers"] ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase());

/** Merges a response's challenge header into what the client holds, as rtk does. */
const mergeChallenge = (held: string, res: supertest.Response): string => {
  const next = new URLSearchParams(held === AUTH_CHALLENGE_EMPTY ? "" : held);
  for (const [name, value] of challengeOf(res)) {
    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }
  }
  return next.size > 0 ? next.toString() : AUTH_CHALLENGE_EMPTY;
};

/** Whether a response's `set-auth-token` signs in. */
const isLiveToken = async (app: express.Application, res: supertest.Response): Promise<boolean> => {
  const token = res.headers["set-auth-token"];
  if (!token) {
    return false;
  }
  const session = await supertest(app)
    .get("/api/auth/get-session")
    .set("authorization", `Bearer ${token}`);
  return Boolean(session.body?.session);
};

const signIn = (
  app: express.Application,
  email: string,
  challenge: string = AUTH_CHALLENGE_EMPTY
): supertest.Test =>
  supertest(app)
    .post("/api/auth/sign-in/email")
    .set("content-type", "application/json")
    .set(AUTH_CHALLENGE_HEADER, challenge)
    .send({email, password: PASSWORD});

const verifyTotp = (
  app: express.Application,
  challenge: string,
  code: string,
  trustDevice = false
): supertest.Test =>
  supertest(app)
    .post("/api/auth/two-factor/verify-totp")
    .set("content-type", "application/json")
    .set(AUTH_CHALLENGE_HEADER, challenge)
    .send({code, trustDevice});

// Flips one character of the signed identifier, keeping the signature as it was.
const tamper = (challenge: string, name: string): string => {
  const pairs = new URLSearchParams(challenge);
  const value = pairs.get(name) ?? "";
  pairs.set(name, `${value[0] === "a" ? "b" : "a"}${value.slice(1)}`);
  return pairs.toString();
};

describe("cookie-free two-factor challenge", () => {
  it("sign-in returns the two-factor challenge in the header, exposed to the page", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-sign-in");
    await enrollTwoFactor(app, email);

    const res = await signIn(app, email);

    expect(res.status).toBe(200);
    expect(res.body.twoFactorRedirect).toBe(true);
    expect(challengeOf(res).get(TWO_FACTOR_COOKIE)).toBeTruthy();
    expect(Array.from(challengeOf(res).keys())).toEqual([TWO_FACTOR_COOKIE]);
    expect(exposedHeaders(res)).toContain(AUTH_CHALLENGE_HEADER.toLowerCase());
    // bearer()'s hook ran before two-factor deleted that session; its dead token is dropped.
    expect(res.headers["set-auth-token"]).toBeUndefined();
  });

  it("verify-totp succeeds with only the header and returns a bearer token", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-verify");
    const {secret} = await enrollTwoFactor(app, email);
    const signInRes = await signIn(app, email);
    const challenge = mergeChallenge(AUTH_CHALLENGE_EMPTY, signInRes);

    const verify = await verifyTotp(app, challenge, totpCode(secret));

    expect(verify.status).toBe(200);
    const token = verify.headers["set-auth-token"] as string;
    expect(token).toBeTruthy();
    // The spent challenge comes back empty, so the client forgets it.
    expect(challengeOf(verify).get(TWO_FACTOR_COOKIE)).toBe("");
    expect(exposedHeaders(verify)).toEqual(
      expect.arrayContaining(["set-auth-token", AUTH_CHALLENGE_HEADER.toLowerCase()])
    );
    const session = await supertest(app)
      .get("/api/auth/get-session")
      .set("authorization", `Bearer ${token}`);
    expect(session.body.user.email).toBe(email);
  });

  it("refuses a tampered challenge with 401", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-tamper");
    const {secret} = await enrollTwoFactor(app, email);
    const challenge = mergeChallenge(AUTH_CHALLENGE_EMPTY, await signIn(app, email));

    const verify = await verifyTotp(app, tamper(challenge, TWO_FACTOR_COOKIE), totpCode(secret));

    expect(verify.status).toBe(401);
    expect(await isLiveToken(app, verify)).toBe(false);
  });

  it("refuses verify-totp with no header and no cookie", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-missing");
    const {secret} = await enrollTwoFactor(app, email);
    await signIn(app, email);

    const verify = await supertest(app)
      .post("/api/auth/two-factor/verify-totp")
      .set("content-type", "application/json")
      .send({code: totpCode(secret)});

    expect(verify.status).toBe(401);
  });

  it("lets a real cookie win over the header", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-cookie-wins");
    const {secret} = await enrollTwoFactor(app, email);
    const signInRes = await signIn(app, email);
    const challenge = mergeChallenge(AUTH_CHALLENGE_EMPTY, signInRes);

    const verify = await supertest(app)
      .post("/api/auth/two-factor/verify-totp")
      .set("content-type", "application/json")
      .set("cookie", cookieHeaderFrom(signInRes))
      .set(AUTH_CHALLENGE_HEADER, tamper(challenge, TWO_FACTOR_COOKIE))
      .send({code: totpCode(secret)});

    expect(verify.status).toBe(200);
  });

  it("never sends the header to a client that did not ask for it", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-cookie-client");
    await enrollTwoFactor(app, email);

    const res = await supertest(app)
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .send({email, password: PASSWORD});

    expect(res.body.twoFactorRedirect).toBe(true);
    expect(setCookies(res).some((cookie) => cookie.startsWith(`${TWO_FACTOR_COOKIE}=`))).toBe(true);
    expect(res.headers[AUTH_CHALLENGE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("never turns the header into a session cookie", async () => {
    const app = buildApp();
    const signUp = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({email: uniqueEmail("challenge-no-session"), name: "Session", password: PASSWORD});
    const signedSession = signUp.headers["set-auth-token"] as string;
    const asBearer = await supertest(app)
      .get("/api/auth/passkey/list-user-passkeys")
      .set("authorization", `Bearer ${signedSession}`);
    expect(asBearer.status).toBe(200);

    const res = await supertest(app)
      .get("/api/auth/passkey/list-user-passkeys")
      .set(
        AUTH_CHALLENGE_HEADER,
        new URLSearchParams({[SESSION_COOKIE]: signedSession}).toString()
      );

    expect(res.status).toBe(401);
  });

  it("keeps a rememberMe: false sign-in short-lived through the header", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-dont-remember");
    const {secret} = await enrollTwoFactor(app, email);
    const signInRes = await supertest(app)
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .set(AUTH_CHALLENGE_HEADER, AUTH_CHALLENGE_EMPTY)
      .send({email, password: PASSWORD, rememberMe: false});
    const challenge = mergeChallenge(AUTH_CHALLENGE_EMPTY, signInRes);
    expect(Array.from(new URLSearchParams(challenge).keys()).sort()).toEqual([
      DONT_REMEMBER_COOKIE,
      TWO_FACTOR_COOKIE,
    ]);

    const verify = await verifyTotp(app, challenge, totpCode(secret));

    expect(verify.status).toBe(200);
    // Read from the store: a bearer get-session carries no dont_remember cookie, so Better Auth
    // would refresh the session to the full seven days.
    const session = await mongoose.connection.db
      ?.collection("session")
      .findOne({token: verify.body.token});
    const expiresInHours = DateTime.fromJSDate(session?.expiresAt).diffNow("hours").as("hours");
    // Better Auth's short session lasts one day; a remembered one lasts seven.
    expect(expiresInHours).toBeGreaterThan(23);
    expect(expiresInHours).toBeLessThanOrEqual(24);
  });

  it("carries dont_remember only with a two-factor challenge", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-no-2fa");
    const signUp = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({email, name: "No 2FA", password: PASSWORD});
    expect(signUp.status).toBe(200);

    const res = await supertest(app)
      .post("/api/auth/sign-in/email")
      .set("content-type", "application/json")
      .set(AUTH_CHALLENGE_HEADER, AUTH_CHALLENGE_EMPTY)
      .send({email, password: PASSWORD, rememberMe: false});

    expect(res.status).toBe(200);
    expect(res.headers[AUTH_CHALLENGE_HEADER.toLowerCase()]).toBeUndefined();
    expect(await isLiveToken(app, res)).toBe(true);
  });

  it("works under a custom basePath", async () => {
    const app = buildApp({basePath: "/auth"});
    const email = uniqueEmail("challenge-base-path");
    const signUp = await supertest(app)
      .post("/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({email, name: "Base Path", password: PASSWORD});
    expect(signUp.status).toBe(200);
    const bearer = `Bearer ${signUp.body.token}`;
    const enable = await supertest(app)
      .post("/auth/two-factor/enable")
      .set("authorization", bearer)
      .set("content-type", "application/json")
      .send({password: PASSWORD});
    const secret = totpSecretFromURI(enable.body.totpURI);
    const confirm = await supertest(app)
      .post("/auth/two-factor/verify-totp")
      .set("authorization", bearer)
      .set("content-type", "application/json")
      .send({code: totpCode(secret)});
    expect(confirm.status).toBe(200);
    const signInRes = await supertest(app)
      .post("/auth/sign-in/email")
      .set("content-type", "application/json")
      .set(AUTH_CHALLENGE_HEADER, AUTH_CHALLENGE_EMPTY)
      .send({email, password: PASSWORD});
    expect(signInRes.body.twoFactorRedirect).toBe(true);

    const verify = await supertest(app)
      .post("/auth/two-factor/verify-totp")
      .set("content-type", "application/json")
      .set(AUTH_CHALLENGE_HEADER, mergeChallenge(AUTH_CHALLENGE_EMPTY, signInRes))
      .send({code: totpCode(secret)});

    expect(verify.status).toBe(200);
    expect(verify.headers["set-auth-token"]).toBeTruthy();
  });
});

describe("cookie-free trusted device", () => {
  it("a trusted device skips the challenge on the next sign-in when it sends the trust value", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-trust");
    const {secret} = await enrollTwoFactor(app, email);
    let held = mergeChallenge(AUTH_CHALLENGE_EMPTY, await signIn(app, email));
    const verify = await verifyTotp(app, held, totpCode(secret), true);
    expect(verify.status).toBe(200);
    held = mergeChallenge(held, verify);
    expect(Array.from(new URLSearchParams(held).keys())).toEqual([TRUST_DEVICE_COOKIE]);

    const trusted = await signIn(app, email, held);

    expect(trusted.status).toBe(200);
    expect(trusted.body.twoFactorRedirect).toBeUndefined();
    expect(await isLiveToken(app, trusted)).toBe(true);
    // Better Auth rotates the trust token on each use; the client keeps the new one.
    const rotated = challengeOf(trusted).get(TRUST_DEVICE_COOKIE);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(new URLSearchParams(held).get(TRUST_DEVICE_COOKIE));

    const untrusted = await signIn(app, email);
    expect(untrusted.body.twoFactorRedirect).toBe(true);
  });

  it("asks for the second factor when the trust value is tampered", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-trust-tamper");
    const {secret} = await enrollTwoFactor(app, email);
    let held = mergeChallenge(AUTH_CHALLENGE_EMPTY, await signIn(app, email));
    held = mergeChallenge(held, await verifyTotp(app, held, totpCode(secret), true));

    const res = await signIn(app, email, tamper(held, TRUST_DEVICE_COOKIE));

    expect(res.body.twoFactorRedirect).toBe(true);
    expect(res.headers["set-auth-token"]).toBeUndefined();
  });
});

describe("cookie-free passkey ceremonies", () => {
  it("registers a passkey and signs in with it using only the header and the bearer", async () => {
    const app = buildApp();
    const email = uniqueEmail("challenge-passkey");
    const signUp = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({email, name: "Passkey", password: PASSWORD});
    expect(signUp.status).toBe(200);
    const bearer = `Bearer ${signUp.headers["set-auth-token"]}`;
    const authenticator = createSoftwareAuthenticator({origin: API_ORIGIN, rpID: RP_ID});

    const registerOptions = await supertest(app)
      .get("/api/auth/passkey/generate-register-options")
      .set("authorization", bearer)
      .set(AUTH_CHALLENGE_HEADER, AUTH_CHALLENGE_EMPTY);
    expect(registerOptions.status).toBe(200);
    const registerChallenge = mergeChallenge(AUTH_CHALLENGE_EMPTY, registerOptions);
    expect(Array.from(new URLSearchParams(registerChallenge).keys())).toEqual([PASSKEY_COOKIE]);

    // Needs the session (from the bearer) and the challenge (from the header) together.
    const registered = await supertest(app)
      .post("/api/auth/passkey/verify-registration")
      .set("authorization", bearer)
      .set("content-type", "application/json")
      .set(AUTH_CHALLENGE_HEADER, registerChallenge)
      .send({name: "Laptop", response: authenticator.register(registerOptions.body)});
    expect(registered.status).toBe(200);
    expect(registered.body.name).toBe("Laptop");

    const authenticateOptions = await supertest(app)
      .get("/api/auth/passkey/generate-authenticate-options")
      .set(AUTH_CHALLENGE_HEADER, AUTH_CHALLENGE_EMPTY);
    expect(authenticateOptions.status).toBe(200);
    const signInChallenge = mergeChallenge(AUTH_CHALLENGE_EMPTY, authenticateOptions);

    const signedIn = await supertest(app)
      .post("/api/auth/passkey/verify-authentication")
      .set("content-type", "application/json")
      .set(AUTH_CHALLENGE_HEADER, signInChallenge)
      .send({response: authenticator.authenticate(authenticateOptions.body)});

    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.email).toBe(email);
    const token = signedIn.headers["set-auth-token"] as string;
    expect(token).toBeTruthy();
    const session = await supertest(app)
      .get("/api/auth/get-session")
      .set("authorization", `Bearer ${token}`);
    expect(session.body.user.email).toBe(email);
  });

  it("refuses passkey sign-in without the challenge header", async () => {
    const app = buildApp();
    const authenticator = createSoftwareAuthenticator({origin: API_ORIGIN, rpID: RP_ID});
    const options = await supertest(app).get("/api/auth/passkey/generate-authenticate-options");

    const res = await supertest(app)
      .post("/api/auth/passkey/verify-authentication")
      .set("content-type", "application/json")
      .send({response: authenticator.authenticate(options.body)});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CHALLENGE_NOT_FOUND");
  });

  it("refuses a tampered passkey challenge", async () => {
    const app = buildApp();
    const authenticator = createSoftwareAuthenticator({origin: API_ORIGIN, rpID: RP_ID});
    const options = await supertest(app)
      .get("/api/auth/passkey/generate-authenticate-options")
      .set(AUTH_CHALLENGE_HEADER, AUTH_CHALLENGE_EMPTY);
    const challenge = mergeChallenge(AUTH_CHALLENGE_EMPTY, options);

    const res = await supertest(app)
      .post("/api/auth/passkey/verify-authentication")
      .set("content-type", "application/json")
      .set(AUTH_CHALLENGE_HEADER, tamper(challenge, PASSKEY_COOKIE))
      .send({response: authenticator.authenticate(options.body)});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CHALLENGE_NOT_FOUND");
  });
});

describe("challenge headers plugin wiring", () => {
  it("is added with two-factor alone and with passkeys alone", () => {
    const ids = (config: Partial<BetterAuthConfig>): string[] =>
      buildFeaturePlugins({enabled: true, ...config}).map((plugin) => plugin.id);
    expect(ids({twoFactor: {issuer: "Terreno"}})).toEqual([
      "two-factor",
      "terreno-challenge-headers",
    ]);
    expect(ids({passkey: {origin: [API_ORIGIN], rpID: RP_ID, rpName: "Terreno"}})).toEqual([
      "passkey",
      "terreno-challenge-headers",
    ]);
    expect(ids({})).toEqual([]);
  });

  it("adds the challenge header only when two-factor or passkeys are on", async () => {
    const app = buildApp({passkey: undefined, twoFactor: undefined});
    const email = uniqueEmail("challenge-off");

    const res = await supertest(app)
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .set(AUTH_CHALLENGE_HEADER, AUTH_CHALLENGE_EMPTY)
      .send({email, name: "Off", password: PASSWORD});

    expect(res.status).toBe(200);
    expect(res.headers[AUTH_CHALLENGE_HEADER.toLowerCase()]).toBeUndefined();
  });
});
