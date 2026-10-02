import {afterAll, afterEach, beforeAll, beforeEach, jest, mock, setSystemTime} from "bun:test";
import mongoose from "mongoose";
import {setTerrenoTestEnv, type TerrenoTestEnvOptions} from "../env/setTerrenoTestEnv";
import {
  createLogSilencer,
  registerLogSilencing,
  type SilenceLogsController,
  type SilenceLogsOptions,
} from "../logging/silenceLogs";
import {testLogger} from "../logging/testLogger";
import {registerSentryBunMock} from "../mocks/sentryBun";
import {
  initializeModels,
  type MongoServerOptions,
  resolveMongoLaunchTimeoutMs,
  startMongoServer,
  stopMongoServer,
} from "../mongo/mongoServer";
import {
  abortTestTransaction,
  installTransactionPatches,
  startTestTransaction,
} from "../transaction/testTransaction";

export interface BackendPreloadOptions {
  disableDb?: boolean;
  mongo?: MongoServerOptions;
  /** When true, `beforeAll` connects via `startMongoServer`. When false, the caller manages mongoose. */
  connectMongoInBeforeAll?: boolean;
  useTransactions?: boolean;
  silenceLogs?: boolean | SilenceLogsOptions;
  sentryMock?: boolean;
  testEnv?: TerrenoTestEnvOptions;
  onBeforeAll?: () => void | Promise<void>;
  onAfterAll?: () => void | Promise<void>;
  onBeforeEach?: () => void | Promise<void>;
  onAfterEach?: () => void | Promise<void>;
  loadModels?: () => Promise<void>;
  loadTestDataFromCache?: () => Promise<void>;
}

type LogSilencer = SilenceLogsController;

const shouldDisableDb = (options: BackendPreloadOptions): boolean => {
  if (options.disableDb) {
    return true;
  }
  return process.env.BUN_TEST_DISABLE_DB === "true";
};

let isServerStarted = false;
// Set when Mongo startup failed, so every later test fails at once instead of waiting on
// mongoose's command buffering.
let mongoStartupError: unknown;

/** Startup budget: two launch attempts plus connect and model init. */
const beforeAllTimeoutMs = (): number => resolveMongoLaunchTimeoutMs() * 2 + 30000;

/**
 * Registers Bun test lifecycle hooks for Terreno backend packages.
 * Call once from a package preload file (e.g. `api/src/tests/bunSetup.ts`).
 */
export const registerBackendPreload = (options: BackendPreloadOptions = {}): void => {
  const connectMongoInBeforeAll = options.connectMongoInBeforeAll ?? true;

  if (options.sentryMock !== false) {
    registerSentryBunMock();
  }

  let logSilencer: LogSilencer | undefined;
  if (options.silenceLogs !== false) {
    const silencerOptions = typeof options.silenceLogs === "object" ? options.silenceLogs : {};
    if (connectMongoInBeforeAll) {
      registerLogSilencing(silencerOptions);
    } else {
      logSilencer = createLogSilencer(silencerOptions);
    }
  }

  if (options.useTransactions) {
    installTransactionPatches();
  }

  if (!shouldDisableDb(options)) {
    beforeAll(async () => {
      if (connectMongoInBeforeAll) {
        if (mongoStartupError !== undefined) {
          throw mongoStartupError;
        }
        if (!isServerStarted) {
          setTerrenoTestEnv(options.testEnv);
          try {
            await startMongoServer(options.mongo);
          } catch (error: unknown) {
            mongoStartupError = error;
            throw error;
          }
          if (options.loadModels) {
            await options.loadModels();
          }
          if (options.loadTestDataFromCache) {
            await options.loadTestDataFromCache();
          }
          isServerStarted = true;
        } else {
          await initializeModels();
        }
      }
      await options.onBeforeAll?.();
    }, beforeAllTimeoutMs());

    if (connectMongoInBeforeAll) {
      afterAll(async () => {
        await options.onAfterAll?.();
        await stopMongoServer();
      });
    } else {
      afterAll(async () => {
        await options.onAfterAll?.();
      });
    }
  }

  beforeEach(async () => {
    if (mongoStartupError !== undefined) {
      throw new Error(`MongoDB test server failed to start: ${String(mongoStartupError)}`);
    }
    setTerrenoTestEnv(options.testEnv);
    logSilencer?.reapply();
    logSilencer?.clearLogs();
    if (options.useTransactions) {
      await startTestTransaction();
    }
    await options.onBeforeEach?.();
  });

  afterEach(async () => {
    if (options.useTransactions) {
      await abortTestTransaction();
    }
    setSystemTime();
    mock.clearAllMocks();
    jest.restoreAllMocks();
    logSilencer?.clearLogs();
    await options.onAfterEach?.();
    setTerrenoTestEnv(options.testEnv);
  });
};

/**
 * Simple Mongo preload: single memory server or external URI, no transactions.
 * Matches the historical `@terreno/api` `bunSetup.ts` behavior.
 */
export interface SimpleMongoPreloadOptions
  extends Omit<BackendPreloadOptions, "useTransactions" | "connectMongoInBeforeAll"> {
  /** Fallback URI when no env override or memory server is configured. */
  defaultLocalMongoUri?: string;
}

export const registerSimpleMongoPreload = (options: SimpleMongoPreloadOptions = {}): void => {
  let memoryMongo: {getUri: () => string; stop: () => Promise<boolean>} | undefined;
  const {
    defaultLocalMongoUri = "mongodb://127.0.0.1/terreno?&connectTimeoutMS=360000",
    ...preloadOptions
  } = options;

  registerBackendPreload({
    ...preloadOptions,
    connectMongoInBeforeAll: false,
    onAfterAll: async () => {
      await mongoose.connection.close();
      if (memoryMongo) {
        await memoryMongo.stop();
      }
      await preloadOptions.onAfterAll?.();
    },
    onBeforeAll: async () => {
      let uri = process.env.TERRENO_TEST_MONGODB_URI?.trim();
      if (!uri && process.env.TERRENO_TEST_USE_MEMORY_MONGO === "true") {
        const {MongoMemoryServer} = await import("mongodb-memory-server");
        memoryMongo = await MongoMemoryServer.create();
        uri = memoryMongo.getUri();
      }
      const connectUri = uri ?? defaultLocalMongoUri;
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(connectUri).catch(testLogger.catch);
      }
      await preloadOptions.onBeforeAll?.();
    },
    useTransactions: false,
  });
};
