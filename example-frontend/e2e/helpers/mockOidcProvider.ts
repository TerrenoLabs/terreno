/**
 * A tiny OpenID Connect provider for the cross-site OAuth e2e run (e2e/crossSiteOAuth.spec.ts).
 *
 * It serves discovery, an authorize step that approves a test identity at once, a token
 * endpoint that checks the client and the PKCE verifier, and userinfo. example-backend registers
 * it as the `mock-oidc` generic OAuth provider when `MOCK_OIDC_ISSUER` points here, which it
 * refuses to do in production. playwright.config.ts starts it as a web server in the cross-site
 * run with `MOCK_OIDC_SERVE=true`; importing this file only reads its constants and helpers.
 *
 * Which identity a sign-in returns, first match wins:
 * 1. The `mock_oidc_identity` cookie on the provider's host (`setMockOidcIdentity(context, ...)`),
 *    which names the email, whether it is verified, and optionally the name and subject. A
 *    cookie belongs to one browser context, so parallel tests never see each other's identity.
 * 2. A `login_hint` on the authorize request: that email, verified.
 * 3. `MOCK_OIDC_USER`, verified.
 */
import {createHash, randomBytes} from "node:crypto";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import type {BrowserContext} from "@playwright/test";

const DEFAULT_MOCK_OIDC_PORT = 4555;

const parsePort = (value: string | undefined): number => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_MOCK_OIDC_PORT;
};

/**
 * The provider's port: `MOCK_OIDC_PORT`, or 4555. The native run (maestro/native-social-login.yaml)
 * moves it so it can share a host with a Playwright run.
 */
export const MOCK_OIDC_PORT = parsePort(process.env.MOCK_OIDC_PORT);

/**
 * The issuer discovery advertises: `MOCK_OIDC_ISSUER`, or `http://127.0.0.1:<port>`. A device that
 * reaches the provider through `adb reverse` needs a host that resolves the same way on the
 * device and on the backend's machine, such as `http://localhost:<port>`.
 */
export const MOCK_OIDC_ISSUER =
  process.env.MOCK_OIDC_ISSUER || `http://127.0.0.1:${MOCK_OIDC_PORT}`;

/**
 * The only redirect the provider accepts: `MOCK_OIDC_REDIRECT_URI`, or the cross-site run's API
 * (BETTER_AUTH_URL) callback. Any other redirect is refused.
 */
const REDIRECT_URI =
  process.env.MOCK_OIDC_REDIRECT_URI || "http://127.0.0.1:4000/api/auth/callback/mock-oidc";

// Matches example-backend/src/utils/betterAuthConfig.ts.
const CLIENT_ID = "terreno-example-e2e";
const CLIENT_SECRET = "terreno-example-e2e-secret";

/** The one user this provider signs in. Test data only. */
export const MOCK_OIDC_USER = {
  email: "mock-oidc-e2e@example.com",
  name: "Mock OIDC User",
  sub: "mock-oidc-e2e-user",
};

/** The identity one sign-in returns. */
export interface MockOidcIdentity {
  email: string;
  /** Whether userinfo reports `email_verified: true`. Defaults to true. */
  emailVerified?: boolean;
  /** Defaults to the part of the email before `@`. */
  name?: string;
  /** The provider's account id. Defaults to a stable id derived from the email. */
  sub?: string;
}

/** Cookie on the provider's host that names the identity the next sign-ins return. */
export const MOCK_OIDC_IDENTITY_COOKIE = "mock_oidc_identity";

/**
 * Makes every later mock sign-in in this browser context return `identity`, until the context
 * closes or this is called again. Call it before clicking the mock provider's button.
 */
export const setMockOidcIdentity = async (
  context: BrowserContext,
  identity: MockOidcIdentity
): Promise<void> => {
  await context.addCookies([
    {
      name: MOCK_OIDC_IDENTITY_COOKIE,
      url: MOCK_OIDC_ISSUER,
      value: Buffer.from(JSON.stringify(identity), "utf8").toString("base64url"),
    },
  ]);
};

const CODE_TTL_MS = 60_000;

interface ResolvedIdentity {
  email: string;
  emailVerified: boolean;
  name: string;
  sub: string;
}

interface PendingCode {
  codeChallenge: string | null;
  expiresAt: number;
  identity: ResolvedIdentity;
  redirectUri: string;
}

const pendingCodes = new Map<string, PendingCode>();
const accessTokens = new Map<string, ResolvedIdentity>();

const resolveIdentity = (identity: MockOidcIdentity): ResolvedIdentity | null => {
  const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
  if (!email.includes("@")) {
    return null;
  }
  return {
    email,
    emailVerified: identity.emailVerified !== false,
    name: identity.name || email.split("@")[0],
    sub:
      identity.sub || `mock-oidc-${createHash("sha256").update(email).digest("hex").slice(0, 16)}`,
  };
};

const DEFAULT_IDENTITY: ResolvedIdentity = {...MOCK_OIDC_USER, emailVerified: true};

const readCookie = (req: IncomingMessage, name: string): string | null => {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
};

/** The identity this authorize request signs in, or null when the request names a bad one. */
const identityFor = (req: IncomingMessage, url: URL): ResolvedIdentity | null => {
  const cookie = readCookie(req, MOCK_OIDC_IDENTITY_COOKIE);
  if (cookie) {
    try {
      return resolveIdentity(
        JSON.parse(Buffer.from(cookie, "base64url").toString("utf8")) as MockOidcIdentity
      );
    } catch {
      return null;
    }
  }
  const loginHint = url.searchParams.get("login_hint");
  if (loginHint) {
    return resolveIdentity({email: loginHint});
  }
  return DEFAULT_IDENTITY;
};

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

const handleAuthorize = (req: IncomingMessage, url: URL, res: ServerResponse): void => {
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  if (
    url.searchParams.get("client_id") !== CLIENT_ID ||
    url.searchParams.get("response_type") !== "code" ||
    !redirectUri ||
    redirectUri !== REDIRECT_URI ||
    !state ||
    !url.searchParams.get("code_challenge") ||
    url.searchParams.get("code_challenge_method") !== "S256"
  ) {
    sendJson(res, 400, {error: "invalid_request"});
    return;
  }
  const identity = identityFor(req, url);
  if (!identity) {
    sendJson(res, 400, {error: "invalid_request", error_description: "bad mock identity"});
    return;
  }
  const code = randomBytes(16).toString("hex");
  pendingCodes.set(code, {
    codeChallenge: url.searchParams.get("code_challenge"),
    expiresAt: Date.now() + CODE_TTL_MS,
    identity,
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
  accessTokens.set(accessToken, pending.identity);
  sendJson(res, 200, {access_token: accessToken, expires_in: 3600, token_type: "Bearer"});
};

const handleUserinfo = (req: IncomingMessage, res: ServerResponse): void => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const identity = accessTokens.get(token);
  if (!identity) {
    sendJson(res, 401, {error: "invalid_token"});
    return;
  }
  // Without signed ID tokens in discovery, Better Auth reads the account id from `id`.
  sendJson(res, 200, {
    email: identity.email,
    email_verified: identity.emailVerified,
    id: identity.sub,
    name: identity.name,
    sub: identity.sub,
  });
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
    handleAuthorize(req, url, res);
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

/**
 * Starts the provider on 127.0.0.1, on MOCK_OIDC_PORT unless `port` says otherwise (0 picks a
 * free port; unit tests use it). Discovery always advertises MOCK_OIDC_ISSUER.
 */
export const startMockOidcProvider = ({port = MOCK_OIDC_PORT}: {port?: number} = {}): Server => {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      console.error("[mockOidcProvider] request failed", error);
      sendJson(res, 500, {error: "server_error"});
    });
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.info(`[mockOidcProvider] listening on 127.0.0.1:${boundPort}`);
  });
  return server;
};

if (process.env.MOCK_OIDC_SERVE === "true") {
  startMockOidcProvider();
}
