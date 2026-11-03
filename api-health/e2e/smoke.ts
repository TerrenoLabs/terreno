/**
 * Real-process smoke for @terreno/api-health. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * The smoke re-runs this file with `serve` as a child process: an Express server on a free port
 * that registers the compiled `HealthApp` plugin twice, with defaults and with a check that reports
 * a dependency down. The parent then checks over real HTTP that the default route is healthy and
 * that a failing check answers 503, the status load balancers and probes act on. Exits non-zero
 * on the first failed check.
 */
import {freePort, type SpawnedProcess, spawnUntilReady} from "@terreno/test";

const SERVE_ARG = "serve";
const DOWN_DETAIL = "smoke-down";

interface HealthBody {
  healthy: boolean;
  details?: {dependency?: string};
}

/**
 * Child: a plain Express server with the compiled plugin registered, the way `TerrenoApp`
 * registers it. The plugin is imported here, not at the top, so the parent never loads it.
 */
const serve = async (): Promise<void> => {
  const {HealthApp} = await import("@terreno/api-health");
  const {default: express} = await import("express");

  const app = express();
  new HealthApp().register(app);
  new HealthApp({
    check: () => ({details: {dependency: DOWN_DETAIL}, healthy: false}),
    path: "/health/down",
  }).register(app);

  app.listen(Number(process.env.PORT), "127.0.0.1", () => {
    console.info(`[apiHealthSmoke] serving on port ${process.env.PORT}`);
  });
};

const expectHealth = async ({
  baseUrl,
  path,
  status,
  healthy,
  dependency,
}: {
  baseUrl: string;
  path: string;
  status: number;
  healthy: boolean;
  dependency?: string;
}): Promise<void> => {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  if (res.status !== status) {
    throw new Error(`GET ${path}: expected ${status}, got ${res.status}: ${text}`);
  }
  const body = JSON.parse(text) as HealthBody;
  if (body.healthy !== healthy) {
    throw new Error(`GET ${path}: expected healthy ${healthy}, got ${text}`);
  }
  if (body.details?.dependency !== dependency) {
    throw new Error(`GET ${path}: expected details.dependency ${dependency}, got ${text}`);
  }
};

/** Parent: boots the child and checks both health routes over HTTP. */
const run = async (): Promise<void> => {
  const startedAt = performance.now();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: SpawnedProcess | undefined;

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {PORT: String(port)},
      timeoutMs: 20000,
      url: `${baseUrl}/health`,
    });

    await expectHealth({baseUrl, healthy: true, path: "/health", status: 200});
    console.info("✅ GET /health is healthy with the default plugin");

    await expectHealth({
      baseUrl,
      dependency: DOWN_DETAIL,
      healthy: false,
      path: "/health/down",
      status: 503,
    });
    console.info("✅ GET /health/down answers 503 when its check fails");
  } catch (error: unknown) {
    if (server) {
      console.error(`--- server output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
  }

  console.info(`api-health smoke passed in ${Math.round(performance.now() - startedAt)} ms`);
};

const main = process.argv[2] === SERVE_ARG ? serve : run;
main().then(
  () => {
    if (main === run) {
      process.exit(0);
    }
  },
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
