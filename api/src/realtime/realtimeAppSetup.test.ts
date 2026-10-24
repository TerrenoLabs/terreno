/**
 * Tests for RealtimeApp.onServerCreated — the Socket.io server wiring that a
 * live server would exercise. Socket.IO Server and the change-stream watcher are
 * injected via RealtimeAppOptions so we never `mock.module` (bun's module mocks
 * are process-wide and would break later files that need the real implementations).
 */
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import http from "node:http";
import {assert} from "chai";
import express from "express";
import {DateTime} from "luxon";
import mongoose, {Schema} from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";

import type {UserModel} from "../auth";
import {BetterAuthApp} from "../betterAuthApp";
import {TerrenoApp} from "../terrenoApp";
import {RealtimeApp} from "./realtimeApp";

type Handler = (...args: unknown[]) => void;

interface FakeIo {
  handlers: Map<string, Handler>;
  middleware: unknown[];
  closed: boolean;
  sockets: {sockets: Map<string, unknown>};
}

let ios: FakeIo[] = [];
let watcherStarts = 0;

class FakeServer {
  handlers = new Map<string, Handler>();
  middleware: unknown[] = [];
  closed = false;
  engine = {clientsCount: 0};
  sockets = {sockets: new Map<string, unknown>()};

  constructor(..._args: unknown[]) {
    ios.push(this as unknown as FakeIo);
  }

  use(mw: unknown): void {
    this.middleware.push(mw);
  }

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  close(cb?: () => void): void {
    this.closed = true;
    cb?.();
  }
}

const lastIo = (): FakeIo => {
  const io = ios[ios.length - 1];
  if (!io) {
    throw new Error("No Socket.io server was created");
  }
  return io;
};

const getHandler = (event: string): Handler => {
  const handler = lastIo().handlers.get(event);
  if (!handler) {
    throw new Error(`No handler registered for ${event}`);
  }
  return handler;
};

const fakeServer = {} as http.Server;

const createConnectionSocket = (throwOnOn = false): Record<string, unknown> => {
  const listeners = new Map<string, Handler>();
  return {
    decodedToken: {admin: false, id: "user-42"},
    emit: (): void => {},
    id: "socket-1",
    join: async (): Promise<void> => {},
    leave: async (): Promise<void> => {},
    on: (event: string, handler: Handler): void => {
      if (throwOnOn) {
        throw new Error("boom");
      }
      listeners.set(event, handler);
    },
  };
};

/** Shared RealtimeAppOptions that inject FakeServer + a start-watcher counter. */
const testRealtimeOptions = (
  overrides: ConstructorParameters<typeof RealtimeApp>[0] = {}
): ConstructorParameters<typeof RealtimeApp>[0] => ({
  SocketServer: FakeServer as unknown as NonNullable<
    ConstructorParameters<typeof RealtimeApp>[0]
  >["SocketServer"],
  startChangeStreamWatcher: () => {
    watcherStarts += 1;
  },
  ...overrides,
});

describe("RealtimeApp.onServerCreated", () => {
  beforeEach(() => {
    ios = [];
    watcherStarts = 0;
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, "TOKEN_SECRET");
  });

  it("wires up auth middleware, connection handlers, and the change-stream watcher", () => {
    const app = new RealtimeApp(testRealtimeOptions({debug: true, tokenSecret: "test-secret"}));
    app.onServerCreated(fakeServer);

    const io = lastIo();
    expect(io.middleware.length).toBe(1);
    expect(io.handlers.has("connection")).toBe(true);
    expect(io.handlers.has("connect_error")).toBe(true);
    expect(watcherStarts).toBe(1);
    expect(app.getIo()).not.toBeNull();
  });

  it("installs socket handlers for each new connection", () => {
    const app = new RealtimeApp(testRealtimeOptions({tokenSecret: "test-secret"}));
    app.onServerCreated(fakeServer);

    const connectionHandler = getHandler("connection");
    const socket = createConnectionSocket();
    // Should run installRealtimeSocketHandlers without throwing.
    expect(() => connectionHandler(socket)).not.toThrow();
  });

  it("captures errors thrown while handling a connection", () => {
    const app = new RealtimeApp(testRealtimeOptions({tokenSecret: "test-secret"}));
    app.onServerCreated(fakeServer);

    const connectionHandler = getHandler("connection");
    const brokenSocket = createConnectionSocket(true);
    // The handler swallows the error rather than crashing the server.
    expect(() => connectionHandler(brokenSocket)).not.toThrow();
  });

  it("logs connect_error events without throwing", () => {
    const app = new RealtimeApp(testRealtimeOptions({tokenSecret: "test-secret"}));
    app.onServerCreated(fakeServer);

    const errorHandler = getHandler("connect_error");
    expect(() => errorHandler(new Error("handshake failed"))).not.toThrow();
  });

  it("reads the token secret from the environment when not provided in config", () => {
    process.env.TOKEN_SECRET = "env-secret";
    const app = new RealtimeApp(testRealtimeOptions());
    app.onServerCreated(fakeServer);

    expect(lastIo().handlers.has("connection")).toBe(true);
  });

  it("starts with Better Auth when no token secret is available", () => {
    Reflect.deleteProperty(process.env, "TOKEN_SECRET");
    const app = new RealtimeApp(
      testRealtimeOptions({
        betterAuth: {
          auth: {
            api: {
              getSession: async () => ({
                session: {id: "session-1"},
                user: {id: "better-auth-user"},
              }),
            },
          },
        } as unknown as NonNullable<
          NonNullable<ConstructorParameters<typeof RealtimeApp>[0]>["betterAuth"]
        >,
      })
    );

    assert.doesNotThrow(() => app.onServerCreated(fakeServer));
    assert.lengthOf(lastIo().middleware, 1);
    assert.isTrue(lastIo().handlers.has("connection"));
  });

  it("throws when no socket authentication method is available", () => {
    Reflect.deleteProperty(process.env, "TOKEN_SECRET");
    const app = new RealtimeApp(testRealtimeOptions());
    assert.throws(
      () => app.onServerCreated(fakeServer),
      "Socket authentication requires TOKEN_SECRET or Better Auth"
    );
  });
});

interface WiringUserFields {
  _id: mongoose.Types.ObjectId;
  admin?: boolean;
  betterAuthId?: string;
  disabled?: boolean;
  email?: string;
  name?: string;
}

const wiringUserSchema = new Schema({
  admin: {default: false, description: "Whether the user is an admin", type: Boolean},
  betterAuthId: {description: "Better Auth user id", type: String},
  disabled: {default: false, description: "Whether the account is disabled", type: Boolean},
  email: {description: "User email", type: String},
  name: {description: "Display name", type: String},
});

const getWiringUserModel = (): mongoose.Model<WiringUserFields> => {
  try {
    return mongoose.model<WiringUserFields>("RealtimeWiringUser");
  } catch {
    return mongoose.model<WiringUserFields>("RealtimeWiringUser", wiringUserSchema);
  }
};

type SocketMiddleware = (socket: unknown, next: (error?: Error) => void) => void;

describe("RealtimeApp with a registered BetterAuthApp", () => {
  const WiringUser = getWiringUserModel();
  const userModel = WiringUser as unknown as UserModel;
  let realtime: RealtimeApp | undefined;

  // A TerrenoApp stand-in that only exposes its registered plugins, as RealtimeApp reads them.
  const registerWithBetterAuthApp = (
    app: RealtimeApp,
    terrenoUserModel?: UserModel
  ): BetterAuthApp => {
    const betterAuthApp = new BetterAuthApp({
      config: {
        baseURL: "http://localhost:3000",
        enabled: true,
        secret: "test-secret-at-least-32-characters-long",
      },
      userModel,
    });
    const terrenoApp = {
      getPlugins: () => [betterAuthApp, app],
      getUserModel: () => terrenoUserModel,
    } as unknown as TerrenoApp;
    app.register(express(), undefined, terrenoApp);
    return betterAuthApp;
  };

  const signUp = async (betterAuthApp: BetterAuthApp, email: string): Promise<string> => {
    const created = await betterAuthApp.ensureAuth().api.signUpEmail({
      body: {email, name: "Socket User", password: "password-123456"},
    });
    return created.token as string;
  };

  const handshake = (token: string): Promise<{error?: Error; socket: Record<string, unknown>}> => {
    const socket: Record<string, unknown> = {handshake: {auth: {token: `Bearer ${token}`}}};
    const middleware = lastIo().middleware[0] as SocketMiddleware;
    return new Promise((resolve) => {
      middleware(socket, (error?: Error) => resolve({error, socket}));
    });
  };

  beforeEach(async () => {
    ios = [];
    await WiringUser.deleteMany({});
  });

  afterEach(async () => {
    await realtime?.close();
    realtime = undefined;
    Reflect.deleteProperty(process.env, "TOKEN_SECRET");
  });

  it("authenticates a Better Auth bearer at handshake without a betterAuth option", async () => {
    process.env.TOKEN_SECRET = "test-secret";
    realtime = new RealtimeApp(testRealtimeOptions({sessionRevalidationIntervalMs: 0, userModel}));
    const betterAuthApp = registerWithBetterAuthApp(realtime);
    realtime.onServerCreated(fakeServer);
    const token = await signUp(betterAuthApp, `wired-${DateTime.now().toMillis()}@example.com`);

    const {error, socket} = await handshake(token);

    expect(error).toBeUndefined();
    expect((socket.decodedToken as {authKind?: string}).authKind).toBe("better-auth");
    expect(await WiringUser.countDocuments()).toBe(1);
  });

  it("uses the TerrenoApp's user model when the RealtimeApp has none", async () => {
    process.env.TOKEN_SECRET = "test-secret";
    realtime = new RealtimeApp(testRealtimeOptions({sessionRevalidationIntervalMs: 0}));
    const betterAuthApp = registerWithBetterAuthApp(realtime, userModel);
    realtime.onServerCreated(fakeServer);
    const freshToken = await signUp(
      betterAuthApp,
      `fallback-${DateTime.now().toMillis()}@example.com`
    );

    const fresh = await handshake(freshToken);
    const [created] = await WiringUser.find({});

    expect(fresh.error).toBeUndefined();
    expect((fresh.socket.decodedToken as {id?: string}).id).toBe(String(created?._id));

    await WiringUser.updateMany({}, {disabled: true});
    const refused = await handshake(freshToken);
    expect(refused.error?.message).toContain("disabled");
  });

  it("fills in the RealtimeApp's user model for an explicit betterAuth option without one", async () => {
    process.env.TOKEN_SECRET = "test-secret";
    const betterAuthApp = new BetterAuthApp({
      config: {
        baseURL: "http://localhost:3000",
        enabled: true,
        secret: "test-secret-at-least-32-characters-long",
      },
    });
    realtime = new RealtimeApp(
      testRealtimeOptions({
        betterAuth: {auth: betterAuthApp.ensureAuth()},
        sessionRevalidationIntervalMs: 0,
        userModel,
      })
    );
    realtime.onServerCreated(fakeServer);
    const token = await signUp(betterAuthApp, `explicit-${DateTime.now().toMillis()}@example.com`);

    const {error, socket} = await handshake(token);
    const [created] = await WiringUser.find({});

    expect(error).toBeUndefined();
    expect((socket.decodedToken as {id?: string}).id).toBe(String(created?._id));
  });

  it("refuses a disabled user's legacy JWT at handshake", async () => {
    const jwtLib = (await import("jsonwebtoken")).default;
    realtime = new RealtimeApp(
      testRealtimeOptions({
        sessionRevalidationIntervalMs: 0,
        tokenIssuer: "wiring-issuer",
        tokenSecret: "test-secret",
        userModel,
      })
    );
    realtime.onServerCreated(fakeServer);
    const user = await WiringUser.create({email: "jwt-disabled@example.com"});
    const token = jwtLib.sign({id: String(user._id)}, "test-secret", {issuer: "wiring-issuer"});

    const accepted = await handshake(token);
    expect(accepted.error).toBeUndefined();

    await WiringUser.updateOne({_id: user._id}, {disabled: true});
    const refused = await handshake(token);
    expect(refused.error?.message).toContain("disabled");
  });

  it("starts without TOKEN_SECRET when a BetterAuthApp is registered", () => {
    Reflect.deleteProperty(process.env, "TOKEN_SECRET");
    realtime = new RealtimeApp(testRealtimeOptions({sessionRevalidationIntervalMs: 0, userModel}));
    registerWithBetterAuthApp(realtime);

    assert.doesNotThrow(() => realtime?.onServerCreated(fakeServer));
  });

  it("disconnects a disabled user's socket on the revalidation sweep", async () => {
    process.env.TOKEN_SECRET = "test-secret";
    realtime = new RealtimeApp(testRealtimeOptions({sessionRevalidationIntervalMs: 10, userModel}));
    const betterAuthApp = registerWithBetterAuthApp(realtime);
    realtime.onServerCreated(fakeServer);
    const token = await signUp(betterAuthApp, `swept-${DateTime.now().toMillis()}@example.com`);
    const {socket} = await handshake(token);

    const expired = new Promise<unknown>((resolve) => {
      Object.assign(socket, {
        data: {},
        disconnect: (): void => {},
        emit: (event: string, payload: unknown): void => {
          if (event === "sync:auth-expired") {
            resolve(payload);
          }
        },
        id: "socket-swept",
      });
    });
    await WiringUser.updateMany({}, {disabled: true});
    lastIo().sockets.sockets.set("socket-swept", socket);

    expect(await expired).toEqual({reason: "disabled"});
  });
});

describe("RealtimeApp on a real TerrenoApp with BetterAuthApp", () => {
  // TerrenoApp's JWT setup needs passport-local-mongoose's createStrategy on the user model.
  const getTerrenoWiringUserModel = (): mongoose.Model<WiringUserFields> => {
    try {
      return mongoose.model<WiringUserFields>("RealtimeTerrenoWiringUser");
    } catch {
      const schema = wiringUserSchema.clone();
      schema.plugin(
        passportLocalMongoose as unknown as (
          target: Schema,
          options?: Record<string, unknown>
        ) => void,
        {usernameField: "email"}
      );
      return mongoose.model<WiringUserFields>("RealtimeTerrenoWiringUser", schema);
    }
  };
  const TerrenoWiringUser = getTerrenoWiringUserModel();
  const userModel = TerrenoWiringUser as unknown as UserModel;
  let realtime: RealtimeApp | undefined;

  beforeEach(async () => {
    ios = [];
    await TerrenoWiringUser.deleteMany({});
  });

  afterEach(async () => {
    await realtime?.close();
    realtime = undefined;
  });

  it("authenticates a Better Auth session at handshake with no manual wiring", async () => {
    const betterAuthApp = new BetterAuthApp({
      config: {
        baseURL: "http://localhost:3000",
        enabled: true,
        secret: "test-secret-at-least-32-characters-long",
      },
      userModel,
    });
    realtime = new RealtimeApp(testRealtimeOptions({sessionRevalidationIntervalMs: 0}));
    const terrenoApp = new TerrenoApp({
      httpServer: http.createServer(),
      userModel: userModel as never,
    })
      .register(betterAuthApp)
      .register(realtime);
    terrenoApp.start();
    await terrenoApp.whenReady();

    const created = await betterAuthApp.ensureAuth().api.signUpEmail({
      body: {
        email: `terreno-wired-${DateTime.now().toMillis()}@example.com`,
        name: "Wired User",
        password: "password-123456",
      },
    });
    const socket: Record<string, unknown> = {
      handshake: {auth: {token: `Bearer ${created.token as string}`}},
    };
    const middleware = lastIo().middleware[0] as (
      target: unknown,
      next: (error?: Error) => void
    ) => void;
    const error = await new Promise<Error | undefined>((resolve) => {
      middleware(socket, resolve);
    });
    const [appUser] = await TerrenoWiringUser.find({});

    expect(error).toBeUndefined();
    expect((socket.decodedToken as {authKind?: string; id?: string}).authKind).toBe("better-auth");
    expect((socket.decodedToken as {id?: string}).id).toBe(String(appUser?._id));
  });
});
