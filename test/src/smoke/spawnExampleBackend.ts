import {resolve} from "node:path";

import {freePort} from "./freePort";
import {type SpawnedProcess, spawnUntilReady} from "./spawnUntilReady";

export interface SpawnExampleBackendOptions {
  /** From `smokeMongoUri()`. */
  mongoUri: string;
  /** Default: a free port. */
  port?: number;
  /** Merged over the defaults, e.g. `{AUTH_PROVIDER: "better-auth"}`. */
  env?: Record<string, string | undefined>;
  /** How long the backend may take to answer `/health`. Default 60 000 ms. */
  timeoutMs?: number;
  /** Directory holding `src/index.ts`. Default: the monorepo's example-backend. */
  backendDir?: string;
}

export interface ExampleBackend extends SpawnedProcess {
  baseUrl: string;
  port: number;
}

/**
 * example-backend's SIGTERM hook stops the jobs worker and leaves the HTTP server running, so the
 * process never exits on SIGTERM alone. Its smoke database is disposable, so `stop()` waits only
 * briefly before SIGKILL instead of the default 5 s.
 */
const STOP_GRACE_MS = 500;

/** Same depth from `src/smoke` and `dist/smoke`, so source and compiled helpers agree. */
const EXAMPLE_BACKEND_DIR = resolve(__dirname, "../../../example-backend");

/**
 * Starts the monorepo's example-backend by path and resolves once `/health` answers 2xx. Client
 * smokes (rtk, syncdb, admin-frontend) use it so they get a real server without importing
 * `@terreno/api`. Auth secrets are fixed dev values; the clinic demo model avoids AI providers.
 */
export const spawnExampleBackend = async ({
  mongoUri,
  port,
  env,
  timeoutMs = 60000,
  backendDir = EXAMPLE_BACKEND_DIR,
}: SpawnExampleBackendOptions): Promise<ExampleBackend> => {
  const resolvedPort = port ?? (await freePort());
  const baseUrl = `http://127.0.0.1:${resolvedPort}`;
  const backend = await spawnUntilReady({
    cmd: [process.execPath, "src/index.ts"],
    cwd: backendDir,
    env: {
      BETTER_AUTH_SECRET: "terreno-smoke-better-auth-secret-32",
      BETTER_AUTH_URL: baseUrl,
      CLINIC_DEMO_MODEL: "true",
      MONGO_URI: mongoUri,
      PORT: String(resolvedPort),
      REFRESH_TOKEN_SECRET: "terreno-smoke-refresh-secret",
      SESSION_SECRET: "terreno-smoke-session-secret",
      TOKEN_ISSUER: "terreno-smoke",
      TOKEN_SECRET: "terreno-smoke-token-secret",
      ...env,
    },
    stopGraceMs: STOP_GRACE_MS,
    timeoutMs,
    url: `${baseUrl}/health`,
  });
  return {...backend, baseUrl, port: resolvedPort};
};
