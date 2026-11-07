import type {DefaultPersisterFactoryConfig, PersisterFactory} from "./types";

const DEFAULT_STORE_TABLE_NAME = "terreno_syncdb";

const MISSING_EXPO_SQLITE_MESSAGE =
  "@terreno/syncdb needs the optional expo-sqlite peer for native persistence. Add it to your " +
  "app (not just to a library that depends on @terreno/syncdb, or Expo autolinking will skip " +
  "it) with `bunx expo install expo-sqlite`, then rebuild the native project so the ExpoSQLite " +
  "module is linked in — reloading JS is not enough.";

/**
 * Loads expo-sqlite, collapsing its two failure modes into one actionable error: the JS package
 * missing entirely (`require` throws) and the package resolving while its native module is
 * absent from the build, which otherwise surfaces as a bare "openDatabaseSync of undefined".
 */
const loadExpoSqlite = (): typeof import("expo-sqlite") => {
  let expoSqlite: typeof import("expo-sqlite") | undefined;
  try {
    expoSqlite = require("expo-sqlite") as typeof import("expo-sqlite");
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${MISSING_EXPO_SQLITE_MESSAGE} (${detail})`);
  }

  if (typeof expoSqlite?.openDatabaseSync !== "function") {
    throw new Error(MISSING_EXPO_SQLITE_MESSAGE);
  }

  return expoSqlite;
};

/**
 * Native default persister: the MergeableStore is stored in an expo-sqlite
 * database using TinyBase's JSON serialization mode (a string table name —
 * required, since tabular mode cannot carry MergeableStore CRDT metadata).
 * SQLite files are already sandboxed per app on iOS/Android, so no additional
 * encryption layer is applied here.
 */
export const createDefaultPersisterFactory = (
  config: DefaultPersisterFactoryConfig = {}
): PersisterFactory => {
  return ({store, databaseName}) => {
    // Lazy requires: TinyBase's expo-sqlite persister module itself imports
    // expo-sqlite at its top level, so deferring BOTH loads until a persister
    // is actually created keeps @terreno/syncdb importable in apps (and test
    // runtimes) that do not have the optional expo-sqlite peer installed.
    const {openDatabaseSync} = loadExpoSqlite();
    const {createExpoSqlitePersister} =
      require("tinybase/persisters/persister-expo-sqlite") as typeof import("tinybase/persisters/persister-expo-sqlite");
    const db = openDatabaseSync(databaseName);
    // TinyBase 9.5 still peers expo-sqlite ^57, so bun nests a second copy next to
    // catalog 58. Private fields on SQLiteDatabase then fail assignability.
    return createExpoSqlitePersister(
      store,
      db as unknown as Parameters<typeof createExpoSqlitePersister>[1],
      config.storeTableName ?? DEFAULT_STORE_TABLE_NAME
    );
  };
};
