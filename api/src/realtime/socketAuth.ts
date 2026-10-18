import {authorize, UnauthorizedError} from "@thream/socketio-jwt";
import type {Socket} from "socket.io";

import type {UserModel} from "../auth";
import type {BetterAuthUser} from "../betterAuth";
import {type BetterAuthInstance, resolveBetterAuthAppUser} from "../betterAuthSetup";
import {APIError} from "../errors";
import {logger} from "../logger";
import type {SocketWithDecodedToken} from "./socketUser";

/**
 * Pluggable socket authentication for RealtimeApp.
 *
 * The Socket.io handshake token (`socket.handshake.auth.token`) is validated by a chain of
 * validators tried in order; the first one that succeeds populates `socket.decodedToken`
 * (the shape `getSocketUser` consumes) and the connection proceeds. If every validator
 * fails, the connection is rejected with the last validator's error.
 *
 * Validators:
 * 1. Legacy JWT (when a token secret is configured, always first) — the existing
 *    `@thream/socketio-jwt` middleware, wrapped unchanged so accepted payloads, secret
 *    handling, and error shapes are byte-for-byte identical to the previous hardcoded setup.
 * 2. Better Auth session (optional) — enabled via `RealtimeAppOptions.betterAuth`. The
 *    handshake token is validated as a Better Auth session via `auth.api.getSession`
 *    (presented as an `Authorization: Bearer` credential, resolved by Better Auth's
 *    bearer plugin), and `socket.decodedToken` is populated as `{id, admin,
 *    isAnonymous: false}` exactly like the JWT path.
 */

/** The subset of a Socket.io socket the validators need. Lets tests pass a stub. */
export interface AuthenticatableSocket extends SocketWithDecodedToken {
  handshake: {auth: {[key: string]: unknown; token?: string}};
  encodedToken?: string;
}

/**
 * A socket auth validator: resolve after populating `socket.decodedToken`, or reject to
 * let the next validator in the chain try.
 */
export type SocketAuthValidator = (socket: AuthenticatableSocket) => Promise<void>;

/** Options for the Better Auth session validator. */
export interface BetterAuthSocketOptions {
  /** The instance returned by `createBetterAuth`. */
  auth: BetterAuthInstance;
  /**
   * Optional application user model. When provided, the Better Auth user is resolved to
   * the app user (via `betterAuthId`, created on first contact) so `decodedToken.id`/`admin`
   * match the identity the REST layer uses, and disabled users are refused. Without it, the
   * Better Auth user id is used and `admin` is false. `RealtimeApp` fills this in from its own
   * `userModel`, else the TerrenoApp's, when it is omitted.
   */
  userModel?: UserModel;
}

/**
 * Legacy JWT validator: wraps the `@thream/socketio-jwt` middleware so its observable
 * behavior (token format requirements, secret verification, `decodedToken` payload,
 * `UnauthorizedError` shapes) is identical to the previous direct `io.use(authorize(...))`.
 *
 * D1: `@thream/socketio-jwt`'s `authorize()` has no `issuer` option — it only verifies
 * the signature/algorithm — so without this the socket path silently accepted a
 * validly-signed token issued for a DIFFERENT `TOKEN_ISSUER` (e.g. a token from another
 * environment sharing the same `TOKEN_SECRET`), unlike the HTTP path's
 * `jwt.verify(token, secret, {issuer})`. When `issuer` is provided, the post-verify
 * `onAuthentication` hook checks `decodedToken.iss` and rejects a mismatch with the
 * same `UnauthorizedError` shape the signature-verification failure path uses, so
 * callers cannot distinguish "bad signature" from "wrong issuer" from the error alone
 * (matching the non-disclosure posture the HTTP path also has).
 *
 * `issuer` may be a plain string or a thunk (`() => string | undefined`) resolved on
 * EVERY handshake — the HTTP path's `jwt.verify` reads `process.env.TOKEN_ISSUER` fresh
 * per request rather than once at server startup, and a static string captured once at
 * `RealtimeApp.onServerCreated()` time would go stale if `TOKEN_ISSUER` changes later
 * (e.g. test suites that mutate it between fixtures). Pass a thunk to preserve that
 * per-request freshness; a plain string is still supported for callers who intentionally
 * want a fixed value.
 */
export const createLegacyJwtValidator = (
  tokenSecret: string,
  issuer?: string | (() => string | undefined)
): SocketAuthValidator => {
  const resolveIssuer = (): string | undefined =>
    typeof issuer === "function" ? issuer() : issuer;
  const middleware = authorize({
    onAuthentication: (decodedToken: {iss?: string}) => {
      const expectedIssuer = resolveIssuer();
      if (expectedIssuer && decodedToken?.iss !== expectedIssuer) {
        throw new UnauthorizedError("invalid_token", {
          message: "Unauthorized: Token is missing or invalid Bearer",
        });
      }
    },
    secret: tokenSecret,
  });
  return (socket) =>
    new Promise<void>((resolve, reject) => {
      // The socketio-jwt middleware types demand a full Socket; it only reads
      // handshake.auth.token and writes encodedToken/decodedToken.
      middleware(socket as unknown as Socket, (error) => {
        if (error) {
          reject(error);
          return;
        }
        // D1: stamp which validator authenticated this socket so the periodic
        // re-validation sweep knows to re-check local JWT expiry (not a Better Auth
        // session lookup) for it. The library already populated decodedToken with the
        // full JWT payload (exp/iss included), so this only adds the discriminator.
        if (socket.decodedToken) {
          socket.decodedToken.authKind = "jwt";
        }
        resolve();
      });
    });
};

/** Strip an optional `Bearer ` prefix from the handshake token. */
const extractRawToken = (socket: AuthenticatableSocket): string | null => {
  const {token} = socket.handshake.auth;
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  const parts = token.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") {
    return parts[1];
  }
  return token;
};

/**
 * Better Auth session validator: treats the handshake token as a Better Auth session token
 * and validates it via `auth.api.getSession` (the same lookup the HTTP session middleware
 * uses). The token is presented both as a bearer Authorization header (for the Better Auth
 * bearer plugin) and as the session cookie, so either transport configuration works.
 */
export const createBetterAuthValidator = (
  options: BetterAuthSocketOptions
): SocketAuthValidator => {
  const {auth, userModel} = options;
  return async (socket) => {
    const rawToken = extractRawToken(socket);
    if (!rawToken) {
      throw new UnauthorizedError("credentials_required", {message: "no token provided"});
    }

    // Validate as a bearer credential only. Better Auth's bearer plugin signs and
    // resolves the raw session token from the Authorization header. We deliberately do
    // NOT also present it as a session cookie: a raw (unsigned) token cookie fails
    // signature verification and, when both are sent, can shadow the working bearer path.
    const session = await auth.api.getSession({
      headers: {authorization: `Bearer ${rawToken}`} as Record<string, string>,
    });

    const betterAuthUserId = session?.user?.id;
    if (!betterAuthUserId) {
      throw new UnauthorizedError("invalid_token", {
        message: "Unauthorized: Better Auth session is missing or invalid",
      });
    }

    let id = String(betterAuthUserId);
    let admin = false;
    if (userModel) {
      // Same lookup as the REST session middleware: a user whose first contact after
      // signing up is this handshake gets their app user created here.
      let resolved: Awaited<ReturnType<typeof resolveBetterAuthAppUser>>;
      try {
        resolved = await resolveBetterAuthAppUser({
          betterAuthUser: session.user as BetterAuthUser,
          userModel,
        });
      } catch (error) {
        // Keep database details (model, field, duplicate-key values) out of the client error.
        logger.error(`[socket] Could not resolve the app user for a Better Auth session: ${error}`);
        throw new UnauthorizedError("invalid_token", {
          message: "Unauthorized: could not resolve the application user",
        });
      }
      const {isDisabled, user} = resolved;
      if (isDisabled) {
        logger.warn(`[socket] User ${user.id} is disabled, rejecting Better Auth session`);
        throw new UnauthorizedError("invalid_token", {
          message: "Unauthorized: user is disabled",
        });
      }
      const appUser = user as unknown as {_id: unknown; admin?: boolean};
      id = String(appUser._id);
      admin = appUser.admin === true;
    }

    socket.decodedToken = {admin, authKind: "better-auth", id, isAnonymous: false};
    // D1: retain the raw session token so the periodic re-validation sweep can re-run
    // `auth.api.getSession` for this socket without re-deriving it from the handshake
    // (which may have since changed if the client reconnected with a new token).
    socket.encodedToken = rawToken;
  };
};

/**
 * Build the Socket.io auth middleware from a validator chain: validators run in order and
 * the first success wins; when all fail the connection is rejected with the last error.
 */
export const createSocketAuthMiddleware = ({
  tokenSecret,
  issuer,
  betterAuth,
  extraValidators = [],
}: {
  /** Secret enabling the legacy JWT validator (same handling as before the refactor). */
  tokenSecret?: string;
  /**
   * JWT issuer to require (D1 parity with the HTTP path's `jwt.verify(token, secret,
   * {issuer})`). Omitted means no issuer check, matching pre-D1 behavior. A thunk is
   * resolved fresh on every handshake (see {@link createLegacyJwtValidator}).
   */
  issuer?: string | (() => string | undefined);
  /** Enables the Better Auth session validator after the legacy JWT validator. */
  betterAuth?: BetterAuthSocketOptions;
  /** Additional validators appended to the chain (after JWT and Better Auth). */
  extraValidators?: SocketAuthValidator[];
}): ((socket: Socket, next: (error?: Error) => void) => void) => {
  const validators: SocketAuthValidator[] = [];
  if (tokenSecret) {
    validators.push(createLegacyJwtValidator(tokenSecret, issuer));
  }
  if (betterAuth) {
    validators.push(createBetterAuthValidator(betterAuth));
  }
  validators.push(...extraValidators);

  if (validators.length === 0) {
    throw new APIError({
      status: 500,
      title: "[realtime] At least one socket authentication validator is required.",
    });
  }

  return (socket, next): void => {
    void (async () => {
      let lastError: Error = new UnauthorizedError("credentials_required", {
        message: "no token provided",
      });
      for (const validator of validators) {
        try {
          await validator(socket as unknown as AuthenticatableSocket);
          next();
          return;
        } catch (error: unknown) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
      logger.debug(`[realtime] Socket authentication failed: ${lastError.message}`);
      next(lastError);
    })();
  };
};
