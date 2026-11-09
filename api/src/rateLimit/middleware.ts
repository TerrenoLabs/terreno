import type {NextFunction, Request, Response} from "express";
import {DateTime} from "luxon";

import {APIError} from "../errors";
import {classifyRateLimitPolicy, rateLimitKey, shouldSkipRateLimit} from "./policies";
import type {RateLimitOptions, RateLimitStore} from "./types";
import {DEFAULT_API_MAX, DEFAULT_AUTH_MAX, DEFAULT_WINDOW_MS} from "./types";

const secondsUntil = (resetAt: number, now: number): number => {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
};

export const setRateLimitExceededHeaders = ({
  max,
  remaining,
  resetAt,
  now,
  windowMs,
  res,
}: {
  max: number;
  remaining: number;
  resetAt: number;
  now: number;
  windowMs: number;
  res: Response;
}): void => {
  const retryAfter = secondsUntil(resetAt, now);
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  res.setHeader("Retry-After", String(retryAfter));
  res.setHeader("RateLimit", `limit=${max}, remaining=${remaining}, reset=${retryAfter}`);
  res.setHeader("RateLimit-Policy", `${max};w=${windowSec}`);
};

export const createRateLimitMiddleware = (
  store: RateLimitStore,
  options: RateLimitOptions = {}
): ((req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  const windowMs = options.limits?.windowMs ?? DEFAULT_WINDOW_MS;
  const authMax = options.limits?.authMax ?? DEFAULT_AUTH_MAX;
  const apiMax = options.limits?.apiMax ?? DEFAULT_API_MAX;
  const betterAuthBasePath = options.betterAuthBasePath;
  const nowFn = options.now ?? ((): number => DateTime.now().toMillis());

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (shouldSkipRateLimit(req, options.skip)) {
      next();
      return;
    }
    const policy = classifyRateLimitPolicy(req, betterAuthBasePath);
    const max = policy === "auth" ? authMax : apiMax;
    const key = `${policy}:${rateLimitKey(req, policy)}`;
    const now = nowFn();
    try {
      const result = await store.consume({key, max, now, windowMs});
      if (result.allowed) {
        next();
        return;
      }
      setRateLimitExceededHeaders({
        max,
        now,
        remaining: result.remaining,
        res,
        resetAt: result.resetAt,
        windowMs,
      });
      next(
        new APIError({
          code: "rate-limit-exceeded",
          status: 429,
          title: "Too many requests",
        })
      );
    } catch (error) {
      next(error);
    }
  };
};
