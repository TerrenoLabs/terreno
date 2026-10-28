import {buildDatabaseUri} from "../mongo/connection";
import {resolveMongoLaunchTimeoutMs} from "../mongo/mongoServer";

export interface SmokeMongoUriOptions {
  /** Database name written into the URI. Default `terrenoSmoke`. */
  databaseName?: string;
}

interface ReplSetHandle {
  getUri: () => string;
  stop: (options: {doCleanup: boolean; force: boolean}) => Promise<boolean>;
}

let replSet: Promise<ReplSetHandle> | undefined;

const startReplSet = async (): Promise<ReplSetHandle> => {
  const {MongoMemoryReplSet} = await import("mongodb-memory-server-global");
  const started = new MongoMemoryReplSet({
    instanceOpts: [{launchTimeout: resolveMongoLaunchTimeoutMs()}],
    replSet: {args: ["--wiredTigerCacheSizeGB", "0.25"], count: 1, storageEngine: "wiredTiger"},
  });
  await started.start();
  await started.waitUntilRunning();
  return started;
};

/**
 * MongoDB URI for a smoke's server. Uses `TERRENO_TEST_MONGODB_URI` when set (the CI sidecar);
 * otherwise starts one single-node in-memory replica set per process, so change streams work.
 */
export const smokeMongoUri = async ({
  databaseName = "terrenoSmoke",
}: SmokeMongoUriOptions = {}): Promise<string> => {
  const externalUri = process.env.TERRENO_TEST_MONGODB_URI?.trim();
  if (externalUri) {
    return buildDatabaseUri({databaseName, uri: externalUri});
  }
  replSet ??= startReplSet().catch((error: unknown) => {
    replSet = undefined;
    throw error;
  });
  const handle = await replSet;
  return buildDatabaseUri({databaseName, uri: handle.getUri()});
};

/** Stops the in-memory replica set that `smokeMongoUri` started, if any. */
export const stopSmokeMongo = async (): Promise<void> => {
  const pending = replSet;
  replSet = undefined;
  if (!pending) {
    return;
  }
  const handle = await pending;
  await handle.stop({doCleanup: true, force: true});
};
