import {logger} from "@terreno/api";
import type express from "express";

/**
 * Decides which signed-in users may use the server's Vertex AI models. A user qualifies when their
 * Better Auth user has a linked Google account whose ID token carries a Google Workspace hosted
 * domain (`hd`) on the allow-list. `hd` is only set for Workspace-managed accounts, so a personal
 * Google account that merely uses a company email address does not qualify.
 */

/** Domains allowed when `VERTEX_ALLOWED_EMAIL_DOMAINS` is unset. */
export const DEFAULT_VERTEX_ALLOWED_DOMAINS = ["flourish.health"];

const GOOGLE_PROVIDER_ID = "google";

interface GoogleAccountRow {
  idToken?: string | null;
  providerId: string;
}

interface VertexAccessAuthContext {
  internalAdapter: {
    findAccounts: (userId: string) => Promise<GoogleAccountRow[]>;
  };
}

interface VertexAccessAuth {
  $context: Promise<unknown>;
}

export interface CreateVertexAccessCheckOptions {
  /** Hosted domains that qualify, lowercase. */
  allowedDomains: string[];
  /** Returns the Better Auth instance, or undefined when Better Auth is not configured. */
  getAuth: () => VertexAccessAuth | undefined;
}

/**
 * Parse the comma-separated `VERTEX_ALLOWED_EMAIL_DOMAINS` value. Unset or blank falls back to
 * `DEFAULT_VERTEX_ALLOWED_DOMAINS`.
 */
export const parseVertexAllowedDomains = (raw: string | undefined): string[] => {
  const domains = (raw ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  return domains.length > 0 ? domains : DEFAULT_VERTEX_ALLOWED_DOMAINS;
};

/**
 * Read the `hd` claim from a Google ID token, lowercase. The token was verified by Better Auth when
 * it was stored at sign-in, so only the payload is decoded here.
 */
export const readGoogleHostedDomain = (idToken: string | null | undefined): string | undefined => {
  if (!idToken) {
    return undefined;
  }
  const payload = idToken.split(".")[1];
  if (!payload) {
    return undefined;
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      hd?: unknown;
    };
    return typeof claims.hd === "string" && claims.hd ? claims.hd.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};

/** Build a request check that answers whether the signed-in user may use Vertex. */
export const createVertexAccessCheck = ({
  allowedDomains,
  getAuth,
}: CreateVertexAccessCheckOptions): ((req: express.Request) => Promise<boolean>) => {
  const allowed = new Set(allowedDomains.map((domain) => domain.toLowerCase()));
  return async (req: express.Request): Promise<boolean> => {
    const betterAuthId = (req.user as {betterAuthId?: string} | undefined)?.betterAuthId;
    if (!betterAuthId) {
      return false;
    }
    const auth = getAuth();
    if (!auth) {
      return false;
    }
    try {
      const context = (await auth.$context) as VertexAccessAuthContext;
      const accounts = await context.internalAdapter.findAccounts(betterAuthId);
      return accounts.some((account) => {
        if (account.providerId !== GOOGLE_PROVIDER_ID) {
          return false;
        }
        const hostedDomain = readGoogleHostedDomain(account.idToken);
        return hostedDomain !== undefined && allowed.has(hostedDomain);
      });
    } catch (error) {
      logger.warn(`Vertex access check failed: ${(error as Error).message}`);
      return false;
    }
  };
};
