import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {getTestSession, resetTestSessionAfterReconnect} from "../transaction/testTransaction";
import {registerBackendPreload, registerSimpleMongoPreload} from "./registerBackendPreload";

// These suites register scoped hooks inside a describe block. They run against the
// shared preload connection, so they must not stop Mongo or close the connection.

describe("registerBackendPreload", () => {
  it("exports preload helpers", () => {
    expect(typeof registerSimpleMongoPreload).toBe("function");
    expect(typeof registerBackendPreload).toBe("function");
  });
});

describe("registerBackendPreload with transactions and no db", () => {
  const calls: string[] = [];

  registerBackendPreload({
    disableDb: true,
    onAfterEach: () => {
      calls.push("afterEach");
    },
    onBeforeEach: () => {
      calls.push("beforeEach");
    },
    sentryMock: false,
    silenceLogs: false,
    useTransactions: true,
  });

  // Drop the session the scoped hooks leave behind so later files start without one.
  afterAll(async () => {
    await resetTestSessionAfterReconnect();
  });

  it("starts a test transaction before each test", () => {
    expect(getTestSession()?.inTransaction()).toBe(true);
    expect(calls).toContain("beforeEach");
  });

  it("runs the after-each hook between tests", () => {
    expect(calls).toContain("afterEach");
  });
});

describe("registerBackendPreload when the caller manages mongoose", () => {
  const calls: string[] = [];

  registerBackendPreload({
    connectMongoInBeforeAll: false,
    onAfterAll: () => {
      calls.push("afterAll");
    },
    onBeforeAll: () => {
      calls.push("beforeAll");
    },
    silenceLogs: {},
  });

  it("runs the caller's before-all hook without starting Mongo", () => {
    expect(calls).toEqual(["beforeAll"]);
    expect(mongoose.connection.readyState).toBe(1);
  });
});

describe("registerSimpleMongoPreload", () => {
  const calls: string[] = [];
  const originalClose = mongoose.connection.close;
  const originalUri = process.env.TERRENO_TEST_MONGODB_URI;
  const originalUseMemory = process.env.TERRENO_TEST_USE_MEMORY_MONGO;

  // Keep the shared connection open and force the memory-server branch.
  beforeAll(() => {
    mongoose.connection.close = (async () => {
      calls.push("close");
    }) as typeof mongoose.connection.close;
    delete process.env.TERRENO_TEST_MONGODB_URI;
    process.env.TERRENO_TEST_USE_MEMORY_MONGO = "true";
  });

  registerSimpleMongoPreload({
    onAfterAll: () => {
      mongoose.connection.close = originalClose;
      if (originalUri === undefined) {
        delete process.env.TERRENO_TEST_MONGODB_URI;
      } else {
        process.env.TERRENO_TEST_MONGODB_URI = originalUri;
      }
      if (originalUseMemory === undefined) {
        delete process.env.TERRENO_TEST_USE_MEMORY_MONGO;
      } else {
        process.env.TERRENO_TEST_USE_MEMORY_MONGO = originalUseMemory;
      }
    },
    onBeforeAll: () => {
      calls.push("beforeAll");
    },
    sentryMock: false,
    silenceLogs: false,
  });

  it("starts a memory server and keeps the existing connection", () => {
    expect(calls).toEqual(["beforeAll"]);
    expect(mongoose.connection.readyState).toBe(1);
  });
});
