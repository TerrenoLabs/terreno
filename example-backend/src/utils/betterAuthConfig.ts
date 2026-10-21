import {APIError, type AuthProvider, type BetterAuthConfig} from "@terreno/api";
import {getCommsService, renderAuthMail} from "@terreno/comms";
import type {BetterAuthPlugin} from "better-auth";
import {genericOAuth} from "better-auth/plugins";

const DEFAULT_BETTER_AUTH_SECRET = "terreno-example-better-auth-secret-dev-only-32";
const DEFAULT_BETTER_AUTH_URL = "http://localhost:4000";

/** Dev web origins for the Expo frontend (localhost + loopback on the frontend port). */
const DEFAULT_WEB_ORIGINS = ["http://localhost:8082", "http://127.0.0.1:8082"];

/** Deep-link schemes used by the native app for Better Auth redirect validation. */
const APP_SCHEMES = ["frontend://", "terreno://", "exp://"];

/**
 * The example frontend's page that receives the OAuth one-time token: social sign-in starts and
 * ends on the login screen, which strips the fragment at startup and never redirects first.
 */
export const OAUTH_HANDOFF_CALLBACK_PATHS = ["/login"];

/** Generic OAuth provider id of the local mock OIDC provider that e2e runs sign in with. */
export const MOCK_OIDC_PROVIDER_ID = "mock-oidc";

// Matches example-frontend/e2e/helpers/mockOidcProvider.ts, which accepts only this client.
const MOCK_OIDC_CLIENT_ID = "terreno-example-e2e";
const MOCK_OIDC_CLIENT_SECRET = "terreno-example-e2e-secret";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The generic OAuth plugin for the mock OIDC provider at `MOCK_OIDC_ISSUER`, or undefined when
 * it is unset. Anyone who can run that issuer can sign in as anyone it names, so production
 * refuses to start with it set.
 */
const buildMockOidcPlugin = (): BetterAuthPlugin | undefined => {
  const issuer = process.env.MOCK_OIDC_ISSUER;
  if (!issuer) {
    return undefined;
  }
  if (process.env.NODE_ENV === "production") {
    throw new APIError({status: 500, title: "MOCK_OIDC_ISSUER must not be set in production"});
  }
  let issuerURL: URL;
  try {
    issuerURL = new URL(issuer);
  } catch {
    throw new APIError({status: 500, title: "MOCK_OIDC_ISSUER must be an http(s) origin"});
  }
  if (issuerURL.protocol !== "http:" && issuerURL.protocol !== "https:") {
    throw new APIError({status: 500, title: "MOCK_OIDC_ISSUER must be an http(s) origin"});
  }
  // The mock only ever runs beside the backend, so a deploy that forgot NODE_ENV still cannot
  // trust a remote issuer's identities.
  if (!LOOPBACK_HOSTS.has(issuerURL.hostname)) {
    throw new APIError({
      status: 500,
      title: "MOCK_OIDC_ISSUER must be on 127.0.0.1, localhost, or [::1]",
    });
  }
  return genericOAuth({
    config: [
      {
        clientId: MOCK_OIDC_CLIENT_ID,
        clientSecret: MOCK_OIDC_CLIENT_SECRET,
        discoveryUrl: `${issuerURL.origin}/.well-known/openid-configuration`,
        pkce: true,
        providerId: MOCK_OIDC_PROVIDER_ID,
      },
    ],
  });
};

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
export const getWebOrigins = (): string[] => {
  const origins = new Set<string>(DEFAULT_WEB_ORIGINS);
  const fromEnv = process.env.CORS_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of fromEnv ?? []) {
    origins.add(origin);
  }
  return [...origins];
};

/**
 * Web origins that may receive the OAuth one-time token. Production drops loopback origins
 * (any port): a token sent to a localhost page reaches whatever runs on the visitor's machine.
 * CORS and `trustedOrigins` keep them. Throws in production when no origin is left, because the
 * handoff was asked for but no deployed web app could receive it.
 */
export const getOAuthHandoffWebOrigins = (): string[] => {
  const origins = getWebOrigins();
  if (process.env.NODE_ENV !== "production") {
    return origins;
  }
  const deployed = origins.filter((origin) => {
    try {
      return !LOOPBACK_HOSTS.has(new URL(origin).hostname);
    } catch {
      return false;
    }
  });
  if (deployed.length === 0) {
    throw new APIError({
      status: 500,
      title:
        "BETTER_AUTH_OAUTH_HANDOFF=true in production needs a non-loopback web origin in CORS_ORIGINS",
    });
  }
  return deployed;
};

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

  // Cross-site web apps in bearer mode get the session from a one-time token on the
  // login page instead of the callback's cookie.
  if (process.env.BETTER_AUTH_OAUTH_HANDOFF === "true") {
    config.oauthHandoff = {
      callbackPaths: OAUTH_HANDOFF_CALLBACK_PATHS,
      webOrigins: getOAuthHandoffWebOrigins(),
    };
  }

  const mockOidcPlugin = buildMockOidcPlugin();
  if (mockOidcPlugin) {
    config.plugins = [mockOidcPlugin];
  }

  return config;
};
