import {afterEach, describe, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import {withLocalMongoDb} from "./localMongo.js";

describe("withLocalMongoDb", () => {
  const originalCreateConnection = mongoose.createConnection;

  afterEach((): void => {
    mongoose.createConnection = originalCreateConnection;
  });

  it("reports a connection that never exposes a db handle", async (): Promise<void> => {
    mongoose.createConnection = (() => ({
      asPromise: async (): Promise<void> => undefined,
      db: undefined,
      destroy: async (): Promise<void> => undefined,
    })) as unknown as typeof mongoose.createConnection;

    const text = await withLocalMongoDb("mongodb://127.0.0.1:1/unused", async () => "ran");

    assert.equal(text, "Connected to Mongo but `connection.db` is not available.");
  });

  it("returns the tool result when closing the connection throws", async (): Promise<void> => {
    mongoose.createConnection = (() => ({
      asPromise: async (): Promise<void> => undefined,
      db: {databaseName: "unused"},
      destroy: async (): Promise<void> => {
        throw new Error("destroy failed");
      },
    })) as unknown as typeof mongoose.createConnection;

    const text = await withLocalMongoDb("mongodb://127.0.0.1:1/unused", async () => "ok");

    assert.equal(text, "ok");
  });
});
