import type {AuthProvider, BetterAuthConfig} from "@terreno/api";
import {getCommsService, renderAuthMail} from "@terreno/comms";

const DEFAULT_BETTER_AUTH_SECRET = "terreno-example-better-auth-secret-dev-only-32";
const DEFAULT_BETTER_AUTH_URL = "http://localhost:4000";

/** Dev web origins for the Expo frontend (localhost + loopback on the frontend port). */
const DEFAULT_WEB_ORIGINS = ["http://localhost:8082", "http://127.0.0.1:8082"];

/** Deep-link schemes used by the native app for Better Auth redirect validation. */
const APP_SCHEMES = ["frontend://", "terreno://", "exp://"];

export const getAuthProvider = (): AuthProvider => {
  const provider = process.env.AUTH_PROVIDER as AuthProvider | undefined;
  return provider ?? "better-auth";
};

/**
 * HTTP origins allowed to make credentialed cross-origin requests. Better Auth's web
 * client sends `credentials: "include"`, so the server must reflect a specific origin
 * (never the `*` wildcard) and allow credentials. Set `CORS_ORIGINS` (comma-separated)
 * in deployed envs to add the hosted frontend origin(s).
 */
const getWebOrigins = (): string[] => {
  const origins = new Set<string>(DEFAULT_WEB_ORIGINS);
  const fromEnv = process.env.CORS_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of fromEnv ?? []) {
    origins.add(origin);
  }
  return [...origins];
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Converts a `CORS_ORIGINS` entry to what the `cors` middleware matches. An entry with `*`
 * (for example `https://terreno-frontend-*-terrenolabs.vercel.app`, Vercel's per-deployment
 * preview hostname) becomes an anchored RegExp where `*` matches one DNS label fragment —
 * letters, digits, and hyphens, never a dot — so it cannot widen to another domain.
 */
export const toCorsOrigin = (origin: string): string | RegExp => {
  if (!origin.includes("*")) {
    return origin;
  }
  const pattern = origin.split("*").map(escapeRegExp).join("[a-z0-9-]+");
  return new RegExp(`^${pattern}$`, "i");
};

/**
 * Origins for `TerrenoApp`'s `corsOrigin`. Same list as {@link getWebOrigins}; wildcard
 * entries become RegExps, while Better Auth `trustedOrigins` receives the raw patterns and
 * applies its own wildcard matching.
 */
export const getCorsOrigins = (): Array<string | RegExp> => getWebOrigins().map(toCorsOrigin);

/**
 * Builds Better Auth configuration for the example backend.
 * Returns undefined when AUTH_PROVIDER is set to "jwt".
 */
export const buildBetterAuthConfig = (): BetterAuthConfig | undefined => {
  if (getAuthProvider() !== "better-auth") {
    return undefined;
  }

  const config: BetterAuthConfig = {
    baseURL: process.env.BETTER_AUTH_URL ?? DEFAULT_BETTER_AUTH_URL,
    crossDomainCookies: process.env.CROSS_DOMAIN_AUTH_COOKIES === "true",
    enabled: true,
    publicAppUrl: process.env.FRONTEND_URL || "http://localhost:8082",
    renderAuthMail,
    secret: process.env.BETTER_AUTH_SECRET ?? DEFAULT_BETTER_AUTH_SECRET,
    sendMail: async (message) => {
      await getCommsService().sendMail(message);
    },
    trustedOrigins: [...APP_SCHEMES, ...getWebOrigins()],
  };

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    config.googleOAuth = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    config.githubOAuth = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }

  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
    config.appleOAuth = {
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
    };
  }

  return config;
};
