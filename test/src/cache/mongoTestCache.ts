import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {testLogger} from "../logging/testLogger";

import {buildDatabaseUri} from "../mongo/connection";
import {restartMongoServer, startMongoServer, waitForDatabaseReady} from "../mongo/mongoServer";
import {resetTestSessionAfterReconnect} from "../transaction/testTransaction";
import {ensureAllIndexes} from "../utils/ensureAllIndexes";

const HASH_FILE = "source-hash.txt";
const CACHED_DATA_FILE = "cached-data.json";
const CACHED_COLLECTIONS_FILE = "cached-collections.json";
const MAX_CACHE_AGE_MS = 60 * 60 * 1000;

export interface MongoTestCacheOptions {
  cacheDir: string;
  sourceDirs: string[];
  createTestData: () => Promise<unknown>;
  publishedUriEnvVar?: string;
  baseDatabaseName?: string;
}

export interface MongoTestCacheController {
  loadTestDataFromCache: () => Promise<void>;
  setupTestCache: (options?: {force?: boolean}) => Promise<void>;
  cleanCache: () => void;
  cacheFilesExist: () => boolean;
}

const getAllTsFiles = (dir: string): string[] => {
  const files: string[] = [];
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, {withFileTypes: true});
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
};

const calculateSourceFilesHash = (sourceDirs: string[]): string => {
  const tsFiles = sourceDirs.flatMap((dir) => getAllTsFiles(dir)).sort();
  const hash = crypto.createHash("sha256");
  for (const file of tsFiles) {
    hash.update(file);
    hash.update(fs.readFileSync(file, "utf-8"));
  }
  return hash.digest("hex");
};

const getSavedHash = (cacheDir: string): string | null => {
  const hashFilePath = path.join(cacheDir, HASH_FILE);
  if (!fs.existsSync(hashFilePath)) {
    return null;
  }
  try {
    return fs.readFileSync(hashFilePath, "utf-8").trim();
  } catch {
    return null;
  }
};

const saveHash = (cacheDir: string, hash: string): void => {
  fs.mkdirSync(cacheDir, {recursive: true});
  fs.writeFileSync(path.join(cacheDir, HASH_FILE), hash);
};

const cacheFilesExist = (cacheDir: string): boolean => {
  const dataFilePath = path.join(cacheDir, CACHED_DATA_FILE);
  const collectionsFilePath = path.join(cacheDir, CACHED_COLLECTIONS_FILE);
  const hashFilePath = path.join(cacheDir, HASH_FILE);

  if (
    !fs.existsSync(dataFilePath) ||
    !fs.existsSync(collectionsFilePath) ||
    !fs.existsSync(hashFilePath)
  ) {
    return false;
  }

  if (!process.env.CI) {
    const cacheAge = DateTime.now().toMillis() - fs.statSync(dataFilePath).mtimeMs;
    if (cacheAge > MAX_CACHE_AGE_MS) {
      return false;
    }
  }

  return true;
};

const convertValue = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    if (value.match(/^\d{4}-\d{2}-\d{2}T/)) {
      return DateTime.fromISO(value).toJSDate();
    }
    if (value.match(/^[0-9a-fA-F]{24}$/)) {
      return new mongoose.Types.ObjectId(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertValue(item));
  }
  if (typeof value === "object") {
    const converted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      converted[key] = convertValue(nested);
    }
    return converted;
  }
  return value;
};

const getReconnectUri = (publishedUriEnvVar: string, baseDatabaseName: string): string => {
  const uri = process.env[publishedUriEnvVar];
  if (!uri) {
    throw new Error(`[mongoTestCache] ${publishedUriEnvVar} is not set`);
  }
  return buildDatabaseUri({databaseName: mongoose.connection.name || baseDatabaseName, uri});
};

/** Throws when the driver has no database handle, so callers treat it like a failed ping. */
const requireDb = (): mongoose.mongo.Db => {
  const {db} = mongoose.connection;
  if (!db) {
    throw new Error("[mongoTestCache] mongoose connection has no database handle");
  }
  return db;
};

const ensureConnectionReady = async (
  publishedUriEnvVar: string,
  baseDatabaseName: string
): Promise<void> => {
  const maxQuickAttempts = 3;
  const delayMs = 200;

  for (let attempt = 1; attempt <= maxQuickAttempts; attempt++) {
    const state = mongoose.connection.readyState;
    if (state === 1) {
      try {
        await requireDb().admin().command({ping: 1});
        return;
      } catch {
        // stale connection
      }
    }

    if (state === 0 || state === 3) {
      try {
        if (state === 3) {
          await mongoose.disconnect().catch(() => {});
        }
        await mongoose.connect(getReconnectUri(publishedUriEnvVar, baseDatabaseName), {
          connectTimeoutMS: 2000,
          serverSelectionTimeoutMS: 2000,
          socketTimeoutMS: 2000,
        });
        await requireDb().admin().command({ping: 1});
        await resetTestSessionAfterReconnect();
        return;
      } catch {
        // retry
      }
    }

    if (attempt < maxQuickAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  await restartMongoServer({baseDatabaseName, publishedUriEnvVar});
  await resetTestSessionAfterReconnect();
};

const loadTestDataIntoDb = async (cachedCollections: Record<string, unknown[]>): Promise<void> => {
  const clearPromises: Array<Promise<unknown>> = [];
  for (const collectionName of Object.keys(cachedCollections)) {
    clearPromises.push(requireDb().collection(collectionName).deleteMany({}));
  }
  await Promise.all(clearPromises);

  const restorePromises: Array<Promise<unknown>> = [];
  for (const collectionName of Object.keys(cachedCollections)) {
    const docs = cachedCollections[collectionName];
    if (!docs || docs.length === 0) {
      continue;
    }
    const convertedDocs = docs.map((doc) => convertValue(doc));
    restorePromises.push(
      requireDb()
        .collection(collectionName)
        .insertMany(convertedDocs as Record<string, unknown>[], {ordered: false})
    );
  }

  const restoreResults = await Promise.allSettled(restorePromises);
  for (const result of restoreResults) {
    if (result.status === "rejected") {
      const error = result.reason as {code?: number; writeErrors?: Array<{code?: number}>};
      const isDuplicateKey =
        error?.code === 11000 ||
        error?.writeErrors?.every((writeError) => writeError.code === 11000);
      if (!isDuplicateKey) {
        throw result.reason;
      }
    }
  }
  await ensureAllIndexes();
};

export const createMongoTestCache = (options: MongoTestCacheOptions): MongoTestCacheController => {
  const publishedUriEnvVar = options.publishedUriEnvVar ?? "TERRENO_TEST_MONGO_URI";
  const baseDatabaseName = options.baseDatabaseName ?? "terrenoTest_base";

  let cachedSourceHash: string | null = null;
  let cachedCollectionsInMemory: Record<string, unknown[]> | null = null;
  let inflightSetupTestCache: Promise<void> | null = null;

  const getSourceHash = (): string => {
    if (!cachedSourceHash) {
      cachedSourceHash = calculateSourceFilesHash(options.sourceDirs);
    }
    return cachedSourceHash;
  };

  const cleanCache = (): void => {
    for (const file of [CACHED_DATA_FILE, CACHED_COLLECTIONS_FILE, HASH_FILE]) {
      const filePath = path.join(options.cacheDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    cachedCollectionsInMemory = null;
    cachedSourceHash = null;
  };

  const setupTestCache = async ({force = false}: {force?: boolean} = {}): Promise<void> => {
    const currentHash = calculateSourceFilesHash(options.sourceDirs);
    const savedHash = getSavedHash(options.cacheDir);

    if (!force && savedHash === currentHash && cacheFilesExist(options.cacheDir)) {
      return;
    }

    const isAlreadyConnected = mongoose.connection.readyState === 1;
    if (!isAlreadyConnected) {
      await startMongoServer({baseDatabaseName, publishedUriEnvVar, useReplSet: true});
      await waitForDatabaseReady();
    }

    const cachedData = await options.createTestData();
    const cachedCollections: Record<string, unknown[]> = {};

    for (const collectionName of Object.keys(mongoose.connection.collections)) {
      const collection = mongoose.connection.collections[collectionName];
      const docs = await collection.find({}).toArray();
      cachedCollections[collectionName] = docs.map((doc) => JSON.parse(JSON.stringify(doc)));
    }

    fs.mkdirSync(options.cacheDir, {recursive: true});
    fs.writeFileSync(path.join(options.cacheDir, CACHED_DATA_FILE), JSON.stringify(cachedData));
    fs.writeFileSync(
      path.join(options.cacheDir, CACHED_COLLECTIONS_FILE),
      JSON.stringify(cachedCollections)
    );
    saveHash(options.cacheDir, currentHash);
    cachedCollectionsInMemory = cachedCollections;
    testLogger.info(`[mongoTestCache] Test data cached to ${options.cacheDir}`);
  };

  const loadTestDataFromCache = async (): Promise<void> => {
    fs.mkdirSync(options.cacheDir, {recursive: true});

    const cachedFilePath = path.join(options.cacheDir, CACHED_COLLECTIONS_FILE);
    const currentHash = getSourceHash();
    const savedHash = getSavedHash(options.cacheDir);
    const cacheValid = cacheFilesExist(options.cacheDir) && savedHash === currentHash;

    if (!cacheValid) {
      if (!inflightSetupTestCache) {
        inflightSetupTestCache = setupTestCache().finally(() => {
          inflightSetupTestCache = null;
        });
      }
      // Wrapped because the `finally` above clears the shared slot once it settles.
      await Promise.resolve(inflightSetupTestCache);
    }

    if (!cachedCollectionsInMemory) {
      cachedCollectionsInMemory = JSON.parse(fs.readFileSync(cachedFilePath, "utf-8"));
    }

    if (!cachedCollectionsInMemory) {
      throw new Error("[mongoTestCache] Cached collections were not loaded");
    }

    await ensureConnectionReady(publishedUriEnvVar, baseDatabaseName);
    await loadTestDataIntoDb(cachedCollectionsInMemory);
  };

  return {
    cacheFilesExist: () => cacheFilesExist(options.cacheDir),
    cleanCache,
    loadTestDataFromCache,
    setupTestCache,
  };
};
