import type {NextFunction, Request, Response} from "express";
import {DateTime} from "luxon";

import {APIError} from "../errors";
import {createRateLimitStore} from "./createStore";
import {setRateLimitExceededHeaders} from "./middleware";
import type {RateLimitOptions, RateLimitStore} from "./types";

export interface RouteRateLimitOptions {
  /** Bucket namespace so separate route limits never share counters. */
  name: string;
  /** Requests allowed per key in each window. */
  max: number;
  windowMs: number;
  /** Shared backing store. Defaults to `memory` (per process). */
  store?: RateLimitOptions["store"];
  /**
   * Bucket key. `ip` (default) uses `req.ip`, so set Express `trust proxy` behind a load
   * balancer. `user` keys by authenticated user id and falls back to IP.
   */
  keyBy?: "ip" | "user";
  /** Test-only clock. */
  now?: () => number;
  /** Test-only store override. */
  storeImpl?: RateLimitStore;
}

const requestIp = (req: Request): string => {
  return req.ip || req.socket?.remoteAddress || "unknown";
};

const routeRateLimitKey = (req: Request, keyBy: "ip" | "user"): string => {
  if (keyBy === "user") {
    const user = req.user as {_id?: unknown; id?: string} | undefined;
    const userId = user?.id ?? (user?._id != null ? String(user._id) : undefined);
    if (userId) {
      return `user:${userId}`;
    }
  }
  return `ip:${requestIp(req)}`;
};

/**
 * Express middleware enforcing a fixed-window limit on a single route, independent of the
 * global `TerrenoApp` `rateLimit` buckets. Use it for expensive or abuse-prone endpoints
 * such as uploads.
 */
export const createRouteRateLimitMiddleware = (
  options: RouteRateLimitOptions
): ((req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  if (!options.name) {
    throw new APIError({status: 500, title: "Route rate limit requires a name"});
  }
  if (!(options.max > 0) || !(options.windowMs > 0)) {
    throw new APIError({
      status: 500,
      title: "Route rate limit max and windowMs must be positive",
    });
  }
  const store = createRateLimitStore({store: options.store, storeImpl: options.storeImpl});
  const keyBy = options.keyBy ?? "ip";
  const nowFn = options.now ?? ((): number => DateTime.now().toMillis());
  const {max, windowMs} = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `route:${options.name}:${routeRateLimitKey(req, keyBy)}`;
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
          disableExternalErrorTracking: true,
          status: 429,
          title: "Too many requests",
        })
      );
    } catch (error) {
      next(error);
    }
  };
};
