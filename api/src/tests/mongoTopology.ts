/**
 * Swaps the default mongoose connection to an in-memory Mongo of a chosen topology for one
 * test file. The api preload connects to whatever `TERRENO_TEST_MONGODB_URI` or the local
 * default points at, which is a standalone server on CI and may be a replica set on a dev
 * machine. Tests that depend on the topology (transactions need a replica set; the
 * "transactions unsupported" path needs a standalone) call this in an `*.isolated.ts` file,
 * which runs in a process of its own, so the swap never leaks into other suites.
 */
import {afterAll, beforeAll} from "bun:test";
import {resolveMongoLaunchTimeoutMs} from "@terreno/test";
import {MongoMemoryReplSet, MongoMemoryServer} from "mongodb-memory-server";
import mongoose from "mongoose";

export type MongoTopology = "replicaSet" | "standalone";

interface MemoryMongo {
  getUri: () => string;
  stop: () => Promise<boolean>;
}

const startMemoryMongo = async (topology: MongoTopology): Promise<MemoryMongo> => {
  const launchTimeout = resolveMongoLaunchTimeoutMs();
  if (topology === "standalone") {
    return MongoMemoryServer.create({instance: {launchTimeout}});
  }
  return MongoMemoryReplSet.create({
    instanceOpts: [{launchTimeout}],
    replSet: {count: 1, storageEngine: "wiredTiger"},
  });
};

/**
 * Registers `beforeAll` / `afterAll` hooks that reconnect mongoose to a fresh in-memory Mongo
 * with the given topology, then disconnect and stop it. Call at the top level of an
 * `*.isolated.ts` file, after the imports.
 */
export const useMongoTopology = ({topology}: {topology: MongoTopology}): void => {
  let memoryMongo: MemoryMongo | undefined;

  // Replace the preload's connection before any test in this file touches a model.
  beforeAll(async () => {
    memoryMongo = await startMemoryMongo(topology);
    await mongoose.disconnect();
    await mongoose.connect(memoryMongo.getUri(), {dbName: "terrenoTopologyTest"});
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, 120_000);

  // Stop the in-memory server; the preload's afterAll closes whatever connection remains.
  afterAll(async () => {
    await mongoose.disconnect();
    await memoryMongo?.stop();
  }, 60_000);
};
