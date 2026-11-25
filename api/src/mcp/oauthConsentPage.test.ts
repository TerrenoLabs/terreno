import {beforeEach, describe, expect, it} from "bun:test";
import {createHash, randomBytes} from "node:crypto";
import type express from "express";
import {DateTime} from "luxon";
import mongoose, {model, Schema} from "mongoose";
import supertest from "supertest";

import {modelRouter} from "../api";
import {BetterAuthApp} from "../betterAuthApp";
import {McpOAuthAuthorization} from "../models/mcpOAuthAuthorization";
import {McpOAuthClient} from "../models/mcpOAuthClient";
import {McpOAuthConsentAttempt} from "../models/mcpOAuthConsentAttempt";
import {McpOAuthToken} from "../models/mcpOAuthToken";
import {Permissions} from "../permissions";
import {TerrenoApp} from "../terrenoApp";
import {
  resetAccountSecurityState,
  SecurityUser,
  securityUserModel,
  testBetterAuthConfig,
} from "../tests/accountSecurityTestApp";
import {enrollTwoFactor, PASSWORD, totpCode, uniqueEmail} from "../tests/betterAuthStubs";
import type {McpOAuthConsentOption, McpOAuthOptions} from "./oauthMetadata";
import {clearMCPRegistry} from "./registry";

const ISSUER = "https://api.example.com";
const CLAUDE_AI = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const claudeDocument = {
  client_id: CLAUDE_AI,
  client_name: "Claude <b>",
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: "none",
};

const noteSchema = new Schema({title: {description: "Note title", type: String}});
const ConsentPageNote =
  (mongoose.models.ConsentPageNote as mongoose.Model<{title?: string}> | undefined) ??
  model<{title?: string}>("ConsentPageNote", noteSchema);

const noteRouter = () =>
  modelRouter("/consent-page-notes", ConsentPageNote, {
    collectionActions: {
      whoami: {
        handler: async ({user}) => ({userId: String(user?._id)}),
        mcp: {name: "consent_page_whoami"},
        method: "GET",
        permissions: [Permissions.IsAuthenticated],
      },
    },
    permissions: {
      create: [],
      delete: [],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsAuthenticated],
      update: [],
    },
  });

const buildApp = (
  consent: McpOAuthConsentOption = {mode: "builtin", requireAdmin: true}
): express.Application => {
  const mcpOAuth: McpOAuthOptions = {
    clientIdMetadataDocuments: {
      allowedClientIds: [CLAUDE_AI],
      fetch: async () =>
        new Response(JSON.stringify(claudeDocument), {
          headers: {"content-type": "application/json"},
          status: 200,
        }),
    },
    consent,
    enabled: true,
    issuer: ISSUER,
  };
  return new TerrenoApp({mcpOAuth, skipListen: true, userModel: securityUserModel})
    .register(new BetterAuthApp({config: testBetterAuthConfig(), userModel: securityUserModel}))
    .register(noteRouter())
    .build();
};

const createPkce = (): {challenge: string; verifier: string} => {
  const verifier = randomBytes(32).toString("base64url");
  return {challenge: createHash("sha256").update(verifier).digest("base64url"), verifier};
};

/** Start an authorization as Claude; returns the consent page path and the PKCE verifier. */
const authorize = async (
  app: express.Application
): Promise<{location: string; path: string; verifier: string}> => {
  const {challenge, verifier} = createPkce();
  const res = await supertest(app).get("/oauth/authorize").query({
    client_id: CLAUDE_AI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    state: "page-state",
  });
  expect(res.status).toBe(302);
  const location = res.headers.location as string;
  return {location, path: new URL(location).pathname, verifier};
};

interface Owner {
  email: string;
  secret: Buffer;
}

/** A user with a password and an enrolled authenticator, made admin unless told otherwise. */
const createOwner = async (app: express.Application, admin = true): Promise<Owner> => {
  const email = uniqueEmail("owner");
  const {secret} = await enrollTwoFactor(app, email);
  if (admin) {
    await SecurityUser.updateOne({email}, {$set: {admin: true}});
  }
  return {email, secret};
};

/** A six-digit code no step in the drift window produces. */
const wrongCode = (secret: Buffer): string => {
  const right = totpCode(secret);
  return String((Number(right) + 500_000) % 1_000_000).padStart(6, "0");
};

const submit = (
  app: express.Application,
  path: string,
  form: Record<string, string>
): supertest.Test => supertest(app).post(path).type("form").send(form);

const approveAs = (
  app: express.Application,
  path: string,
  owner: Owner,
  overrides: Record<string, string> = {}
): supertest.Test =>
  submit(app, path, {
    decision: "approve",
    email: owner.email,
    password: PASSWORD,
    totp: totpCode(owner.secret),
    ...overrides,
  });

const exchange = (app: express.Application, code: string, verifier: string): supertest.Test =>
  supertest(app).post("/oauth/token").type("form").send({
    client_id: CLAUDE_AI,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  });

describe("MCP OAuth built-in consent page", () => {
  let app: express.Application;

  beforeEach(async () => {
    await resetAccountSecurityState();
    await Promise.all([
      McpOAuthAuthorization.deleteMany({}),
      McpOAuthClient.deleteMany({}),
      McpOAuthConsentAttempt.deleteMany({}),
      McpOAuthToken.deleteMany({}),
    ]);
    clearMCPRegistry();
    app = buildApp();
  });

  describe("page", () => {
    it("authorize sends the browser to the built-in page on the issuer", async () => {
      const {location} = await authorize(app);

      expect(location).toStartWith(`${ISSUER}/oauth/consent/`);
    });

    it("renders the request with a strict CSP that allows the redirect origin, and no-store", async () => {
      const {path} = await authorize(app);

      const res = await supertest(app).get(path);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["content-security-policy"]).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai; frame-ancestors 'none'"
      );
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.text).toContain("Allow Claude &lt;b&gt;?");
      expect(res.text).not.toContain("Claude <b>");
      expect(res.text).toContain("claude.ai");
      expect(res.text).toContain('name="totp"');
      expect(res.text).toContain(`action="${path}"`);
    });

    it("answers an unknown request with a 400 page and no redirect", async () => {
      const res = await supertest(app).get("/oauth/consent/not-a-real-request");

      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.text).toContain("Authorization request not found");
    });
  });

  describe("approve", () => {
    it("redirects with code, state, and iss for the right email, password, and code; the code exchanges", async () => {
      const owner = await createOwner(app);
      const {path, verifier} = await authorize(app);

      const res = await approveAs(app, path, owner);

      expect(res.status).toBe(302);
      expect(res.headers["cache-control"]).toBe("no-store");
      const redirect = new URL(res.headers.location);
      expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT_URI);
      expect(redirect.searchParams.get("state")).toBe("page-state");
      expect(redirect.searchParams.get("iss")).toBe(ISSUER);
      const tokens = await exchange(app, redirect.searchParams.get("code") as string, verifier);
      expect(tokens.status).toBe(200);
      expect(tokens.body.access_token).toStartWith("mcpat_");
    });

    it("accepts the email in any case", async () => {
      const owner = await createOwner(app);
      const {path} = await authorize(app);

      const res = await approveAs(app, path, owner, {email: owner.email.toUpperCase()});

      expect(res.status).toBe(302);
    });

    const refusals: [string, (owner: Owner) => Record<string, string>][] = [
      ["a wrong password", () => ({password: "not-the-password"})],
      ["a wrong code", (owner) => ({totp: wrongCode(owner.secret)})],
      ["an unknown email", () => ({email: uniqueEmail("stranger")})],
      ["a code that is not six digits", () => ({totp: "12345"})],
    ];
    for (const [label, overrides] of refusals) {
      it(`refuses ${label} with a 400 page and issues no code`, async () => {
        const owner = await createOwner(app);
        const {path} = await authorize(app);

        const res = await approveAs(app, path, owner, overrides(owner));

        expect(res.status).toBe(400);
        expect(res.headers.location).toBeUndefined();
        expect(res.text).toContain("Wrong email, password, or authenticator code.");
        const pending = await McpOAuthAuthorization.findOneOrNone({});
        expect(pending?.status).toBe("pending");
        expect(pending?.codeHash).toBeUndefined();
      });
    }

    it("refuses a code that was already used", async () => {
      const owner = await createOwner(app);
      const code = totpCode(owner.secret);
      const first = await authorize(app);
      const second = await authorize(app);

      const used = await approveAs(app, first.path, owner, {totp: code});
      const replayed = await approveAs(app, second.path, owner, {totp: code});

      expect(used.status).toBe(302);
      expect(replayed.status).toBe(400);
      expect(replayed.headers.location).toBeUndefined();
      expect(replayed.text).toContain("Wrong email, password, or authenticator code.");
    });

    it("locks consent after five failures in 15 minutes, even with the right credentials", async () => {
      const owner = await createOwner(app);
      const {path} = await authorize(app);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failed = await approveAs(app, path, owner, {password: "wrong-password"});
        expect(failed.status).toBe(400);
      }

      const locked = await approveAs(app, path, owner);

      expect(locked.status).toBe(400);
      expect(locked.headers.location).toBeUndefined();
      expect(locked.text).toContain("Too many failed attempts. Try again in 15 minutes.");
    });

    it("counts only the last 15 minutes of failures", async () => {
      const owner = await createOwner(app);
      const {path} = await authorize(app);
      const old = DateTime.now().minus({minutes: 16}).toJSDate();
      await McpOAuthConsentAttempt.collection.insertMany(
        Array.from({length: 5}, () => ({
          created: old,
          expiresAt: DateTime.now().plus({minutes: 1}).toJSDate(),
          key: owner.email,
          kind: "failure",
        }))
      );

      const res = await approveAs(app, path, owner);

      expect(res.status).toBe(302);
    });

    it("refuses a non-admin with valid credentials when requireAdmin is set", async () => {
      const owner = await createOwner(app, false);
      const {path} = await authorize(app);

      const res = await approveAs(app, path, owner);

      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
      expect(res.text).toContain("Only an admin can approve this connection.");
      expect((await McpOAuthAuthorization.findOneOrNone({}))?.status).toBe("pending");
    });

    it("lets a non-admin approve when requireAdmin is not set", async () => {
      const openApp = buildApp({mode: "builtin"});
      const owner = await createOwner(openApp, false);
      const {path} = await authorize(openApp);

      const res = await approveAs(openApp, path, owner);

      expect(res.status).toBe(302);
    });

    it("refuses a user with a password but no authenticator", async () => {
      const email = uniqueEmail("no-2fa");
      const signUp = await supertest(app)
        .post("/api/auth/sign-up/email")
        .set("content-type", "application/json")
        .send({email, name: "No 2FA", password: PASSWORD});
      expect(signUp.status).toBe(200);
      await SecurityUser.updateOne({email}, {$set: {admin: true}});
      const {path} = await authorize(app);

      const res = await submit(app, path, {
        decision: "approve",
        email,
        password: PASSWORD,
        totp: "123456",
      });

      expect(res.status).toBe(400);
      expect(res.text).toContain("Wrong email, password, or authenticator code.");
    });
  });

  describe("deny and bad requests", () => {
    it("deny redirects with error=access_denied and state", async () => {
      const {path} = await authorize(app);

      const res = await submit(app, path, {decision: "deny"});

      expect(res.status).toBe(302);
      const redirect = new URL(res.headers.location);
      expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT_URI);
      expect(redirect.searchParams.get("error")).toBe("access_denied");
      expect(redirect.searchParams.get("state")).toBe("page-state");
      expect(redirect.searchParams.get("code")).toBeNull();
    });

    it("answers a tampered request id with a 400 page and no redirect", async () => {
      const owner = await createOwner(app);
      const {path} = await authorize(app);

      const res = await approveAs(app, `${path}x`, owner);

      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    });

    it("answers an expired request with a 400 page and no redirect", async () => {
      const owner = await createOwner(app);
      const {path} = await authorize(app);
      await McpOAuthAuthorization.updateMany(
        {},
        {$set: {expiresAt: DateTime.now().minus({seconds: 1}).toJSDate()}}
      );

      const res = await approveAs(app, path, owner);

      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
      expect(res.text).toContain("Authorization request expired");
    });

    it("answers an already decided request with a 400 page", async () => {
      const {path} = await authorize(app);
      await submit(app, path, {decision: "deny"});

      const res = await submit(app, path, {decision: "deny"});

      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    });
  });

  describe("JSON consent endpoints in builtin mode", () => {
    it("refuses the JSON approve, so a session alone can't skip the password and code", async () => {
      const owner = await createOwner(app);
      const sessionApp = new TerrenoApp({
        mcpOAuth: {
          clientIdMetadataDocuments: {
            allowedClientIds: [CLAUDE_AI],
            fetch: async () => new Response(JSON.stringify(claudeDocument), {status: 200}),
          },
          consent: {mode: "builtin", requireAdmin: true},
          enabled: true,
          issuer: ISSUER,
        },
        skipListen: true,
        userModel: securityUserModel,
      })
        .addMiddleware(async (req, _res, next) => {
          if (req.path.startsWith("/oauth/authorize/")) {
            req.user = (await SecurityUser.findOne({
              email: owner.email,
            })) as unknown as typeof req.user;
          }
          next();
        })
        .register(new BetterAuthApp({config: testBetterAuthConfig(), userModel: securityUserModel}))
        .register(noteRouter())
        .build();
      const {path} = await authorize(sessionApp);
      const requestId = path.split("/").pop() as string;

      const res = await supertest(sessionApp).post(`/oauth/authorize/${requestId}/approve`);

      expect(res.status).toBe(403);
      expect(res.body.title).toBe("Approve on the built-in consent page");
      const pending = await McpOAuthAuthorization.findOneOrNone({requestId});
      expect(pending?.status).toBe("pending");
      expect(pending?.codeHash).toBeUndefined();
    });
  });

  describe("boot", () => {
    it("throws without a Better Auth twoFactor config, and needs consentUrl in url mode", () => {
      const withoutTwoFactor = (): express.Application =>
        new TerrenoApp({
          mcpOAuth: {consent: {mode: "builtin"}, enabled: true, issuer: ISSUER},
          skipListen: true,
          userModel: securityUserModel,
        })
          .register(
            new BetterAuthApp({
              config: testBetterAuthConfig({twoFactor: undefined}),
              userModel: securityUserModel,
            })
          )
          .build();
      const urlModeWithoutConsentUrl = (): express.Application =>
        new TerrenoApp({
          mcpOAuth: {enabled: true, issuer: ISSUER},
          skipListen: true,
          userModel: securityUserModel,
        }).build();

      expect(withoutTwoFactor).toThrow("MCP OAuth is misconfigured");
      expect(urlModeWithoutConsentUrl).toThrow("MCP OAuth is misconfigured");
    });
  });

  it("E1: CIMD authorize, built-in consent, token, /mcp tools/list, refresh, revoke", async () => {
    const owner = await createOwner(app);
    const {path, verifier} = await authorize(app);
    const page = await supertest(app).get(path);
    expect(page.status).toBe(200);

    const approved = await approveAs(app, path, owner);
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.location).searchParams.get("code") as string;
    const tokens = await exchange(app, code, verifier);
    expect(tokens.status).toBe(200);

    const tools = await supertest(app)
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .set("authorization", `Bearer ${tokens.body.access_token}`)
      .send({id: 1, jsonrpc: "2.0", method: "tools/list", params: {}});
    expect(tools.status).toBe(200);
    expect(tools.text).toContain("consent_page_whoami");

    const refreshed = await supertest(app).post("/oauth/token").type("form").send({
      client_id: CLAUDE_AI,
      grant_type: "refresh_token",
      refresh_token: tokens.body.refresh_token,
    });
    expect(refreshed.status).toBe(200);

    const revoked = await supertest(app)
      .post("/oauth/revoke")
      .type("form")
      .send({client_id: CLAUDE_AI, token: refreshed.body.refresh_token});
    expect(revoked.status).toBe(200);
    const afterRevoke = await supertest(app)
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .set("authorization", `Bearer ${refreshed.body.access_token}`)
      .send({id: 2, jsonrpc: "2.0", method: "tools/list", params: {}});
    expect(afterRevoke.status).toBe(401);
  });
});
