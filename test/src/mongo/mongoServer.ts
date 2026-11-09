import {DateTime} from "luxon";
import mongoose from "mongoose";

import {testLogger} from "../logging/testLogger";

import {buildDatabaseUri} from "./connection";

export interface MemoryMongoHandle {
  getUri: () => string;
  stop: () => Promise<boolean>;
}

export interface MongoServerOptions {
  /** Env var checked first for an external MongoDB URI (CI containers). */
  externalUriEnvVar?: string;
  /** Env var written with the resolved Mongo URI for consumers. */
  publishedUriEnvVar?: string;
  baseDatabaseName?: string;
  useReplSet?: boolean;
  debug?: boolean;
}

const DEFAULT_OPTIONS: Required<
  Pick<MongoServerOptions, "externalUriEnvVar" | "publishedUriEnvVar" | "baseDatabaseName">
> = {
  baseDatabaseName: "terrenoTest_base",
  externalUriEnvVar: "TERRENO_TEST_MONGODB_URI",
  publishedUriEnvVar: "TERRENO_TEST_MONGO_URI",
};

const RETRYABLE_MONGO_CODES = new Set([11600, 91]);

const initializedModelNames = new Set<string>();

let memoryMongo: MemoryMongoHandle | undefined;
let mongoServerUri: string | null = null;

export const waitForDatabaseReady = async (maxAttempts = 15, delayMs = 1000): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("mongoose.connection.db is undefined");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.admin().command({ping: 1});
      return;
    } catch (error: unknown) {
      const err = error as {code?: number; cause?: {code?: number}};
      const code = err?.code ?? err?.cause?.code;
      const isRetryable = code != null && RETRYABLE_MONGO_CODES.has(code);
      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }
      if (process.env.DEBUG_MONGO_PRELOAD === "true") {
        testLogger.debug(
          `[mongoServer] Database not ready (attempt ${attempt}/${maxAttempts}, code=${code}), retrying in ${delayMs}ms...`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};

export const initializeModels = async (): Promise<{modelCount: number; modelInitMs: number}> => {
  const models = Object.keys(mongoose.models);
  const newModels = models.filter((modelName) => !initializedModelNames.has(modelName));

  if (newModels.length === 0) {
    return {modelCount: models.length, modelInitMs: 0};
  }

  const startTime = DateTime.now().toMillis();
  const initPromises = newModels.map(async (modelName) => {
    await mongoose.models[modelName].init();
  });
  await Promise.all(initPromises);

  for (const modelName of newModels) {
    initializedModelNames.add(modelName);
  }

  return {modelCount: models.length, modelInitMs: DateTime.now().toMillis() - startTime};
};

const shouldUseReplSet = (options: MongoServerOptions): boolean => {
  if (options.useReplSet !== undefined) {
    return options.useReplSet;
  }
  return process.env.TERRENO_TEST_USE_REPLSET === "true";
};

const DEFAULT_LAUNCH_TIMEOUT_MS = 60000;
const MEMORY_SERVER_START_ATTEMPTS = 2;

/**
 * How long one mongod may take to start. mongodb-memory-server defaults to 10s, which loaded
 * CI hosts and sandboxed VMs exceed when starting a replica set.
 * Override with `TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS`.
 */
export const resolveMongoLaunchTimeoutMs = (): number => {
  const raw = process.env.TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  // mongodb-memory-server ignores launch timeouts below one second
  if (Number.isInteger(parsed) && parsed >= 1000) {
    return parsed;
  }
  return DEFAULT_LAUNCH_TIMEOUT_MS;
};

const startMemoryServerOnce = async (
  useReplSet: boolean,
  launchTimeout: number
): Promise<MemoryMongoHandle> => {
  if (useReplSet) {
    const {MongoMemoryReplSet} = await import("mongodb-memory-server-global");
    const replSet = new MongoMemoryReplSet({
      instanceOpts: [{launchTimeout}],
      replSet: {
        args: ["--wiredTigerCacheSizeGB", "0.25"],
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    try {
      await replSet.start();
      await replSet.waitUntilRunning();
    } catch (error: unknown) {
      await replSet.stop({doCleanup: true, force: true}).catch(() => false);
      throw error;
    }
    return replSet;
  }

  const {MongoMemoryServer} = await import("mongodb-memory-server");
  return MongoMemoryServer.create({instance: {launchTimeout}});
};

const startMemoryServer = async (useReplSet: boolean): Promise<string> => {
  const launchTimeout = resolveMongoLaunchTimeoutMs();
  let lastError: unknown;
  for (let attempt = 1; attempt <= MEMORY_SERVER_START_ATTEMPTS; attempt++) {
    try {
      const handle = await startMemoryServerOnce(useReplSet, launchTimeout);
      memoryMongo = handle;
      return handle.getUri();
    } catch (error: unknown) {
      lastError = error;
      testLogger.warn(
        `[mongoServer] In-memory MongoDB failed to start (attempt ${attempt}/${MEMORY_SERVER_START_ATTEMPTS}): ${String(error)}`
      );
    }
  }
  throw lastError;
};

/**
 * Starts or reuses the MongoDB server for tests and connects mongoose once per worker.
 */
export const startMongoServer = async (options: MongoServerOptions = {}): Promise<string> => {
  if (mongoServerUri) {
    return mongoServerUri;
  }

  const merged = {...DEFAULT_OPTIONS, ...options};
  const startTime = DateTime.now().toMillis();
  const externalUri = process.env[merged.externalUriEnvVar]?.trim();
  let uri: string;

  if (externalUri) {
    uri = externalUri;
    if (process.env.DEBUG_MONGO_PRELOAD === "true") {
      testLogger.debug(`[mongoServer] Using external MongoDB at ${externalUri}`);
    }
  } else {
    uri = await startMemoryServer(shouldUseReplSet(options));
  }

  mongoServerUri = uri;
  process.env[merged.publishedUriEnvVar] = uri;

  const connectionUri = buildDatabaseUri({databaseName: merged.baseDatabaseName, uri});
  await mongoose.connect(connectionUri, {
    connectTimeoutMS: 5000,
    maxPoolSize: 5,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 0,
  });

  await waitForDatabaseReady();
  const {modelCount, modelInitMs} = await initializeModels();

  if (process.env.DEBUG_MONGO_PRELOAD === "true") {
    testLogger.debug(
      `[mongoServer] Initialized ${modelCount} models in ${modelInitMs}ms, connected in ${DateTime.now().toMillis() - startTime}ms`
    );
  }

  return uri;
};

/** Force-restarts the in-memory MongoDB server and reconnects mongoose. */
export const restartMongoServer = async (options: MongoServerOptions = {}): Promise<void> => {
  const merged = {...DEFAULT_OPTIONS, ...options};
  const startTime = DateTime.now().toMillis();
  testLogger.warn("[mongoServer] Force-restarting MongoDB server...");

  try {
    await mongoose.disconnect();
  } catch {
    // Connection may already be dead.
  }

  if (memoryMongo) {
    try {
      await memoryMongo.stop();
    } catch {
      // Ignore stop errors.
    }
    memoryMongo = undefined;
    mongoServerUri = null;
    const uri = await startMemoryServer(shouldUseReplSet(options));
    mongoServerUri = uri;
    process.env[merged.publishedUriEnvVar] = uri;
  }

  const uri = mongoServerUri;
  if (!uri) {
    throw new Error("[mongoServer] No Mongo URI available after restart");
  }

  const connectionUri = buildDatabaseUri({databaseName: merged.baseDatabaseName, uri});
  await mongoose.connect(connectionUri, {
    connectTimeoutMS: 2000,
    maxPoolSize: 10,
    minPoolSize: 10,
    serverSelectionTimeoutMS: 2000,
    socketTimeoutMS: 2000,
  });

  await waitForDatabaseReady(5, 500);
  initializedModelNames.clear();
  await initializeModels();

  testLogger.warn(
    `[mongoServer] MongoDB server restarted in ${DateTime.now().toMillis() - startTime}ms`
  );
};

export const stopMongoServer = async (): Promise<void> => {
  await mongoose.connection.close();
  if (memoryMongo) {
    await memoryMongo.stop();
    memoryMongo = undefined;
  }
  mongoServerUri = null;
};

export const getMongoServerUri = (): string | null => mongoServerUri;
