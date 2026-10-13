import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

describe("AI test preload", () => {
  it("provides a connected MongoDB replica set without requiring a local service", async () => {
    expect(mongoose.connection.readyState).toBe(1);
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("mongoose.connection.db is undefined");
    }
    const hello = await db.command({hello: 1});
    expect(typeof hello.setName).toBe("string");
  });
});
