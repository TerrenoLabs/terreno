/**
 * Full validator matrix for the socket authentication chain (D1):
 *   - Legacy JWT validator (valid / expired / wrong-secret / wrong-issuer / missing token)
 *   - Better Auth session validator (valid / invalid session / missing token)
 *   - Chain fall-through and precedence
 *   - Bearer-prefix stripping
 *   - Issuer parity with the HTTP JWT path (D1), including per-handshake freshness
 *
 * Moved out of sync/syncSocket.test.ts (which still covers the higher-level
 * subscribe/mutate socket handlers) into its own file per the syncdb hardening plan.
 */
import {beforeEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import jwt from "jsonwebtoken";
import mongoose, {Schema} from "mongoose";
import type {Socket} from "socket.io";

import type {UserModel} from "../auth";
import {
  type AuthenticatableSocket,
  type BetterAuthSocketOptions,
  createBetterAuthValidator,
  createLegacyJwtValidator,
  createSocketAuthMiddleware,
} from "./socketAuth";

type StubbedAuth = BetterAuthSocketOptions["auth"];

interface SocketAuthUserFields {
  _id: mongoose.Types.ObjectId;
  admin?: boolean;
  betterAuthId?: string;
  disabled?: boolean;
  email?: string;
  name?: string;
}

const socketAuthUserSchema = new Schema({
  admin: {default: false, description: "Whether the user is an admin", type: Boolean},
  betterAuthId: {description: "Better Auth user id", type: String},
  disabled: {default: false, description: "Whether the account is disabled", type: Boolean},
  email: {description: "User email", type: String},
  name: {description: "Display name", type: String},
});

const getSocketAuthUserModel = (): mongoose.Model<SocketAuthUserFields> => {
  try {
    return mongoose.model<SocketAuthUserFields>("SocketAuthUser");
  } catch {
    return mongoose.model<SocketAuthUserFields>("SocketAuthUser", socketAuthUserSchema);
  }
};

describe("socketAuth", () => {
  const tokenSecret = "socket-auth-test-secret";

  const makeAuthSocket = (token?: string): AuthenticatableSocket => ({
    handshake: {auth: token === undefined ? {} : {token}},
  });

  const runMiddleware = (
    middleware: (socket: Socket, next: (error?: Error) => void) => void,
    socket: AuthenticatableSocket
  ): Promise<Error | undefined> =>
    new Promise((resolve) => {
      middleware(socket as unknown as Socket, (error?: Error) => resolve(error));
    });

  describe("createLegacyJwtValidator", () => {
    it("accepts a valid Bearer JWT and populates decodedToken", async () => {
      const validator = createLegacyJwtValidator(tokenSecret);
      const token = jwt.sign({admin: true, id: "jwt-user"}, tokenSecret);
      const socket = makeAuthSocket(`Bearer ${token}`);
      await validator(socket);
      expect(socket.decodedToken?.id).toBe("jwt-user");
      expect(socket.decodedToken?.admin).toBe(true);
    });

    it("stamps authKind: 'jwt' on a successful validation (D1 sweep discriminator)", async () => {
      const validator = createLegacyJwtValidator(tokenSecret);
      const token = jwt.sign({id: "jwt-user"}, tokenSecret);
      const socket = makeAuthSocket(`Bearer ${token}`);
      await validator(socket);
      expect(socket.decodedToken?.authKind).toBe("jwt");
    });

    it("rejects an expired JWT", async () => {
      const validator = createLegacyJwtValidator(tokenSecret);
      const token = jwt.sign({id: "jwt-user"}, tokenSecret, {expiresIn: -10});
      await expect(validator(makeAuthSocket(`Bearer ${token}`))).rejects.toThrow(
        "Token is missing or invalid Bearer"
      );
    });

    it("rejects a token signed with the wrong secret", async () => {
      const validator = createLegacyJwtValidator(tokenSecret);
      const token = jwt.sign({id: "jwt-user"}, "wrong-secret");
      await expect(validator(makeAuthSocket(`Bearer ${token}`))).rejects.toThrow(
        "Token is missing or invalid Bearer"
      );
    });

    it("rejects a token without the Bearer prefix", async () => {
      const validator = createLegacyJwtValidator(tokenSecret);
      const token = jwt.sign({id: "jwt-user"}, tokenSecret);
      await expect(validator(makeAuthSocket(token))).rejects.toThrow(
        "Format is Authorization: Bearer [token]"
      );
    });

    it("rejects when no token is provided", async () => {
      const validator = createLegacyJwtValidator(tokenSecret);
      await expect(validator(makeAuthSocket(undefined))).rejects.toThrow("no token provided");
    });

    // D1: parity with the HTTP JWT path's jwt.verify(token, secret, {issuer}).
    describe("issuer parity (D1)", () => {
      it("accepts a token whose iss matches the required issuer", async () => {
        const validator = createLegacyJwtValidator(tokenSecret, "expected-issuer");
        const token = jwt.sign({id: "jwt-user"}, tokenSecret, {issuer: "expected-issuer"});
        const socket = makeAuthSocket(`Bearer ${token}`);
        await validator(socket);
        expect(socket.decodedToken?.id).toBe("jwt-user");
      });

      it("rejects a validly-signed token issued for a different issuer", async () => {
        const validator = createLegacyJwtValidator(tokenSecret, "expected-issuer");
        const token = jwt.sign({id: "jwt-user"}, tokenSecret, {issuer: "some-other-issuer"});
        await expect(validator(makeAuthSocket(`Bearer ${token}`))).rejects.toThrow(
          "Token is missing or invalid Bearer"
        );
      });

      it("rejects a token with no iss claim when an issuer is required", async () => {
        const validator = createLegacyJwtValidator(tokenSecret, "expected-issuer");
        const token = jwt.sign({id: "jwt-user"}, tokenSecret);
        await expect(validator(makeAuthSocket(`Bearer ${token}`))).rejects.toThrow(
          "Token is missing or invalid Bearer"
        );
      });

      it("does not check issuer when none is configured (pre-D1 behavior preserved)", async () => {
        const validator = createLegacyJwtValidator(tokenSecret);
        const token = jwt.sign({id: "jwt-user"}, tokenSecret, {issuer: "whatever"});
        const socket = makeAuthSocket(`Bearer ${token}`);
        await validator(socket);
        expect(socket.decodedToken?.id).toBe("jwt-user");
      });

      it("resolves a thunk issuer fresh on every handshake (no staleness from a captured value)", async () => {
        let currentIssuer = "issuer-v1";
        const validator = createLegacyJwtValidator(tokenSecret, () => currentIssuer);

        const tokenV1 = jwt.sign({id: "user-1"}, tokenSecret, {issuer: "issuer-v1"});
        await validator(makeAuthSocket(`Bearer ${tokenV1}`));

        // Simulate the issuer changing after the validator was constructed (the real
        // bug this guards: RealtimeApp used to capture process.env.TOKEN_ISSUER once
        // at onServerCreated() time instead of reading it fresh per handshake).
        currentIssuer = "issuer-v2";
        const tokenV1Again = jwt.sign({id: "user-1"}, tokenSecret, {issuer: "issuer-v1"});
        await expect(validator(makeAuthSocket(`Bearer ${tokenV1Again}`))).rejects.toThrow(
          "Token is missing or invalid Bearer"
        );

        const tokenV2 = jwt.sign({id: "user-2"}, tokenSecret, {issuer: "issuer-v2"});
        const socket = makeAuthSocket(`Bearer ${tokenV2}`);
        await validator(socket);
        expect(socket.decodedToken?.id).toBe("user-2");
      });
    });
  });

  describe("createLegacyJwtValidator with a user model", () => {
    const SocketAuthUser = getSocketAuthUserModel();
    const userModel = SocketAuthUser as unknown as UserModel;

    beforeEach(async () => {
      await SocketAuthUser.deleteMany({});
    });

    it("accepts an enabled user's JWT", async () => {
      const user = await SocketAuthUser.create({email: "enabled-jwt@example.com"});
      const validator = createLegacyJwtValidator(tokenSecret, undefined, userModel);
      const token = jwt.sign({id: String(user._id)}, tokenSecret);
      const socket = makeAuthSocket(`Bearer ${token}`);

      await validator(socket);

      expect(socket.decodedToken?.id).toBe(String(user._id));
      expect(socket.decodedToken?.authKind).toBe("jwt");
    });

    it("rejects a disabled user's JWT", async () => {
      const user = await SocketAuthUser.create({disabled: true, email: "disabled-jwt@example.com"});
      const validator = createLegacyJwtValidator(tokenSecret, undefined, userModel);
      const token = jwt.sign({id: String(user._id)}, tokenSecret);
      const socket = makeAuthSocket(`Bearer ${token}`);

      await expect(validator(socket)).rejects.toThrow("disabled");
      expect(socket.decodedToken).toBeUndefined();
    });

    it("rejects a JWT whose user no longer exists", async () => {
      const validator = createLegacyJwtValidator(tokenSecret, undefined, userModel);
      const token = jwt.sign({id: String(new mongoose.Types.ObjectId())}, tokenSecret);
      const socket = makeAuthSocket(`Bearer ${token}`);

      await expect(validator(socket)).rejects.toThrow("Unauthorized");
      expect(socket.decodedToken).toBeUndefined();
    });

    it("refuses a disabled user through the middleware chain on every handshake", async () => {
      const user = await SocketAuthUser.create({email: "reconnect-jwt@example.com"});
      const middleware = createSocketAuthMiddleware({tokenSecret, userModel});
      const token = jwt.sign({id: String(user._id)}, tokenSecret);

      expect(await runMiddleware(middleware, makeAuthSocket(`Bearer ${token}`))).toBeUndefined();

      await SocketAuthUser.updateOne({_id: user._id}, {disabled: true});
      const first = await runMiddleware(middleware, makeAuthSocket(`Bearer ${token}`));
      const second = await runMiddleware(middleware, makeAuthSocket(`Bearer ${token}`));
      expect(first?.message).toContain("disabled");
      expect(second?.message).toContain("disabled");
    });
  });

  describe("createBetterAuthValidator", () => {
    const stubAuth = (
      session: unknown,
      capture?: {headers?: Record<string, string>}
    ): StubbedAuth =>
      ({
        api: {
          getSession: async ({headers}: {headers: Record<string, string>}) => {
            if (capture) {
              capture.headers = headers;
            }
            return session;
          },
        },
      }) as unknown as StubbedAuth;

    it("populates decodedToken from a valid Better Auth session", async () => {
      const validator = createBetterAuthValidator({
        auth: stubAuth({session: {id: "sess-1"}, user: {id: "ba-user-1"}}),
      });
      const socket = makeAuthSocket("session-token-abc");
      await validator(socket);
      expect(socket.decodedToken).toEqual({
        admin: false,
        authKind: "better-auth",
        id: "ba-user-1",
        isAnonymous: false,
      });
    });

    it("retains the raw session token on socket.encodedToken (for D1's sweep re-check)", async () => {
      const validator = createBetterAuthValidator({
        auth: stubAuth({session: {id: "sess-1"}, user: {id: "ba-user-1"}}),
      });
      const socket = makeAuthSocket("Bearer session-token-abc");
      await validator(socket);
      expect(socket.encodedToken).toBe("session-token-abc");
    });

    it("passes the token as a bearer authorization header only", async () => {
      const capture: {headers?: Record<string, string>} = {};
      const validator = createBetterAuthValidator({
        auth: stubAuth({session: {id: "s"}, user: {id: "u"}}, capture),
      });
      await validator(makeAuthSocket("Bearer session-token-xyz"));
      expect(capture.headers?.authorization).toBe("Bearer session-token-xyz");
      // A raw (unsigned) token cookie fails signature verification and can shadow the
      // bearer path, so the validator must not send one.
      expect(capture.headers?.cookie).toBeUndefined();
    });

    it("rejects when the session lookup returns null", async () => {
      const validator = createBetterAuthValidator({auth: stubAuth(null)});
      await expect(validator(makeAuthSocket("bad-session"))).rejects.toThrow(
        "Better Auth session is missing or invalid"
      );
    });

    it("rejects when no token is provided", async () => {
      const validator = createBetterAuthValidator({auth: stubAuth(null)});
      await expect(validator(makeAuthSocket(undefined))).rejects.toThrow("no token provided");
    });

    it("resolves the app user for id and admin when a userModel is provided", async () => {
      const userModel = {
        find: () => {
          throw new Error("unused");
        },
      };
      const appUser = {_id: "app-user-1", admin: true};
      const findOneOrNone = async (query: Record<string, unknown>) =>
        query.betterAuthId === "ba-user-1" ? appUser : null;
      const validator = createBetterAuthValidator({
        auth: stubAuth({session: {id: "s"}, user: {id: "ba-user-1"}}),
        userModel: {...userModel, findOneOrNone} as unknown as UserModel,
      });
      const socket = makeAuthSocket("session-token");
      await validator(socket);
      expect(socket.decodedToken).toEqual({
        admin: true,
        authKind: "better-auth",
        id: "app-user-1",
        isAnonymous: false,
      });
    });

    describe("with a real user model", () => {
      const SocketAuthUser = getSocketAuthUserModel();
      const userModel = SocketAuthUser as unknown as UserModel;

      beforeEach(async () => {
        await SocketAuthUser.deleteMany({});
      });

      it("creates the app user when a freshly signed-up user connects first", async () => {
        const validator = createBetterAuthValidator({
          auth: stubAuth({
            session: {id: "s"},
            user: {email: "fresh@example.com", id: "ba-fresh", name: "Fresh User"},
          }),
          userModel,
        });
        const socket = makeAuthSocket("session-token");

        await validator(socket);

        const created = await SocketAuthUser.find({betterAuthId: "ba-fresh"});
        expect(created).toHaveLength(1);
        expect(created[0].email).toBe("fresh@example.com");
        expect(socket.decodedToken?.id).toBe(String(created[0]._id));
      });

      it("rejects with an Unauthorized error, not the database error, when the lookup fails", async () => {
        const validator = createBetterAuthValidator({
          auth: stubAuth({session: {id: "s"}, user: {email: "x@example.com", id: "ba-x"}}),
          userModel: {
            findOneOrNone: async () => {
              throw new Error("E11000 duplicate key error collection: users");
            },
          } as unknown as UserModel,
        });

        const error = await validator(makeAuthSocket("session-token")).catch((e: Error) => e);

        expect(error?.message).toContain("could not resolve the application user");
        expect(error?.message).not.toContain("E11000");
      });

      it("rejects a disabled user's session", async () => {
        await SocketAuthUser.create({
          betterAuthId: "ba-disabled",
          disabled: true,
          email: "disabled@example.com",
        });
        const validator = createBetterAuthValidator({
          auth: stubAuth({
            session: {id: "s"},
            user: {email: "disabled@example.com", id: "ba-disabled", name: "Disabled"},
          }),
          userModel,
        });
        const socket = makeAuthSocket("session-token");

        await expect(validator(socket)).rejects.toThrow("disabled");
        expect(socket.decodedToken).toBeUndefined();
      });
    });
  });

  describe("createSocketAuthMiddleware — validator chain", () => {
    it("authenticates with Better Auth when no JWT secret is configured", async () => {
      const middleware = createSocketAuthMiddleware({
        betterAuth: {
          auth: {
            api: {getSession: async () => ({session: {id: "s"}, user: {id: "ba-only"}})},
          } as unknown as BetterAuthSocketOptions["auth"],
        },
      });
      const socket = makeAuthSocket("better-auth-session-token");

      const error = await runMiddleware(middleware, socket);

      assert.isUndefined(error);
      assert.deepEqual(socket.decodedToken, {
        admin: false,
        authKind: "better-auth",
        id: "ba-only",
        isAnonymous: false,
      });
    });

    it("rejects configuration with no authentication validators", () => {
      assert.throws(
        () => createSocketAuthMiddleware({}),
        "At least one socket authentication validator is required"
      );
    });

    it("accepts a legacy JWT with the default chain", async () => {
      const middleware = createSocketAuthMiddleware({tokenSecret});
      const token = jwt.sign({admin: false, id: "chain-user"}, tokenSecret);
      const socket = makeAuthSocket(`Bearer ${token}`);
      const error = await runMiddleware(middleware, socket);
      expect(error).toBeUndefined();
      expect(socket.decodedToken?.id).toBe("chain-user");
    });

    it("rejects an invalid token with the default chain", async () => {
      const middleware = createSocketAuthMiddleware({tokenSecret});
      const socket = makeAuthSocket("Bearer not-a-jwt");
      const error = await runMiddleware(middleware, socket);
      expect(error).toBeDefined();
      expect(error?.message).toContain("invalid");
      expect(socket.decodedToken).toBeUndefined();
    });

    it("falls through to the Better Auth validator when the JWT validator fails", async () => {
      const middleware = createSocketAuthMiddleware({
        betterAuth: {
          auth: {
            api: {getSession: async () => ({session: {id: "s"}, user: {id: "ba-user-2"}})},
          } as unknown as StubbedAuth,
        },
        tokenSecret,
      });
      const socket = makeAuthSocket("better-auth-session-token");
      const error = await runMiddleware(middleware, socket);
      expect(error).toBeUndefined();
      expect(socket.decodedToken).toEqual({
        admin: false,
        authKind: "better-auth",
        id: "ba-user-2",
        isAnonymous: false,
      });
    });

    it("accepts Better Auth sessions without a legacy JWT secret", async () => {
      const middleware = createSocketAuthMiddleware({
        betterAuth: {
          auth: {
            api: {getSession: async () => ({session: {id: "s"}, user: {id: "ba-only-user"}})},
          } as unknown as StubbedAuth,
        },
      });
      const socket = makeAuthSocket("better-auth-session-token");
      const error = await runMiddleware(middleware, socket);

      assert.isUndefined(error);
      assert.strictEqual(socket.decodedToken?.id, "ba-only-user");
      assert.strictEqual(socket.decodedToken?.authKind, "better-auth");
    });

    it("falls through to Better Auth when the JWT is expired", async () => {
      const middleware = createSocketAuthMiddleware({
        betterAuth: {
          auth: {
            api: {getSession: async () => ({session: {id: "s"}, user: {id: "ba-fallback"}})},
          } as unknown as StubbedAuth,
        },
        tokenSecret,
      });
      const expiredToken = jwt.sign({id: "expired-jwt-user"}, tokenSecret, {expiresIn: -10});
      const socket = makeAuthSocket(`Bearer ${expiredToken}`);
      const error = await runMiddleware(middleware, socket);
      expect(error).toBeUndefined();
      expect(socket.decodedToken?.id).toBe("ba-fallback");
    });

    it("prefers the legacy JWT validator when both would work", async () => {
      const middleware = createSocketAuthMiddleware({
        betterAuth: {
          auth: {
            api: {
              getSession: async () => {
                throw new Error("should not be called for a valid JWT");
              },
            },
          } as unknown as StubbedAuth,
        },
        tokenSecret,
      });
      const token = jwt.sign({admin: true, id: "jwt-first"}, tokenSecret);
      const socket = makeAuthSocket(`Bearer ${token}`);
      const error = await runMiddleware(middleware, socket);
      expect(error).toBeUndefined();
      expect(socket.decodedToken?.id).toBe("jwt-first");
      expect(socket.decodedToken?.admin).toBe(true);
    });

    it("rejects with the last validator's error when every validator fails", async () => {
      const middleware = createSocketAuthMiddleware({
        betterAuth: {auth: {api: {getSession: async () => null}} as unknown as StubbedAuth},
        tokenSecret,
      });
      const socket = makeAuthSocket("neither-jwt-nor-session");
      const error = await runMiddleware(middleware, socket);
      expect(error?.message).toContain("Better Auth session is missing or invalid");
    });

    it("passes the configured issuer through to the JWT validator", async () => {
      const middleware = createSocketAuthMiddleware({issuer: "chain-issuer", tokenSecret});
      const wrongIssuerToken = jwt.sign({id: "u"}, tokenSecret, {issuer: "not-chain-issuer"});
      const socket = makeAuthSocket(`Bearer ${wrongIssuerToken}`);
      const error = await runMiddleware(middleware, socket);
      expect(error).toBeDefined();
      expect(error?.message).toContain("invalid");
      // The wrapped socketio-jwt middleware sets decodedToken from the raw JWT payload
      // before the post-verify onAuthentication issuer check runs, so the property is
      // present (but never stamped with authKind, since that only happens on success)
      // — the connection is still rejected via the returned error either way.
      expect(socket.decodedToken?.authKind).toBeUndefined();
    });

    it("supports extra validators appended to the chain", async () => {
      const middleware = createSocketAuthMiddleware({
        extraValidators: [
          async (socket) => {
            if (socket.handshake.auth.token !== "magic") {
              throw new Error("not magic");
            }
            socket.decodedToken = {admin: false, id: "magic-user", isAnonymous: false};
          },
        ],
        tokenSecret,
      });
      const socket = makeAuthSocket("magic");
      const error = await runMiddleware(middleware, socket);
      expect(error).toBeUndefined();
      expect(socket.decodedToken?.id).toBe("magic-user");
    });
  });
});
