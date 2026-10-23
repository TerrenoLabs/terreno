import type {OutgoingMessage} from "node:http";
import * as Sentry from "@sentry/bun";
import cron from "cron";
import express, {type Router} from "express";
import type jwt from "jsonwebtoken";
import onFinished from "on-finished";
import passport from "passport";
import type {ModelRouterOptions} from "./api";
import type {User} from "./auth";
import {APIError} from "./errors";
import {type LoggingOptions, logger} from "./logger";
import {sendToSlack} from "./notifiers/slackNotifier";

const SLOW_READ_MAX = 200;
const SLOW_WRITE_MAX = 500;
const IS_JEST = process.env.JEST_WORKER_ID !== undefined;
const REDACTED = "<REDACTED>";
// Stop at a depth no real request body reaches, so a self-referencing body cannot loop.
const MAX_REDACTION_DEPTH = 32;

// Matched anywhere in a key after lowercasing and removing separators, e.g. currentPassword,
// refresh_token, client_secret, code_verifier, x-api-key.
const SENSITIVE_KEY_FRAGMENTS = [
  "apikey",
  "authorization",
  "credential",
  "passcode",
  "passphrase",
  "passwd",
  "password",
  "privatekey",
  "secret",
  "signature",
  "token",
  "verifier",
] as const;

// Matched as whole words of a key, so `code` covers OAuth and verification codes without
// matching unrelated words that merely contain the letters.
const SENSITIVE_KEY_WORDS = new Set<string>(["code", "otp", "pin"]);

const keyWords = (key: string): string[] => {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
};

/** Whether a request body or query key names credential material that must not be logged. */
const isSensitiveRequestKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
    return true;
  }
  return keyWords(key).some((word) => SENSITIVE_KEY_WORDS.has(word));
};

const redactSensitiveValue = (value: unknown, depth: number): unknown => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_REDACTION_DEPTH) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, depth + 1));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child !== undefined && isSensitiveRequestKey(key)) {
      redacted[key] = REDACTED;
    } else {
      redacted[key] = redactSensitiveValue(child, depth + 1);
    }
  }
  return redacted;
};

const redactSensitiveRequestBody = (body: Record<string, unknown>): unknown => {
  return redactSensitiveValue(body, 0);
};

export const redactSensitiveRequestUrl = (url: string | undefined): string => {
  if (!url) {
    return "";
  }
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
  const parsed = new URL(url, "http://terreno.invalid");
  let didRedact = false;
  for (const key of parsed.searchParams.keys()) {
    if (isSensitiveRequestKey(key)) {
      parsed.searchParams.set(key, REDACTED);
      didRedact = true;
    }
  }
  if (!didRedact) {
    return url;
  }
  if (isAbsolute) {
    return parsed.toString();
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};

export const setupEnvironment = (): void => {
  if (!process.env.TOKEN_ISSUER) {
    throw new APIError({status: 500, title: "TOKEN_ISSUER must be set in env."});
  }
  if (!process.env.TOKEN_SECRET) {
    throw new APIError({status: 500, title: "TOKEN_SECRET must be set."});
  }
  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new APIError({status: 500, title: "REFRESH_TOKEN_SECRET must be set."});
  }
  if (!process.env.SESSION_SECRET) {
    throw new APIError({status: 500, title: "SESSION_SECRET must be set."});
  }
  if (!process.env.TOKEN_EXPIRES_IN && !IS_JEST) {
    logger.warn("TOKEN_EXPIRES_IN is not set so using default.");
  }
  if (!process.env.REFRESH_TOKEN_EXPIRES_IN && !IS_JEST) {
    logger.warn("REFRESH_TOKEN_EXPIRES_IN not set so using default.");
  }
};

export type AddRoutes = (router: Router, options?: Partial<ModelRouterOptions<unknown>>) => void;

interface LoggableRequest {
  body?: Record<string, unknown>;
  method: string;
  originalUrl?: string;
  route?: {path: string};
  routeMount?: string | string[];
  url?: string;
  user?: {
    admin?: boolean;
    id?: string;
    testUser?: boolean;
    type?: string;
  };
}

interface LoggableResponse {
  locals?: {loggingOptions?: LoggingOptions};
  statusCode?: number;
}

const logRequestsFinished = (req: LoggableRequest, res: LoggableResponse, startTime: bigint) => {
  const options = (res.locals?.loggingOptions ?? {}) as LoggingOptions;

  const slowReadMs = options.logSlowRequestsReadMs ?? SLOW_READ_MAX;
  const slowWriteMs = options.logSlowRequestsWriteMs ?? SLOW_WRITE_MAX;

  const diff = process.hrtime.bigint() - startTime;
  const diffInMs = Number(diff) / 1000000;
  let pathName = "unknown";
  if (req.route && req.routeMount) {
    pathName = `${req.routeMount}${req.route.path}`;
  } else if (req.route) {
    pathName = req.route.path;
  } else if (res.statusCode != null && res.statusCode < 400) {
    logger.warn(`Request without route: ${redactSensitiveRequestUrl(req.originalUrl)}`);
  }
  if (process.env.DISABLE_LOG_ALL_REQUESTS !== "true") {
    logger.debug(
      `${req.method} -> ${redactSensitiveRequestUrl(req.originalUrl)} ${res.statusCode} ${`${diffInMs}ms`}`
    );
  }
  if (options.logSlowRequests) {
    if (diffInMs > slowReadMs && req.method === "GET") {
      logger.warn(
        `Slow GET request, ${JSON.stringify({
          pathName,
          requestTime: diffInMs,
          url: redactSensitiveRequestUrl(req.originalUrl),
        })}`
      );
    } else if (diffInMs > slowWriteMs) {
      logger.warn(
        `Slow write request ${JSON.stringify({
          pathName,
          requestTime: diffInMs,
          url: redactSensitiveRequestUrl(req.originalUrl),
        })}`
      );
    }
  }
};

export const logRequests = (
  req: LoggableRequest,
  res: LoggableResponse,
  next: express.NextFunction
): void => {
  const startTime = process.hrtime.bigint();

  let userString = "";
  if (req.user) {
    let type = "User";
    if (req.user?.admin) {
      type = "Admin";
    } else if (req.user?.testUser) {
      type = "Test User";
    } else if (req.user?.type) {
      type = req.user?.type;
    }
    userString = ` <${type}:${req.user.id}>`;
  }

  let body = "";
  if (req.body && Object.keys(req.body).length > 0) {
    body = ` Body: ${JSON.stringify(redactSensitiveRequestBody(req.body))}`;
  }

  if (process.env.DISABLE_LOG_ALL_REQUESTS !== "true") {
    logger.debug(`${req.method} <- ${redactSensitiveRequestUrl(req.url)}${userString}${body}`);
  }
  onFinished(res as unknown as OutgoingMessage, () => logRequestsFinished(req, res, startTime));
  next();
};

export const createRouter = (
  rootPath: string,
  addRoutes: AddRoutes,
  middleware: express.RequestHandler[] = []
): Array<string | express.RequestHandler | Router> => {
  const routePathMiddleware = (
    req: express.Request & {routeMount?: string[]},
    _res: express.Response,
    next: express.NextFunction
  ): void => {
    if (!req.routeMount) {
      req.routeMount = [];
    }
    req.routeMount.push(rootPath);
    next();
  };

  const router = express.Router();
  router.use(routePathMiddleware);
  addRoutes(router);
  return [rootPath, ...middleware, router];
};

export const createRouterWithAuth = (
  rootPath: string,
  addRoutes: (router: Router) => void,
  middleware: express.RequestHandler[] = []
): Array<string | express.RequestHandler | Router> => {
  return createRouter(rootPath, addRoutes, [
    passport.authenticate("firebase-jwt", {session: false}),
    ...middleware,
  ]);
};

export interface AuthRecoveryMail {
  html?: string;
  /**
   * True on Terreno's recovery mail: it carries a one-time secret link. Mail transports should
   * not store its content; `@terreno/comms` keeps no payload for it in the message log.
   */
  sensitive?: boolean;
  subject: string;
  text: string;
  to: string;
}

export interface AuthOptions {
  generateJWTPayload?: (user: User) => Record<string, unknown>;
  generateTokenExpiration?: (user: User) => number | jwt.SignOptions["expiresIn"];
  generateRefreshTokenExpiration?: (user: User) => number | jwt.SignOptions["expiresIn"];
  /** Register JWT forgot-password and token-reset routes. Default true. */
  passwordReset?: boolean;
  /**
   * Register the deprecated `POST /resetPassword` RTK compatibility alias.
   * Default true. Set false when the host owns that path; `/auth/resetPassword`
   * remains available when `passwordReset` is enabled.
   */
  legacyResetPasswordRoute?: boolean;
  /** Register JWT send-verification and verify-email routes. Default true. */
  emailVerification?: boolean;
  /** Public web/app origin used in password-reset and verification links. */
  publicAppUrl?: string;
  /**
   * Deliver recovery mail (forgot password / verify email). Wire to
   * `getCommsService().sendMail` when `@terreno/comms` is registered.
   */
  sendMail?: (message: AuthRecoveryMail) => Promise<void>;
  /** When true, unverified users receive 403 `email-not-verified` on login. Default false. */
  requireEmailVerification?: boolean;
  /**
   * After a successful JWT password reset, update the Better Auth credential hash
   * and delete that user's Better Auth sessions. TerrenoApp wires this when
   * BetterAuthApp is registered.
   */
  syncPasswordResetToBetterAuth?: (user: User, password: string) => Promise<void>;
}

export const cronjob = (
  name: string,
  schedule: "hourly" | "minutely" | string,
  callback: () => void
): void => {
  const cronSchedule =
    schedule === "hourly" ? "0 * * * *" : schedule === "minutely" ? "* * * * *" : schedule;
  logger.info(`Adding cronjob ${name}, running at: ${cronSchedule}`);
  try {
    new cron.CronJob(cronSchedule, callback, null, true, "America/Chicago");
  } catch (error) {
    throw new APIError({
      cause: error,
      detail: `Failed to create cronjob ${name} with schedule ${cronSchedule}: ${error}`,
      status: 500,
      title: "Failed to create cronjob",
    });
  }
};

export interface WrapScriptOptions {
  onFinish?: (result?: unknown) => void | Promise<void>;
  terminateTimeout?: number; // in seconds, defaults to 300. Set to 0 to have no termination timeout.
  slackChannel?: string;
}
export const wrapScript = async (
  func: () => Promise<unknown>,
  options: WrapScriptOptions = {}
): Promise<void> => {
  const name = require.main?.filename.split("/").slice(-1)[0].replace(".ts", "");
  logger.info(`Running script ${name}`);
  await sendToSlack(`Running script ${name}`, {
    slackChannel: options.slackChannel,
  });

  if (options.terminateTimeout !== 0) {
    const warnTime = ((options.terminateTimeout ?? 300) / 2) * 1000;
    const closeTime = (options.terminateTimeout ?? 300) * 1000;
    setTimeout(async () => {
      const msg = `Script ${name} is taking a while, currently ${warnTime / 1000} seconds`;
      await sendToSlack(msg);
      logger.warn(msg);
    }, warnTime);

    setTimeout(async () => {
      const msg = `Script ${name} took too long, exiting`;
      await sendToSlack(msg);
      logger.error(msg);
      Sentry.captureException(new Error(`Script ${name} took too long, exiting`));
      await Sentry.flush();
      process.exit(2);
    }, closeTime);
  }

  let result: unknown;
  try {
    result = await func();
    if (options.onFinish) {
      await options.onFinish(result);
    }
  } catch (error) {
    Sentry.captureException(error);
    logger.error(`Error running script ${name}: ${error}\n${(error as Error).stack}`);
    await sendToSlack(`Error running script ${name}: ${error}\n${(error as Error).stack}`);
    await Sentry.flush();
    process.exit(1);
  }
  await sendToSlack(`Success running script ${name}: ${result}`);
  process.exit(0);
};
