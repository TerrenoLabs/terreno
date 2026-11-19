/**
 * Isolated because `useMongoTopology` swaps the default mongoose connection to an in-memory
 * replica set for this process.
 */
import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {useMongoTopology} from "../tests/mongoTopology";

useMongoTopology({topology: "replicaSet"});

describe("useMongoTopology replicaSet", () => {
  it("connects to a replica set that supports transactions", async () => {
    const hello = await mongoose.connection.db?.admin().command({hello: 1});
    expect(hello?.setName).toBeTruthy();

    const collection = mongoose.connection.collection("topologycanaries");
    const session = await mongoose.connection.startSession();
    try {
      session.startTransaction();
      await collection.insertOne({name: "aborted"}, {session});
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }

    expect(await collection.countDocuments({name: "aborted"})).toBe(0);
  });
});
