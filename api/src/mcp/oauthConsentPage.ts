/**
 * Built-in MCP OAuth consent page (`mcpOAuth.consent.mode: "builtin"`). A server-rendered form
 * that asks for email, password, and an authenticator code on every approval, so an app needs no
 * SPA consent screen and approval never rests on a long-lived session. Password and TOTP are
 * checked against the user's Better Auth credential account and `twoFactor` record in-process.
 */
import {createHmac, timingSafeEqual} from "node:crypto";
import {symmetricDecrypt} from "better-auth/crypto";
import type {Application, Request, Response} from "express";
import {DateTime} from "luxon";

import type {User, UserModel} from "../auth";
import {type BetterAuthInstance, verifyBetterAuthCredentialPassword} from "../betterAuthSetup";
import {isAPIError} from "../errors";
import {logger} from "../logger";
import {McpOAuthConsentAttempt} from "../models/mcpOAuthConsentAttempt";
import type {McpOAuthAuthorizationDocument, McpOAuthClientDocument} from "../types/mcpOAuth";
import {
  approvalPolicyProblem,
  approveAuthorization,
  consentGrantsFor,
  denyAuthorization,
  loadActiveClient,
  loadPendingAuthorization,
} from "./oauth";
import type {ResolvedMcpOAuthOptions} from "./oauthMetadata";

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
// Accept the previous and next step for clock drift, as Better Auth's own verify does.
const TOTP_WINDOW = 1;

const WRONG_CREDENTIALS = "Wrong email, password, or authenticator code.";
const LOCKED = "Too many failed attempts. Try again in 15 minutes.";

export interface McpOAuthConsentPageOptions {
  betterAuth: BetterAuthInstance;
  oauth: ResolvedMcpOAuthOptions;
  userModel: UserModel;
}

/** Path of the built-in consent page for one pending request. */
const builtinConsentPath = (requestId: string): string =>
  `/oauth/consent/${encodeURIComponent(requestId)}`;

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({"'": "&#39;", '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;"})[char] ?? char
  );

/**
 * Send an HTML page. `formTarget` is the client redirect's origin: browsers apply `form-action`
 * to the redirect that answers a form POST, so the form must be allowed to land there.
 */
const sendPage = (
  res: Response,
  status: number,
  title: string,
  body: string,
  formTarget?: string
): void => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${formTarget ? ` ${formTarget}` : ""}; frame-ancestors 'none'`
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res
    .status(status)
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#222}label{display:block;margin:.6rem 0}input{width:100%;padding:.5rem;font-size:1rem;box-sizing:border-box}button{padding:.6rem 1.2rem;font-size:1rem;margin-right:.5rem}.error{color:#b00020}</style></head><body>${body}</body></html>`
    );
};

const sendErrorPage = (res: Response, title: string, detail: string): void => {
  sendPage(res, 400, title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>`);
};

const sendConsentForm = (
  res: Response,
  oauth: ResolvedMcpOAuthOptions,
  authorization: McpOAuthAuthorizationDocument,
  client: McpOAuthClientDocument,
  {email, error}: {email?: string; error?: string} = {}
): void => {
  const name = client.clientName ?? client.clientId;
  const redirect = new URL(authorization.redirectUri);
  const grants = consentGrantsFor(authorization.scope, oauth.grants)
    .map(
      (grant) =>
        `<li><strong>${escapeHtml(grant.label)}</strong>${grant.description ? ` ${escapeHtml(grant.description)}` : ""}</li>`
    )
    .join("");
  sendPage(
    res,
    error ? 400 : 200,
    `Allow ${name}?`,
    `<h1>Allow ${escapeHtml(name)}?</h1>
<p>${escapeHtml(name)} wants to connect to your account. You will be sent back to <strong>${escapeHtml(redirect.host)}</strong>.</p>
${grants ? `<ul>${grants}</ul>` : ""}
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
<form method="post" action="${escapeHtml(builtinConsentPath(authorization.requestId))}">
<label>Email <input type="email" name="email" autocomplete="username" value="${escapeHtml(email ?? "")}" required></label>
<label>Password <input type="password" name="password" autocomplete="current-password" required></label>
<label>Authenticator code <input name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label>
<button type="submit" name="decision" value="approve">Allow</button>
<button type="submit" name="decision" value="deny" formnovalidate>Deny</button>
</form>`,
    redirect.origin
  );
};

interface ConsentBetterAuthContext {
  adapter: {
    findOne: <T>(args: {
      model: string;
      where: {field: string; value: string}[];
    }) => Promise<T | null>;
  };
  internalAdapter: {
    findUserByEmail: (email: string) => Promise<{user: {id: string}} | null>;
  };
  secretConfig: Parameters<typeof symmetricDecrypt>[0]["key"];
}

/** One RFC 4226 HOTP value: HMAC-SHA1, dynamic truncation, six digits. */
const hotp = (secret: Buffer, counter: number): string => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(value).padStart(TOTP_DIGITS, "0");
};

/** The RFC 6238 time step `code` matches, within the drift window, or null. */
const matchTotpStep = (secret: string, code: string): number | null => {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  const key = Buffer.from(secret, "utf8");
  const current = Math.floor(DateTime.now().toSeconds() / TOTP_PERIOD_SECONDS);
  let matched: number | null = null;
  // Check every step in the window so timing doesn't reveal which one matched.
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const step = current + offset;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) {
      matched = step;
    }
  }
  return matched;
};

const normalizeEmail = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const isLocked = async (email: string): Promise<boolean> => {
  const since = DateTime.now().minus({minutes: LOCKOUT_MINUTES}).toJSDate();
  const failures = await McpOAuthConsentAttempt.countDocuments({
    created: {$gte: since},
    key: email,
    kind: "failure",
  });
  return failures >= MAX_FAILURES;
};

const recordFailure = async (email: string): Promise<void> => {
  await McpOAuthConsentAttempt.create({
    expiresAt: DateTime.now().plus({minutes: LOCKOUT_MINUTES}).toJSDate(),
    key: email,
    kind: "failure",
  });
};

/** Record a used TOTP step. False when it was already used: a replay. */
const useTotpStep = async (betterAuthUserId: string, step: number): Promise<boolean> => {
  // The unique index is the replay check, so it must exist before the first insert.
  await McpOAuthConsentAttempt.init();
  try {
    await McpOAuthConsentAttempt.create({
      // Keep it past the last moment the step could still verify.
      expiresAt: DateTime.now()
        .plus({seconds: TOTP_PERIOD_SECONDS * (TOTP_WINDOW + 2)})
        .toJSDate(),
      key: betterAuthUserId,
      kind: "totpStep",
      step,
    });
    return true;
  } catch (error) {
    if ((error as {code?: number}).code === 11000) {
      return false;
    }
    throw error;
  }
};

/**
 * Check email, password, and TOTP. Returns the app user, or null for any mismatch, so the caller
 * shows one message whatever was wrong. A matching code's step is spent only when everything
 * else matched.
 */
const verifyApprover = async (
  options: McpOAuthConsentPageOptions,
  email: string,
  password: string,
  code: string
): Promise<User | null> => {
  const {betterAuth, userModel} = options;
  const context = (await betterAuth.$context) as unknown as ConsentBetterAuthContext;
  const found = email ? await context.internalAdapter.findUserByEmail(email) : null;
  if (!found) {
    return null;
  }
  const betterAuthId = found.user.id;
  const passwordCheck = await verifyBetterAuthCredentialPassword(
    betterAuth,
    {betterAuthId},
    password
  );
  const twoFactor = await context.adapter.findOne<{secret: string; verified?: boolean | null}>({
    model: "twoFactor",
    where: [{field: "userId", value: betterAuthId}],
  });
  if (passwordCheck !== "verified" || !twoFactor || twoFactor.verified === false) {
    return null;
  }
  const secret = await symmetricDecrypt({data: twoFactor.secret, key: context.secretConfig});
  const step = matchTotpStep(secret, code);
  if (step === null || !(await useTotpStep(betterAuthId, step))) {
    return null;
  }
  const user = (await userModel.findOne({betterAuthId})) as unknown as User | null;
  return user ?? null;
};

/** The pending request and its client, or an error page and null. */
const loadRequest = async (
  res: Response,
  requestId: string
): Promise<{
  authorization: McpOAuthAuthorizationDocument;
  client: McpOAuthClientDocument;
} | null> => {
  try {
    const authorization = await loadPendingAuthorization(requestId);
    const client = await loadActiveClient(authorization.clientId);
    return {authorization, client};
  } catch (error) {
    if (isAPIError(error)) {
      sendErrorPage(
        res,
        "This request can't be approved",
        `${error.title}. Start again from the app you are connecting.`
      );
      return null;
    }
    throw error;
  }
};

/**
 * Run a decision. A request decided concurrently, or a client revoked meanwhile, gets an error
 * page and no redirect.
 */
const decideOrErrorPage = async (
  res: Response,
  decide: () => Promise<string>
): Promise<string | null> => {
  try {
    return await decide();
  } catch (error) {
    if (isAPIError(error)) {
      sendErrorPage(res, "This request can't be approved", `${error.title}.`);
      return null;
    }
    throw error;
  }
};

const formString = (body: unknown, field: string): string => {
  const value = (body as Record<string, unknown> | null | undefined)?.[field];
  return typeof value === "string" ? value : "";
};

/**
 * Mount `GET` and `POST /oauth/consent/:request`. `/oauth/authorize` sends the browser here in
 * builtin mode instead of to `consentUrl`.
 */
export const addMcpOAuthConsentPage = (
  app: Application,
  options: McpOAuthConsentPageOptions
): void => {
  const {oauth} = options;

  app.get("/oauth/consent/:request", async (req: Request, res: Response, next) => {
    try {
      const loaded = await loadRequest(res, String(req.params.request));
      if (loaded) {
        sendConsentForm(res, oauth, loaded.authorization, loaded.client);
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/oauth/consent/:request", async (req: Request, res: Response, next) => {
    try {
      const loaded = await loadRequest(res, String(req.params.request));
      if (!loaded) {
        return;
      }
      const {authorization, client} = loaded;
      if (formString(req.body, "decision") !== "approve") {
        const denied = await decideOrErrorPage(res, () =>
          denyAuthorization({oauth, pending: authorization})
        );
        if (denied) {
          res.setHeader("Cache-Control", "no-store");
          res.redirect(302, denied);
        }
        return;
      }
      const email = normalizeEmail(formString(req.body, "email"));
      const showError = (error: string): void =>
        sendConsentForm(res, oauth, authorization, client, {email, error});
      if (!email || (await isLocked(email))) {
        showError(email ? LOCKED : WRONG_CREDENTIALS);
        return;
      }
      const user = await verifyApprover(
        options,
        email,
        formString(req.body, "password"),
        formString(req.body, "totp").trim()
      );
      if (!user) {
        await recordFailure(email);
        logger.warn("[MCPOAuth] Built-in consent refused credentials", {
          clientId: client.clientId,
        });
        showError(WRONG_CREDENTIALS);
        return;
      }
      await McpOAuthConsentAttempt.deleteMany({key: email, kind: "failure"});
      if ((user as {disabled?: boolean}).disabled) {
        showError("This account is disabled.");
        return;
      }
      const problem = await approvalPolicyProblem(user, oauth, options.betterAuth);
      if (problem) {
        showError(`${problem}.`);
        return;
      }
      const redirectUrl = await decideOrErrorPage(res, () =>
        approveAuthorization({oauth, pending: authorization, scope: authorization.scope, user})
      );
      if (redirectUrl) {
        res.setHeader("Cache-Control", "no-store");
        res.redirect(302, redirectUrl);
      }
    } catch (error) {
      next(error);
    }
  });
};
