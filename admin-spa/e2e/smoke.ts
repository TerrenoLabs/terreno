/**
 * Real-process smoke for @terreno/admin-spa. Run `bun e2e/smoke.ts` after `bun run compile`
 * and `bun run build:web`.
 *
 * The smoke re-runs this file with `serve` as a child process: an Express server on a free port
 * that registers the compiled `AdminSpaServeApp` with its default bundle location, the way a
 * backend serves the SPA. The parent then checks over real HTTP that the mounted index loads its
 * bundle, the runtime config merges the consumer's overrides, and a deep route falls back to the
 * SPA. Exits non-zero on the first failed check.
 */
import fs from "node:fs";
import path from "node:path";
import {freePort, type SpawnedProcess, spawnUntilReady} from "@terreno/test";

const SERVE_ARG = "serve";
const BASE_PATH = "/console";
const BRAND_NAME = "Terreno Admin (smoke)";
const INDEX_HTML = path.resolve(__dirname, "../dist/index.html");
const FETCH_TIMEOUT_MS = 5000;

/**
 * Child: a plain Express server with the compiled plugin registered, the way `TerrenoApp`
 * registers it. The plugin is imported here, not at the top, so the parent never loads it.
 */
const serve = async (): Promise<void> => {
  const {AdminSpaServeApp} = await import("@terreno/admin-spa");
  const {default: express} = await import("express");

  const app = express();
  new AdminSpaServeApp({appConfig: {brandName: BRAND_NAME}, basePath: BASE_PATH}).register(app);

  app.listen(Number(process.env.PORT), "127.0.0.1", () => {
    console.info(`[adminSpaSmoke] serving on port ${process.env.PORT}`);
  });
};

const fetchOk = async (url: string): Promise<Response> => {
  const res = await fetch(url, {signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
  if (res.status !== 200) {
    throw new Error(`GET ${url}: expected 200, got ${res.status}: ${await res.text()}`);
  }
  return res;
};

const expectSpaIndex = async (res: Response, route: string): Promise<string> => {
  const contentType = res.headers.get("content-type");
  if (!contentType?.includes("text/html")) {
    throw new Error(`GET ${route}: expected HTML, got ${contentType}`);
  }
  const html = await res.text();
  const baseGlobal = `window.__ADMIN_SPA_BASE__=${JSON.stringify(BASE_PATH)}`;
  if (!html.includes("<html") || !html.includes(baseGlobal)) {
    throw new Error(`GET ${route}: expected the SPA index with ${baseGlobal}, got ${html}`);
  }
  return html;
};

/** Parent: boots the child and walks the SPA's routes over HTTP. */
const run = async (): Promise<void> => {
  const startedAt = performance.now();
  if (!fs.existsSync(INDEX_HTML)) {
    throw new Error(`No web export at ${INDEX_HTML}. Run \`bun run build:web\` first.`);
  }

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: SpawnedProcess | undefined;

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {PORT: String(port)},
      timeoutMs: 20000,
      url: `${baseUrl}${BASE_PATH}/app-config.json`,
    });

    const indexHtml = await expectSpaIndex(
      await fetchOk(`${baseUrl}${BASE_PATH}/`),
      `${BASE_PATH}/`
    );
    console.info(`✅ GET ${BASE_PATH}/ serves the index with the base path injected`);

    const entryUrl = indexHtml.match(
      new RegExp(`${BASE_PATH}/_expo/static/js/web/entry-[^"]+\\.js`)
    )?.[0];
    if (!entryUrl) {
      throw new Error(`GET ${BASE_PATH}/: no entry bundle under ${BASE_PATH}/_expo/ in the index`);
    }
    const entryRes = await fetchOk(`${baseUrl}${entryUrl}`);
    if (!entryRes.headers.get("content-type")?.includes("javascript")) {
      throw new Error(
        `GET ${entryUrl}: expected JavaScript, got ${entryRes.headers.get("content-type")}`
      );
    }
    console.info(`✅ GET ${entryUrl} serves the JS bundle`);

    const config = (await (await fetchOk(`${baseUrl}${BASE_PATH}/app-config.json`)).json()) as {
      brandName?: string;
      providers?: string[];
    };
    if (config.brandName !== BRAND_NAME || config.providers?.join() !== "email") {
      throw new Error(
        `GET ${BASE_PATH}/app-config.json: expected brandName ${BRAND_NAME} and default ` +
          `providers [email], got ${JSON.stringify(config)}`
      );
    }
    console.info(`✅ GET ${BASE_PATH}/app-config.json merges overrides over the defaults`);

    const deepRoute = `${BASE_PATH}/User/123`;
    await expectSpaIndex(await fetchOk(`${baseUrl}${deepRoute}`), deepRoute);
    console.info(`✅ GET ${deepRoute} falls back to the SPA index`);
  } catch (error: unknown) {
    if (server) {
      console.error(`--- server output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
  }

  console.info(`admin-spa smoke passed in ${Math.round(performance.now() - startedAt)} ms`);
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
