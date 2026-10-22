/**
 * A tiny OpenID Connect provider for the cross-site OAuth e2e run (e2e/crossSiteOAuth.spec.ts).
 *
 * It serves discovery, an authorize step that approves one fixed test user at once, a token
 * endpoint that checks the client and the PKCE verifier, and userinfo. example-backend registers
 * it as the `mock-oidc` generic OAuth provider when `MOCK_OIDC_ISSUER` points here, which it
 * refuses to do in production. playwright.config.ts starts it as a web server in the cross-site
 * run with `MOCK_OIDC_SERVE=true`; importing this file only reads its constants.
 */
import {createHash, randomBytes} from "node:crypto";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";

export const MOCK_OIDC_PORT = 4555;
export const MOCK_OIDC_ISSUER = `http://127.0.0.1:${MOCK_OIDC_PORT}`;

// The cross-site run's API (BETTER_AUTH_URL) callback; any other redirect is refused.
const REDIRECT_URI = "http://127.0.0.1:4000/api/auth/callback/mock-oidc";

// Matches example-backend/src/utils/betterAuthConfig.ts.
const CLIENT_ID = "terreno-example-e2e";
const CLIENT_SECRET = "terreno-example-e2e-secret";

/** The one user this provider signs in. Test data only. */
export const MOCK_OIDC_USER = {
  email: "mock-oidc-e2e@example.com",
  name: "Mock OIDC User",
  sub: "mock-oidc-e2e-user",
};

const CODE_TTL_MS = 60_000;

interface PendingCode {
  codeChallenge: string | null;
  expiresAt: number;
  redirectUri: string;
}

const pendingCodes = new Map<string, PendingCode>();
const accessTokens = new Set<string>();

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, {"cache-control": "no-store", "content-type": "application/json"});
  res.end(JSON.stringify(body));
};

const readBody = async (req: IncomingMessage): Promise<URLSearchParams> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

// The client may authenticate with HTTP Basic or with form fields.
const clientCredentials = (
  req: IncomingMessage,
  body: URLSearchParams
): {clientId: string | null; clientSecret: string | null} => {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  }
  return {clientId: body.get("client_id"), clientSecret: body.get("client_secret")};
};

const s256 = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

const handleAuthorize = (url: URL, res: ServerResponse): void => {
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  if (
    url.searchParams.get("client_id") !== CLIENT_ID ||
    url.searchParams.get("response_type") !== "code" ||
    redirectUri !== REDIRECT_URI ||
    !state ||
    !url.searchParams.get("code_challenge") ||
    url.searchParams.get("code_challenge_method") !== "S256"
  ) {
    sendJson(res, 400, {error: "invalid_request"});
    return;
  }
  const code = randomBytes(16).toString("hex");
  pendingCodes.set(code, {
    codeChallenge: url.searchParams.get("code_challenge"),
    expiresAt: Date.now() + CODE_TTL_MS,
    redirectUri,
  });
  // Approves at once: there is no consent page to drive.
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", state);
  res.writeHead(302, {location: redirect.toString()});
  res.end();
};

const handleToken = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readBody(req);
  const {clientId, clientSecret} = clientCredentials(req, body);
  if (clientId !== CLIENT_ID || clientSecret !== CLIENT_SECRET) {
    sendJson(res, 401, {error: "invalid_client"});
    return;
  }
  const code = body.get("code") ?? "";
  const pending = pendingCodes.get(code);
  // Codes are single use.
  pendingCodes.delete(code);
  if (
    !pending ||
    pending.expiresAt < Date.now() ||
    body.get("redirect_uri") !== pending.redirectUri
  ) {
    sendJson(res, 400, {error: "invalid_grant"});
    return;
  }
  const verifier = body.get("code_verifier");
  if (!pending.codeChallenge || !verifier || s256(verifier) !== pending.codeChallenge) {
    sendJson(res, 400, {error: "invalid_grant"});
    return;
  }
  const accessToken = randomBytes(24).toString("hex");
  accessTokens.add(accessToken);
  sendJson(res, 200, {access_token: accessToken, expires_in: 3600, token_type: "Bearer"});
};

const handleUserinfo = (req: IncomingMessage, res: ServerResponse): void => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!accessTokens.has(token)) {
    sendJson(res, 401, {error: "invalid_token"});
    return;
  }
  // Without signed ID tokens in discovery, Better Auth reads the account id from `id`.
  sendJson(res, 200, {...MOCK_OIDC_USER, email_verified: true, id: MOCK_OIDC_USER.sub});
};

const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "/", MOCK_OIDC_ISSUER);
  if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
    sendJson(res, 200, {
      authorization_endpoint: `${MOCK_OIDC_ISSUER}/authorize`,
      code_challenge_methods_supported: ["S256"],
      issuer: MOCK_OIDC_ISSUER,
      response_types_supported: ["code"],
      token_endpoint: `${MOCK_OIDC_ISSUER}/token`,
      userinfo_endpoint: `${MOCK_OIDC_ISSUER}/userinfo`,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/authorize") {
    handleAuthorize(url, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/token") {
    await handleToken(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/userinfo") {
    handleUserinfo(req, res);
    return;
  }
  sendJson(res, 404, {error: "not_found"});
};

/** Starts the provider on 127.0.0.1:MOCK_OIDC_PORT. */
export const startMockOidcProvider = (): Server => {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      console.error("[mockOidcProvider] request failed", error);
      sendJson(res, 500, {error: "server_error"});
    });
  });
  server.listen(MOCK_OIDC_PORT, "127.0.0.1", () => {
    console.info(`[mockOidcProvider] listening on ${MOCK_OIDC_ISSUER}`);
  });
  return server;
};

if (process.env.MOCK_OIDC_SERVE === "true") {
  startMockOidcProvider();
}
