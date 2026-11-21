import {type ChildProcess, spawn, spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync} from "node:fs";
import {connect} from "node:net";
import {join} from "node:path";

const REPLICA_SET = "rs0";
const START_ATTEMPTS = 60;

interface StartMongoOptions {
  appDir: string;
  env: NodeJS.ProcessEnv;
  port?: number;
}

export interface RunningMongo {
  stop: () => Promise<void>;
}

const isListening = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({host: "127.0.0.1", port});
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const mongosh = (env: NodeJS.ProcessEnv, port: number, script: string): string => {
  const result = spawnSync(
    env.MONGOSH_BIN || "mongosh",
    [`mongodb://127.0.0.1:${port}/?directConnection=true`, "--quiet", "--eval", script],
    {encoding: "utf8"}
  );
  return `${result.stdout ?? ""}`.trim();
};

/**
 * Starts the single-node replica set the app needs (change streams power sync) on the app's
 * own `./.mongo`, the directory the builder was told to use, so seeded users are still there.
 * Refuses to share a port with a Mongo it did not start: the app would write into it.
 */
export const startReplicaSetMongo = async ({
  appDir,
  env,
  port = 27017,
}: StartMongoOptions): Promise<RunningMongo> => {
  if (await isListening(port)) {
    throw new Error(`port ${String(port)} is already in use; stop that MongoDB before scoring`);
  }
  const dbPath = join(appDir, ".mongo");
  mkdirSync(dbPath, {recursive: true});
  const child: ChildProcess = spawn(
    env.MONGOD_BIN || "mongod",
    [
      "--replSet",
      REPLICA_SET,
      "--port",
      String(port),
      "--bind_ip",
      "127.0.0.1",
      "--dbpath",
      dbPath,
    ],
    {stdio: "ignore"}
  );
  const stop = async (): Promise<void> => {
    child.kill("SIGTERM");
  };
  try {
    for (let attempt = 0; attempt < START_ATTEMPTS && !(await isListening(port)); attempt++) {
      await sleep(500);
    }
    mongosh(
      env,
      port,
      `try { rs.status() } catch (error) { rs.initiate({_id: "${REPLICA_SET}", members: [{_id: 0, host: "127.0.0.1:${String(port)}"}]}) }`
    );
    for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
      if (mongosh(env, port, "db.hello().isWritablePrimary") === "true") {
        return {stop};
      }
      await sleep(500);
    }
    throw new Error("MongoDB replica set did not elect a primary");
  } catch (error) {
    await stop();
    throw error;
  }
};

const dbNameFromUri = (uri: string): string => {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  return match?.[1] ?? "test";
};

/** Reads `MONGO_URI` from the app's backend `.env`, the database the app itself uses. */
const appMongoUri = (appDir: string): string | undefined => {
  const path = join(appDir, "backend", ".env");
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, "utf8")
    .match(/^MONGO_URI=(.+)$/m)?.[1]
    ?.trim();
};

/** Counts documents with mongosh against the app's own database, for the access probes. */
export const mongoCounter = ({
  appDir,
  env,
  port = 27017,
}: StartMongoOptions): ((
  collection: string,
  filter: Record<string, unknown>
) => Promise<number>) => {
  const db = dbNameFromUri(appMongoUri(appDir) ?? "");
  return async (collection, filter) => {
    const script = `db.getSiblingDB(${JSON.stringify(db)}).getCollection(${JSON.stringify(collection)}).countDocuments(${JSON.stringify(filter)})`;
    const count = Number(mongosh(env, port, script));
    return Number.isFinite(count) ? count : 0;
  };
};
