import type {Connection} from "mongoose";

export type LocalMongoDb = NonNullable<Connection["db"]>;

/**
 * Runs `run` against a dedicated connection to `mongoUri` and always destroys it afterwards.
 *
 * Each tool call owns its connection, so concurrent calls never close each other's client and
 * the call never reuses (or disconnects) a global mongoose connection pointed at another database.
 */
export const withLocalMongoDb = async (
  mongoUri: string,
  run: (db: LocalMongoDb) => Promise<string>
): Promise<string> => {
  // Lazy so the stdio server starts without loading the Mongo driver. Under Bun, mongoose's
  // CommonJS instance properties (such as `connection`) exist only on the default export.
  const {default: mongoose} = await import("mongoose");
  const connection = mongoose.createConnection(mongoUri);
  try {
    await connection.asPromise();
    const db = connection.db;
    if (!db) {
      return "Connected to Mongo but `connection.db` is not available.";
    }
    return await run(db);
  } finally {
    // destroy() also drops the connection from mongoose.connections, so repeated calls do not accumulate.
    await connection.destroy().catch(() => undefined);
  }
};
