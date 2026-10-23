import {beforeEach, describe, expect, it, spyOn} from "bun:test";
import {createHash, randomBytes} from "node:crypto";
import type express from "express";
import {DateTime} from "luxon";
import mongoose, {model, Schema} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {modelRouter} from "../api";
import type {UserModel as UserModelType} from "../auth";
import {AuthToken} from "../authTokens";
import {McpOAuthAuthorization} from "../models/mcpOAuthAuthorization";
import {McpOAuthClient} from "../models/mcpOAuthClient";
import {McpOAuthToken} from "../models/mcpOAuthToken";
import {McpServiceToken} from "../models/mcpServiceToken";
import {Permissions} from "../permissions";
import {getCurrentRequestContext} from "../requestContext";
import {TerrenoApp} from "../terrenoApp";
import {authAsUser, setupDb, UserModel} from "../tests";
import {type McpOAuthOptions, resolveMcpOAuthOption} from "./oauthMetadata";
import {clearMCPRegistry} from "./registry";

const typedUserModel = UserModel as unknown as UserModelType;

const ISSUER = "https://api.example.com";
const CONSENT_URL = "https://app.example.com/oauth/consent?theme=dark";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE_METADATA_URL = `${ISSUER}/.well-known/oauth-protected-resource/mcp`;

const oauthOptions: McpOAuthOptions = {
  allowedRedirectHosts: ["claude.ai", "*.chatgpt.com", "localhost"],
  consentUrl: CONSENT_URL,
  dynamicClientRegistration: true,
  enabled: true,
  issuer: ISSUER,
};

const noteSchema = new Schema({title: {description: "Note title", type: String}});
const OAuthNote =
  (mongoose.models.OAuthNote as mongoose.Model<{title?: string}> | undefined) ??
  model<{title?: string}>("OAuthNote", noteSchema);

const noteRouter = () =>
  modelRouter("/oauth-notes", OAuthNote, {
    collectionActions: {
      whoami: {
        handler: async ({user}) => ({
          credential: getCurrentRequestContext()?.credential ?? null,
          userId: String(user?._id),
        }),
        mcp: {name: "oauth_whoami"},
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
  {mcpOAuth}: {mcpOAuth?: McpOAuthOptions} = {mcpOAuth: oauthOptions}
): express.Application =>
  new TerrenoApp({
    mcpOAuth,
    mcpServiceTokens: true,
    skipListen: true,
    userModel: typedUserModel,
  })
    .register(noteRouter())
    .build();

const createPkce = (): {challenge: string; verifier: string} => {
  const verifier = randomBytes(32).toString("base64url");
  return {challenge: createHash("sha256").update(verifier).digest("base64url"), verifier};
};

const whoamiCall = {
  id: 1,
  jsonrpc: "2.0",
  method: "tools/call",
  params: {arguments: {}, name: "oauth_whoami"},
};

const callMcp = (app: express.Application, bearer?: string) => {
  const request = supertest(app).post("/mcp").set("accept", "application/json, text/event-stream");
  if (bearer) {
    request.set("Authorization", `Bearer ${bearer}`);
  }
  return request.send(whoamiCall);
};

const toolPayload = (text: string): Record<string, unknown> => {
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  const rpc = JSON.parse(dataLine ? dataLine.slice("data:".length) : text);
  return JSON.parse(rpc.result.content[0].text);
};

const registerClient = async (
  app: express.Application,
  redirectUris: string[] = [REDIRECT_URI]
): Promise<string> => {
  const res = await supertest(app)
    .post("/oauth/register")
    .send({client_name: "Claude", redirect_uris: redirectUris});
  expect(res.status).toBe(201);
  return res.body.client_id as string;
};

const startAuthorization = (
  app: express.Application,
  params: Record<string, string>
): supertest.Test => supertest(app).get("/oauth/authorize").query(params);

const requestIdFrom = (location: string): string =>
  new URL(location).searchParams.get("request") as string;

interface Flow {
  clientId: string;
  code: string;
  verifier: string;
}

/** Register, authorize, and approve; returns an authorization code ready to exchange. */
const approvedCode = async (app: express.Application, agent: TestAgent): Promise<Flow> => {
  const clientId = await registerClient(app);
  const {challenge, verifier} = createPkce();
  const authorize = await startAuthorization(app, {
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    state: "state-123",
  });
  const approve = await agent.post(
    `/oauth/authorize/${requestIdFrom(authorize.headers.location)}/approve`
  );
  expect(approve.status).toBe(200);
  const redirect = new URL(approve.body.data.redirectUrl);
  return {clientId, code: redirect.searchParams.get("code") as string, verifier};
};

const exchangeCode = (app: express.Application, flow: Flow, overrides = {}) =>
  supertest(app)
    .post("/oauth/token")
    .type("form")
    .send({
      client_id: flow.clientId,
      code: flow.code,
      code_verifier: flow.verifier,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      ...overrides,
    });

const refresh = (app: express.Application, clientId: string, refreshToken: string) =>
  supertest(app).post("/oauth/token").type("form").send({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

describe("MCP OAuth authorization server", () => {
  let app: express.Application;
  let agent: TestAgent;
  let notAdminId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    const [, notAdmin] = await setupDb();
    notAdminId = notAdmin._id as mongoose.Types.ObjectId;
    await Promise.all([
      McpOAuthAuthorization.deleteMany({}),
      McpOAuthClient.deleteMany({}),
      McpOAuthToken.deleteMany({}),
      McpServiceToken.deleteMany({}),
    ]);
    clearMCPRegistry();
    app = buildApp();
    agent = await authAsUser(app, "notAdmin");
  });

  describe("discovery", () => {
    it("serves RFC 9728 protected-resource metadata at both well-known paths", async () => {
      const root = await supertest(app).get("/.well-known/oauth-protected-resource");
      const suffixed = await supertest(app).get("/.well-known/oauth-protected-resource/mcp");

      expect(suffixed.body).toEqual(root.body);
      expect(root.body).not.toHaveProperty("requestId");
      expect(root.body).toMatchObject({
        authorization_servers: [ISSUER],
        bearer_methods_supported: ["header"],
        resource: `${ISSUER}/mcp`,
      });
    });

    it("serves RFC 8414 authorization-server metadata", async () => {
      const res = await supertest(app).get("/.well-known/oauth-authorization-server");

      expect(res.body).toMatchObject({
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        issuer: ISSUER,
        registration_endpoint: `${ISSUER}/oauth/register`,
        response_types_supported: ["code"],
        revocation_endpoint: `${ISSUER}/oauth/revoke`,
        token_endpoint: `${ISSUER}/oauth/token`,
        token_endpoint_auth_methods_supported: ["none"],
      });
    });
  });

  describe("dynamic client registration", () => {
    it("rejects a redirect URI outside allowedRedirectHosts", async () => {
      const res = await supertest(app)
        .post("/oauth/register")
        .send({redirect_uris: ["https://evil.example/callback"]});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_redirect_uri");
    });

    it("rejects http redirects except on loopback hosts", async () => {
      const insecure = await supertest(app)
        .post("/oauth/register")
        .send({redirect_uris: ["http://claude.ai/callback"]});
      const loopback = await supertest(app)
        .post("/oauth/register")
        .send({redirect_uris: ["http://localhost:33418/callback"]});

      expect(insecure.body.error).toBe("invalid_redirect_uri");
      expect(loopback.status).toBe(201);
    });

    it("matches wildcard subdomains but not the bare domain", async () => {
      const sub = await supertest(app)
        .post("/oauth/register")
        .send({redirect_uris: ["https://connectors.chatgpt.com/callback"]});
      const bare = await supertest(app)
        .post("/oauth/register")
        .send({redirect_uris: ["https://chatgpt.com/callback"]});

      expect(sub.status).toBe(201);
      expect(bare.body.error).toBe("invalid_redirect_uri");
    });

    it("rejects confidential clients", async () => {
      const res = await supertest(app)
        .post("/oauth/register")
        .send({
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "client_secret_basic",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_client_metadata");
    });

    it("registers a public client", async () => {
      const res = await supertest(app)
        .post("/oauth/register")
        .send({client_name: "Claude", redirect_uris: [REDIRECT_URI]});

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        client_name: "Claude",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
      });
      expect(res.body.client_id).toBeString();
    });
  });

  describe("authorization code flow", () => {
    it("issues access and refresh tokens that call /mcp as the approving user", async () => {
      const clientId = await registerClient(app);
      const {challenge, verifier} = createPkce();
      const authorize = await startAuthorization(app, {
        client_id: clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: REDIRECT_URI,
        resource: `${ISSUER}/mcp`,
        response_type: "code",
        state: "state-123",
      });

      expect(authorize.status).toBe(302);
      const consent = new URL(authorize.headers.location);
      expect(`${consent.origin}${consent.pathname}`).toBe("https://app.example.com/oauth/consent");
      expect(consent.searchParams.get("theme")).toBe("dark");
      const requestId = consent.searchParams.get("request") as string;

      const pending = await agent.get(`/oauth/authorize/${requestId}`);
      expect(pending.body.data).toMatchObject({
        clientName: "Claude",
        redirectHost: "claude.ai",
        scope: "mcp",
      });

      const approve = await agent.post(`/oauth/authorize/${requestId}/approve`);
      const redirect = new URL(approve.body.data.redirectUrl);
      expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT_URI);
      expect(redirect.searchParams.get("state")).toBe("state-123");
      expect(redirect.searchParams.get("iss")).toBe(ISSUER);

      const token = await exchangeCode(app, {
        clientId,
        code: redirect.searchParams.get("code") as string,
        verifier,
      });

      expect(token.status).toBe(200);
      expect(token.headers["cache-control"]).toBe("no-store");
      expect(token.body).toMatchObject({expires_in: 3600, scope: "mcp", token_type: "Bearer"});
      expect(token.body.access_token).toStartWith("mcpat_");
      expect(token.body.refresh_token).toStartWith("mcprt_");

      const mcp = await callMcp(app, token.body.access_token);
      expect(toolPayload(mcp.text)).toEqual({credential: "oauth", userId: String(notAdminId)});
    });

    it("redirects with invalid_request for plain PKCE", async () => {
      const clientId = await registerClient(app);
      const {verifier} = createPkce();

      const res = await startAuthorization(app, {
        client_id: clientId,
        code_challenge: verifier,
        code_challenge_method: "plain",
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        state: "s",
      });

      const redirect = new URL(res.headers.location);
      expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT_URI);
      expect(redirect.searchParams.get("error")).toBe("invalid_request");
      expect(redirect.searchParams.get("state")).toBe("s");
    });

    it("answers in place, without redirecting, for an unregistered redirect_uri", async () => {
      const clientId = await registerClient(app);
      const {challenge} = createPkce();

      const res = await startAuthorization(app, {
        client_id: clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: "https://claude.ai/other",
        response_type: "code",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("rejects a wrong code_verifier and burns the code", async () => {
      const flow = await approvedCode(app, agent);

      const wrong = await exchangeCode(app, flow, {code_verifier: createPkce().verifier});
      const retry = await exchangeCode(app, flow);

      expect(wrong.status).toBe(400);
      expect(wrong.body.error).toBe("invalid_grant");
      expect(retry.body.error).toBe("invalid_grant");
    });

    it("rejects a reused code and revokes the tokens it issued", async () => {
      const flow = await approvedCode(app, agent);
      const first = await exchangeCode(app, flow);

      const reuse = await exchangeCode(app, flow);
      const mcp = await callMcp(app, first.body.access_token);

      expect(reuse.status).toBe(400);
      expect(reuse.body.error).toBe("invalid_grant");
      expect(mcp.status).toBe(401);
    });

    it("revokes every token when a code is exchanged twice at once", async () => {
      const flow = await approvedCode(app, agent);

      const results = await Promise.all([exchangeCode(app, flow), exchangeCode(app, flow)]);

      // Depending on interleaving the winner may also lose its pair; it never keeps one.
      expect(results.filter((res) => res.status === 200).length).toBeLessThanOrEqual(1);
      expect(results.some((res) => res.body.error === "invalid_grant")).toBe(true);
      expect(await McpOAuthToken.countDocuments({revokedAt: {$exists: false}})).toBe(0);
    });

    it("revokes the tokens when a code is replayed after issue but before the exchange returns", async () => {
      const flow = await approvedCode(app, agent);
      const realIssue = McpOAuthToken.issue.bind(McpOAuthToken);
      let replay: supertest.Response | undefined;
      const issueSpy = spyOn(McpOAuthToken, "issue").mockImplementation(async (options) => {
        const issued = await realIssue(options);
        replay = await exchangeCode(app, flow);
        return issued;
      });
      let first: supertest.Response;
      try {
        first = await exchangeCode(app, flow);
      } finally {
        issueSpy.mockRestore();
      }

      expect(replay?.body.error).toBe("invalid_grant");
      expect((await callMcp(app, first.body.access_token)).status).toBe(401);
      expect((await refresh(app, flow.clientId, first.body.refresh_token)).body.error).toBe(
        "invalid_grant"
      );
    });

    it("refuses to issue tokens when the code is replayed before they are issued", async () => {
      const flow = await approvedCode(app, agent);
      const realIssue = McpOAuthToken.issue.bind(McpOAuthToken);
      let replay: supertest.Response | undefined;
      const issueSpy = spyOn(McpOAuthToken, "issue").mockImplementation(async (options) => {
        replay = await exchangeCode(app, flow);
        return realIssue(options);
      });
      let first: supertest.Response;
      try {
        first = await exchangeCode(app, flow);
      } finally {
        issueSpy.mockRestore();
      }

      expect(replay?.body.error).toBe("invalid_grant");
      expect(first.status).toBe(400);
      expect(first.body.error).toBe("invalid_grant");
      expect(await McpOAuthToken.countDocuments({revokedAt: {$exists: false}})).toBe(0);
    });

    it("rejects approving an expired pending request", async () => {
      const clientId = await registerClient(app);
      const authorize = await startAuthorization(app, {
        client_id: clientId,
        code_challenge: createPkce().challenge,
        code_challenge_method: "S256",
        response_type: "code",
      });
      const requestId = requestIdFrom(authorize.headers.location);
      await McpOAuthAuthorization.updateOne(
        {requestId},
        {$set: {expiresAt: DateTime.now().minus({minutes: 1}).toJSDate()}}
      );

      const res = await agent.post(`/oauth/authorize/${requestId}/approve`);

      expect(res.status).toBe(400);
      expect(res.body.title).toBe("Authorization request expired");
    });

    it("rejects an expired authorization code", async () => {
      const flow = await approvedCode(app, agent);
      await McpOAuthAuthorization.updateMany(
        {},
        {$set: {codeExpiresAt: DateTime.now().minus({seconds: 1}).toJSDate()}}
      );

      const res = await exchangeCode(app, flow);

      expect(res.body.error).toBe("invalid_grant");
    });

    it("redirects with access_denied when the user denies", async () => {
      const clientId = await registerClient(app);
      const authorize = await startAuthorization(app, {
        client_id: clientId,
        code_challenge: createPkce().challenge,
        code_challenge_method: "S256",
        response_type: "code",
        state: "deny-state",
      });
      const requestId = requestIdFrom(authorize.headers.location);

      const deny = await agent.post(`/oauth/authorize/${requestId}/deny`);
      const approveAfter = await agent.post(`/oauth/authorize/${requestId}/approve`);

      const redirect = new URL(deny.body.data.redirectUrl);
      expect(redirect.searchParams.get("error")).toBe("access_denied");
      expect(redirect.searchParams.get("state")).toBe("deny-state");
      expect(approveAfter.status).toBe(409);
    });

    it("refuses delegated MCP credentials on the consent endpoints", async () => {
      const flow = await approvedCode(app, agent);
      const {access_token: accessToken} = (await exchangeCode(app, flow)).body;
      const clientId = await registerClient(app);
      const authorize = await startAuthorization(app, {
        client_id: clientId,
        code_challenge: createPkce().challenge,
        code_challenge_method: "S256",
        response_type: "code",
      });

      const res = await supertest(app)
        .post(`/oauth/authorize/${requestIdFrom(authorize.headers.location)}/approve`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(401);
    });
  });

  describe("refresh tokens", () => {
    it("rotates the refresh token on every exchange", async () => {
      const flow = await approvedCode(app, agent);
      const first = (await exchangeCode(app, flow)).body;

      const second = await refresh(app, flow.clientId, first.refresh_token);

      expect(second.status).toBe(200);
      expect(second.body.refresh_token).not.toBe(first.refresh_token);
      expect((await callMcp(app, second.body.access_token)).status).toBe(200);
      expect((await callMcp(app, first.access_token)).status).toBe(401);
    });

    it("revokes the whole chain when a rotated refresh token is reused", async () => {
      const flow = await approvedCode(app, agent);
      const first = (await exchangeCode(app, flow)).body;
      const second = (await refresh(app, flow.clientId, first.refresh_token)).body;

      const reuse = await refresh(app, flow.clientId, first.refresh_token);
      const third = await refresh(app, flow.clientId, second.refresh_token);

      expect(reuse.body.error).toBe("invalid_grant");
      expect(third.body.error).toBe("invalid_grant");
      expect((await callMcp(app, second.access_token)).status).toBe(401);
    });

    it("revokes the whole chain when a refresh token is exchanged twice at once", async () => {
      const flow = await approvedCode(app, agent);
      const first = (await exchangeCode(app, flow)).body;

      const results = await Promise.all([
        refresh(app, flow.clientId, first.refresh_token),
        refresh(app, flow.clientId, first.refresh_token),
      ]);

      // Depending on interleaving the winner may also lose its pair; it never keeps one.
      expect(results.filter((res) => res.status === 200).length).toBeLessThanOrEqual(1);
      expect(results.some((res) => res.body.error === "invalid_grant")).toBe(true);
      expect(await McpOAuthToken.countDocuments({revokedAt: {$exists: false}})).toBe(0);
    });

    it("revokes the chain when two exchanges of one refresh token read it at the same time", async () => {
      const flow = await approvedCode(app, agent);
      const first = (await exchangeCode(app, flow)).body;
      // Hold each lookup until both requests have read the token, so both start from the same state.
      const realLookup = McpOAuthToken.findOneOrNone.bind(McpOAuthToken);
      let lookups = 0;
      let releaseLookups = (): void => {};
      const bothLookedUp = new Promise<void>((resolve) => {
        releaseLookups = resolve;
      });
      const lookupSpy = spyOn(McpOAuthToken, "findOneOrNone").mockImplementation((async (
        ...args: Parameters<typeof realLookup>
      ) => {
        const found = await realLookup(...args);
        lookups += 1;
        if (lookups === 2) {
          releaseLookups();
        }
        await bothLookedUp;
        return found;
      }) as typeof McpOAuthToken.findOneOrNone);
      let responses: supertest.Response[];
      try {
        responses = await Promise.all([
          refresh(app, flow.clientId, first.refresh_token),
          refresh(app, flow.clientId, first.refresh_token),
        ]);
      } finally {
        lookupSpy.mockRestore();
      }

      expect(responses.some((res) => res.body.error === "invalid_grant")).toBe(true);
      for (const res of responses.filter((candidate) => candidate.status === 200)) {
        expect((await callMcp(app, res.body.access_token)).status).toBe(401);
        expect((await refresh(app, flow.clientId, res.body.refresh_token)).body.error).toBe(
          "invalid_grant"
        );
      }
    });

    it("keeps the chain revoked when the winning exchange issues after the loser revoked it", async () => {
      const flow = await approvedCode(app, agent);
      const first = (await exchangeCode(app, flow)).body;
      // The exchange that wins the rotation waits in issue until the losing exchange has answered.
      const realIssue = McpOAuthToken.issue.bind(McpOAuthToken);
      let markLoserDone = (): void => {};
      const loserDone = new Promise<void>((resolve) => {
        markLoserDone = resolve;
      });
      const issueSpy = spyOn(McpOAuthToken, "issue").mockImplementation(async (options) => {
        await loserDone;
        return realIssue(options);
      });
      let responses: supertest.Response[];
      try {
        responses = await Promise.all(
          [0, 1].map(async () => {
            const res = await refresh(app, flow.clientId, first.refresh_token);
            markLoserDone();
            return res;
          })
        );
      } finally {
        issueSpy.mockRestore();
      }

      expect(responses.map((res) => res.body.error)).toEqual(["invalid_grant", "invalid_grant"]);
      expect(await McpOAuthToken.countDocuments({revokedAt: {$exists: false}})).toBe(0);
    });
  });

  describe("revocation", () => {
    it("revokes an access token and always answers 200", async () => {
      const flow = await approvedCode(app, agent);
      const {access_token: accessToken} = (await exchangeCode(app, flow)).body;

      const res = await supertest(app)
        .post("/oauth/revoke")
        .type("form")
        .send({client_id: flow.clientId, token: accessToken});
      const unknown = await supertest(app)
        .post("/oauth/revoke")
        .type("form")
        .send({token: "mcpat_unknown"});

      expect(res.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect((await callMcp(app, accessToken)).status).toBe(401);
    });

    it("revokes the chain when a refresh token is revoked", async () => {
      const flow = await approvedCode(app, agent);
      const tokens = (await exchangeCode(app, flow)).body;

      await supertest(app).post("/oauth/revoke").send({token: tokens.refresh_token});

      expect((await callMcp(app, tokens.access_token)).status).toBe(401);
      expect((await refresh(app, flow.clientId, tokens.refresh_token)).body.error).toBe(
        "invalid_grant"
      );
    });
  });

  describe("/mcp resource server", () => {
    it("challenges a credential-less request with the resource metadata URL", async () => {
      const res = await callMcp(app);

      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toBe(
        `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`
      );
    });

    it("marks a presented but rejected token as invalid_token", async () => {
      const res = await callMcp(app, "mcpat_not-a-real-token");

      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toContain('error="invalid_token"');
    });

    it("rejects an expired access token", async () => {
      const flow = await approvedCode(app, agent);
      const {access_token: accessToken} = (await exchangeCode(app, flow)).body;
      await McpOAuthToken.updateMany(
        {},
        {$set: {accessExpiresAt: DateTime.now().minus({seconds: 1}).toJSDate()}}
      );

      expect((await callMcp(app, accessToken)).status).toBe(401);
    });

    it("rejects a disabled user's access token", async () => {
      const flow = await approvedCode(app, agent);
      const {access_token: accessToken} = (await exchangeCode(app, flow)).body;
      await UserModel.updateOne({_id: notAdminId}, {$set: {disabled: true}});

      expect((await callMcp(app, accessToken)).status).toBe(401);
    });

    it("keeps accepting JWT and mcp_ service tokens", async () => {
      const created = await agent.post("/mcp/service-tokens").send({name: "Agent"});

      const jwtCall = await agent
        .post("/mcp")
        .set("accept", "application/json, text/event-stream")
        .send(whoamiCall);
      const tokenCall = await callMcp(app, created.body.data.token);

      expect(toolPayload(jwtCall.text).credential).toBe("jwt");
      expect(toolPayload(tokenCall.text).credential).toBe("mcp-service-token");
    });
  });

  describe("credential events", () => {
    const resetPassword = async (): Promise<void> => {
      const issued = await AuthToken.issueFor({_id: String(notAdminId)}, "passwordReset");
      const res = await supertest(app)
        .post("/auth/resetPassword")
        .send({password: "reset-password-123", token: issued.token});
      expect(res.status).toBe(200);
    };

    it("ends service tokens, access tokens, and refresh tokens issued before a password reset", async () => {
      const serviceToken = (await agent.post("/mcp/service-tokens").send({name: "Agent"})).body.data
        .token as string;
      const flow = await approvedCode(app, agent);
      const oauth = (await exchangeCode(app, flow)).body;
      expect((await callMcp(app, serviceToken)).status).toBe(200);
      expect((await callMcp(app, oauth.access_token)).status).toBe(200);

      await resetPassword();

      const serviceCall = await callMcp(app, serviceToken);
      expect(serviceCall.status).toBe(401);
      expect(serviceCall.headers["www-authenticate"]).toContain('error="invalid_token"');
      expect((await callMcp(app, oauth.access_token)).status).toBe(401);
      const refreshed = await refresh(app, flow.clientId, oauth.refresh_token);
      expect(refreshed.status).toBe(400);
      expect(refreshed.body.error).toBe("invalid_grant");
    });

    it("lists service tokens from before a password reset as revoked", async () => {
      await agent.post("/mcp/service-tokens").send({name: "Before reset"});

      await resetPassword();

      const list = await agent.get("/mcp/service-tokens");
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].revokedAt).not.toBeNull();
    });

    it("refuses to exchange a code approved before a password reset", async () => {
      const flow = await approvedCode(app, agent);

      await resetPassword();

      const exchanged = await exchangeCode(app, flow);
      expect(exchanged.status).toBe(400);
      expect(exchanged.body.error).toBe("invalid_grant");
    });

    it("ends MCP credentials on any tokenEpoch bump, such as a Better Auth session revocation", async () => {
      const serviceToken = (await agent.post("/mcp/service-tokens").send({name: "Agent"})).body.data
        .token as string;
      const flow = await approvedCode(app, agent);
      const oauth = (await exchangeCode(app, flow)).body;

      await UserModel.updateOne({_id: notAdminId}, {$inc: {tokenEpoch: 1}});

      expect((await callMcp(app, serviceToken)).status).toBe(401);
      expect((await callMcp(app, oauth.access_token)).status).toBe(401);
      expect((await refresh(app, flow.clientId, oauth.refresh_token)).body.error).toBe(
        "invalid_grant"
      );
    });

    it("accepts MCP credentials issued after a password reset", async () => {
      await resetPassword();

      const serviceToken = (await agent.post("/mcp/service-tokens").send({name: "After"})).body.data
        .token as string;
      const flow = await approvedCode(app, agent);
      const oauth = (await exchangeCode(app, flow)).body;
      const refreshed = await refresh(app, flow.clientId, oauth.refresh_token);

      expect((await callMcp(app, serviceToken)).status).toBe(200);
      expect(refreshed.status).toBe(200);
      expect((await callMcp(app, refreshed.body.access_token)).status).toBe(200);
    });
  });

  it("documents the consent endpoints in OpenAPI", async () => {
    const res = await supertest(app).get("/openapi.json");

    expect(res.body.paths["/oauth/authorize/{request}/approve"].post.operationId).toBe(
      "approveMcpOAuthRequest"
    );
  });
});

describe("resolveMcpOAuthOption", () => {
  it("returns undefined while disabled", () => {
    expect(resolveMcpOAuthOption(undefined)).toBeUndefined();
    expect(resolveMcpOAuthOption({...oauthOptions, enabled: false})).toBeUndefined();
  });

  it("fills defaults", () => {
    expect(resolveMcpOAuthOption(oauthOptions)).toMatchObject({
      accessTokenTtlSeconds: 3600,
      issuer: ISSUER,
      resource: `${ISSUER}/mcp`,
      resourceMetadataUrl: RESOURCE_METADATA_URL,
      scopesSupported: ["mcp"],
    });
  });

  it("throws at boot for an issuer with a path or without https", () => {
    expect(() => resolveMcpOAuthOption({...oauthOptions, issuer: `${ISSUER}/api`})).toThrow(
      "MCP OAuth is misconfigured"
    );
    expect(() =>
      resolveMcpOAuthOption({...oauthOptions, issuer: "http://api.example.com"})
    ).toThrow("MCP OAuth is misconfigured");
  });

  it("throws at boot when registration is on without allowed redirect hosts", () => {
    expect(() => resolveMcpOAuthOption({...oauthOptions, allowedRedirectHosts: []})).toThrow(
      "MCP OAuth is misconfigured"
    );
  });

  it("leaves dynamic client registration off unless asked for", () => {
    const {allowedRedirectHosts: _hosts, dynamicClientRegistration: _dcr, ...rest} = oauthOptions;

    expect(resolveMcpOAuthOption(rest)).toMatchObject({
      allowedRedirectHosts: [],
      dynamicClientRegistration: false,
    });
  });
});

describe("MCP OAuth opt-in", () => {
  const oauthPaths: [string, string][] = [
    ["get", "/.well-known/oauth-protected-resource"],
    ["get", "/.well-known/oauth-protected-resource/mcp"],
    ["get", "/.well-known/oauth-authorization-server"],
    ["post", "/oauth/register"],
    ["get", "/oauth/authorize"],
    ["post", "/oauth/token"],
    ["post", "/oauth/revoke"],
  ];

  beforeEach(async () => {
    await setupDb();
    await Promise.all([
      McpOAuthAuthorization.deleteMany({}),
      McpOAuthClient.deleteMany({}),
      McpOAuthToken.deleteMany({}),
    ]);
    clearMCPRegistry();
  });

  it("mounts no OAuth routes, metadata, or /mcp challenge without mcpOAuth", async () => {
    for (const mcpOAuth of [undefined, {...oauthOptions, enabled: false}]) {
      const app = buildApp({mcpOAuth});

      for (const [method, path] of oauthPaths) {
        const res = await (method === "get" ? supertest(app).get(path) : supertest(app).post(path));
        expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 404`);
      }
      const mcp = await callMcp(app);
      expect(mcp.status).not.toBe(401);
      expect(mcp.headers["www-authenticate"]).toBeUndefined();
    }
  });

  describe("with dynamic client registration off", () => {
    let app: express.Application;
    let agent: TestAgent;

    beforeEach(async () => {
      const {allowedRedirectHosts: _hosts, dynamicClientRegistration: _dcr, ...rest} = oauthOptions;
      app = buildApp({mcpOAuth: rest});
      agent = await authAsUser(app, "notAdmin");
    });

    it("answers /oauth/register with 404 and leaves it out of the metadata", async () => {
      const register = await supertest(app)
        .post("/oauth/register")
        .send({client_name: "Anyone", redirect_uris: [REDIRECT_URI]});
      const metadata = await supertest(app).get("/.well-known/oauth-authorization-server");

      expect(register.status).toBe(404);
      expect(await McpOAuthClient.countDocuments({})).toBe(0);
      expect(metadata.status).toBe(200);
      expect(metadata.body.registration_endpoint).toBeUndefined();
      expect(metadata.body.token_endpoint).toBe(`${ISSUER}/oauth/token`);
    });

    it("still runs the flow for a client the app created", async () => {
      const client = await McpOAuthClient.create({
        clientId: "preconfigured-claude",
        clientName: "Claude",
        grantTypes: ["authorization_code", "refresh_token"],
        redirectUris: [REDIRECT_URI],
        responseTypes: ["code"],
      });
      const {challenge, verifier} = createPkce();
      const authorize = await startAuthorization(app, {
        client_id: client.clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: REDIRECT_URI,
        response_type: "code",
      });
      const approve = await agent.post(
        `/oauth/authorize/${requestIdFrom(authorize.headers.location)}/approve`
      );
      const code = new URL(approve.body.data.redirectUrl).searchParams.get("code") as string;

      const tokens = await exchangeCode(app, {clientId: client.clientId, code, verifier});

      expect(tokens.status).toBe(200);
      expect((await callMcp(app, tokens.body.access_token)).status).toBe(200);
    });
  });
});
