import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {ensureTestMongooseConnected} from "./connection";
import {initializeModels, resolveMongoLaunchTimeoutMs, waitForDatabaseReady} from "./mongoServer";

describe("mongoServer", () => {
  it("pings the connected database", async () => {
    await waitForDatabaseReady(3, 10);
  });

  it("throws when mongoose has no database handle", async () => {
    const original = Object.getOwnPropertyDescriptor(mongoose.connection, "db");
    Object.defineProperty(mongoose.connection, "db", {
      configurable: true,
      get: () => undefined,
    });
    try {
      await expect(waitForDatabaseReady(1, 1)).rejects.toThrow(/undefined/);
    } finally {
      if (original) {
        Object.defineProperty(mongoose.connection, "db", original);
      }
    }
  });

  it("initializes models and reports zero work when none are new", async () => {
    const first = await initializeModels();
    const second = await initializeModels();
    expect(second.modelCount).toBe(first.modelCount);
    expect(second.modelInitMs).toBe(0);
  });
});

describe("resolveMongoLaunchTimeoutMs", () => {
  it("defaults to 60 seconds", () => {
    Reflect.deleteProperty(process.env, "TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS");
    expect(resolveMongoLaunchTimeoutMs()).toBe(60000);
  });

  it("reads a positive integer override", () => {
    process.env.TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS = "90000";
    try {
      expect(resolveMongoLaunchTimeoutMs()).toBe(90000);
    } finally {
      Reflect.deleteProperty(process.env, "TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS");
    }
  });

  it.each(["0", "-5", "1.5", "999", "soon"])("ignores the invalid override %p", (value) => {
    process.env.TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS = value;
    try {
      expect(resolveMongoLaunchTimeoutMs()).toBe(60000);
    } finally {
      Reflect.deleteProperty(process.env, "TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS");
    }
  });
});

describe("ensureTestMongooseConnected", () => {
  it("returns immediately when mongoose is already connected", async () => {
    expect(mongoose.connection.readyState).toBe(1);
    await ensureTestMongooseConnected();
    expect(mongoose.connection.readyState).toBe(1);
  });
});

describe("startMongoServer", () => {
  it("retries ping on retryable mongo codes", async () => {
    let calls = 0;
    const original = mongoose.connection.db;
    Object.defineProperty(mongoose.connection, "db", {
      configurable: true,
      get: () => ({
        admin: () => ({
          command: async () => {
            calls += 1;
            if (calls === 1) {
              const error = new Error("not ready") as Error & {code: number};
              error.code = 11600;
              throw error;
            }
            return {ok: 1};
          },
        }),
      }),
    });
    try {
      const {waitForDatabaseReady} = await import("./mongoServer");
      await waitForDatabaseReady(3, 1);
      expect(calls).toBe(2);
    } finally {
      Object.defineProperty(mongoose.connection, "db", {
        configurable: true,
        get: () => original,
      });
    }
  });
});
