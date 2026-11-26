import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";
import http from "node:http";
import jwt from "jsonwebtoken";
import mongoose, {Schema} from "mongoose";

import type {UserModel as LegacyUserModel} from "../auth";
import {BetterAuthApp} from "../betterAuthApp";
import {TerrenoApp} from "../terrenoApp";
import {UserModel as PassportUser, setupDb} from "../tests";
import {API_ORIGIN, PASSWORD, SECRET, uniqueEmail} from "../tests/betterAuthStubs";
import {RealtimeApp} from "./realtimeApp";
import type {RealtimeAppOptions} from "./types";

setDefaultTimeout(120_000);

type Handler = (...args: unknown[]) => void;

interface FakeIo {
  middleware: unknown[];
}

let ios: FakeIo[] = [];

// Socket.IO is injected so no network socket is opened; the handshake runs through the
// auth middleware the app installs, exactly as a connecting client would.
class FakeServer {
  handlers = new Map<string, Handler>();
  middleware: unknown[] = [];
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
    cb?.();
  }
}

const realtimeOptions = (overrides: RealtimeAppOptions = {}): RealtimeAppOptions => ({
  SocketServer: FakeServer as unknown as NonNullable<RealtimeAppOptions["SocketServer"]>,
  sessionRevalidationIntervalMs: 0,
  startChangeStreamWatcher: (): void => {},
  ...overrides,
});

const plainSchema = new Schema({
  admin: {default: false, description: "Whether the user is an admin", type: Boolean},
  betterAuthId: {description: "The linked Better Auth user id", type: String},
  email: {description: "The user's email", required: true, type: String},
  name: {description: "The user's display name", type: String},
  oauthProvider: {description: "The provider the user first signed in with", type: String},
});
const PlainUser = (mongoose.models.SocketLegacyAuthPlainUser ??
  mongoose.model("SocketLegacyAuthPlainUser", plainSchema)) as unknown as LegacyUserModel;

const handshake = async (
  token: string
): Promise<{error?: Error; socket: Record<string, unknown>}> => {
  const io = ios[ios.length - 1];
  if (!io) {
    throw new Error("No Socket.io server was created");
  }
  const middleware = io.middleware[0] as (target: unknown, next: (error?: Error) => void) => void;
  const socket: Record<string, unknown> = {handshake: {auth: {token}}};
  const error = await new Promise<Error | undefined>((resolve) => {
    middleware(socket, resolve);
  });
  return {error, socket};
};

describe("RealtimeApp legacyAuth", () => {
  const originalEnv = process.env;
  let betterAuthApp: BetterAuthApp;
  let terrenoApp: TerrenoApp | undefined;

  beforeAll(async () => {
    await setupDb();
  }, 120_000);

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    ios = [];
    process.env = {
      ...originalEnv,
      REFRESH_TOKEN_SECRET: "test-refresh-secret",
      SESSION_SECRET: "test-session-secret",
      TOKEN_EXPIRES_IN: "1h",
      TOKEN_ISSUER: "test-issuer",
      TOKEN_SECRET: "test-secret",
    };
    betterAuthApp = new BetterAuthApp({
      config: {baseURL: API_ORIGIN, enabled: true, secret: SECRET},
      userModel: PlainUser,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    terrenoApp = undefined;
  });

  const startApp = async (
    legacyAuth: boolean | undefined,
    realtime: RealtimeAppOptions = realtimeOptions()
  ): Promise<void> => {
    const betterAuthOnly = legacyAuth === false;
    const app = new TerrenoApp({
      httpServer: http.createServer(),
      legacyAuth,
      realtime,
      userModel: betterAuthOnly ? PlainUser : (PassportUser as unknown as LegacyUserModel),
    } as never);
    terrenoApp = betterAuthOnly ? app.register(betterAuthApp) : app;
    terrenoApp.start();
    await terrenoApp.whenReady();
  };

  const legacyJwt = async (model: LegacyUserModel = PlainUser): Promise<string> => {
    const user = await model.create({email: uniqueEmail("socket-legacy")} as never);
    return jwt.sign({id: String(user._id)}, "test-secret", {issuer: "test-issuer"});
  };

  const betterAuthToken = async (): Promise<string> => {
    const created = await betterAuthApp.ensureAuth().api.signUpEmail({
      body: {email: uniqueEmail("socket-ba"), name: "Socket User", password: PASSWORD},
    });
    return created.token as string;
  };

  it("rejects a valid legacy JWT at handshake when legacyAuth is false and TOKEN_SECRET is set", async () => {
    await startApp(false);

    const {error, socket} = await handshake(`Bearer ${await legacyJwt()}`);

    expect(error).toBeDefined();
    expect(socket.decodedToken).toBeUndefined();
  });

  it("accepts a Better Auth session at handshake when legacyAuth is false", async () => {
    await startApp(false);

    const {error, socket} = await handshake(`Bearer ${await betterAuthToken()}`);

    expect(error).toBeUndefined();
    expect((socket.decodedToken as {authKind?: string}).authKind).toBe("better-auth");
  });

  it("accepts a legacy JWT at handshake when legacyAuth is true", async () => {
    await startApp(true);

    const {error, socket} = await handshake(
      `Bearer ${await legacyJwt(PassportUser as unknown as LegacyUserModel)}`
    );

    expect(error).toBeUndefined();
    expect((socket.decodedToken as {authKind?: string}).authKind).toBe("jwt");
  });

  it("accepts a legacy JWT at handshake when legacyAuth is omitted", async () => {
    await startApp(undefined);

    const {error} = await handshake(
      `Bearer ${await legacyJwt(PassportUser as unknown as LegacyUserModel)}`
    );

    expect(error).toBeUndefined();
  });

  // onServerCreated is what `start()` runs; calling it directly keeps a rejection from reaching
  // start()'s process.exit handler.
  it("throws at start when legacyAuth is false and RealtimeApp has an explicit tokenSecret", () => {
    const realtime = new RealtimeApp(realtimeOptions({tokenSecret: "x"}));
    new TerrenoApp({legacyAuth: false, skipListen: true, userModel: PlainUser} as never)
      .register(betterAuthApp)
      .register(realtime)
      .build();

    expect(() => realtime.onServerCreated(http.createServer())).toThrow(
      "RealtimeApp tokenSecret requires legacyAuth"
    );
  });

  it("does not throw for an explicit tokenSecret when legacyAuth is true", () => {
    const realtime = new RealtimeApp(realtimeOptions({tokenSecret: "x"}));
    new TerrenoApp({
      legacyAuth: true,
      skipListen: true,
      userModel: PassportUser as unknown as LegacyUserModel,
    } as never)
      .register(realtime)
      .build();

    expect(() => realtime.onServerCreated(http.createServer())).not.toThrow();
  });
});
