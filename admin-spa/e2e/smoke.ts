/**
 * Real-process smoke for @terreno/admin-spa. Run `bun e2e/smoke.ts` after `bun run compile`
 * and `bun run build:web`.
 *
 * The smoke re-runs this file with `serve` as a child process: an Express server on a free port
 * that registers the compiled `AdminSpaServeApp` with its default bundle location, the way a
 * backend serves the SPA. The parent then checks over real HTTP that the login page is
 * server-rendered with the brand and form, that the page and the site-root login loader are sent
 * `Cache-Control: no-store, private`, that the bundle and runtime config load, and that an
 * anonymous protected page redirects to login. Exits non-zero on the first failed check.
 */
import fs from "node:fs";
import path from "node:path";
import {freePort, type SpawnedProcess, spawnUntilReady} from "@terreno/test";

const SERVE_ARG = "serve";
const BASE_PATH = "/console";
const BRAND_NAME = "Terreno Admin (smoke)";
const SERVER_BUILD = path.resolve(__dirname, "../dist/server/_expo/routes.json");
const FETCH_TIMEOUT_MS = 5000;
const NO_STORE_PRIVATE = "no-store, private";

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

const fetchStatus = async (url: string, expected: number): Promise<Response> => {
  const res = await fetch(url, {redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
  if (res.status !== expected) {
    throw new Error(`GET ${url}: expected ${expected}, got ${res.status}: ${await res.text()}`);
  }
  return res;
};

const expectNoStorePrivate = (res: Response, route: string): void => {
  const cacheControl = res.headers.get("cache-control");
  if (cacheControl !== NO_STORE_PRIVATE) {
    throw new Error(
      `GET ${route}: expected Cache-Control ${NO_STORE_PRIVATE}, got ${cacheControl}`
    );
  }
};

/** Parent: boots the child and walks the SPA's routes over HTTP. */
const run = async (): Promise<void> => {
  const startedAt = performance.now();
  if (!fs.existsSync(SERVER_BUILD)) {
    throw new Error(`No server build at ${SERVER_BUILD}. Run \`bun run build:web\` first.`);
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

    const loginRoute = `${BASE_PATH}/login`;
    const loginRes = await fetchStatus(`${baseUrl}${loginRoute}`, 200);
    if (!loginRes.headers.get("content-type")?.includes("text/html")) {
      throw new Error(
        `GET ${loginRoute}: expected HTML, got ${loginRes.headers.get("content-type")}`
      );
    }
    expectNoStorePrivate(loginRes, loginRoute);
    const loginHtml = await loginRes.text();
    const baseGlobal = `window.__ADMIN_SPA_BASE__=${JSON.stringify(BASE_PATH)}`;
    for (const expected of [BRAND_NAME, "admin-spa-login-email", baseGlobal]) {
      if (!loginHtml.includes(expected)) {
        throw new Error(`GET ${loginRoute}: the server-rendered page does not contain ${expected}`);
      }
    }
    console.info(`✅ GET ${loginRoute} is server-rendered with the brand and login form`);

    const entryUrl = loginHtml.match(
      new RegExp(`${BASE_PATH}/_expo/static/js/web/entry-[^"]+\\.js`)
    )?.[0];
    if (!entryUrl) {
      throw new Error(`GET ${loginRoute}: no entry bundle under ${BASE_PATH}/_expo/ in the page`);
    }
    const entryRes = await fetchStatus(`${baseUrl}${entryUrl}`, 200);
    if (!entryRes.headers.get("content-type")?.includes("javascript")) {
      throw new Error(
        `GET ${entryUrl}: expected JavaScript, got ${entryRes.headers.get("content-type")}`
      );
    }
    console.info(`✅ GET ${entryUrl} serves the JS bundle`);

    // Expo 58's client fetches loader data from the site root, whatever the baked baseUrl.
    const loaderRoute = "/_expo/loaders/login";
    const loaderRes = await fetchStatus(`${baseUrl}${loaderRoute}`, 200);
    expectNoStorePrivate(loaderRes, loaderRoute);
    console.info(`✅ GET ${loaderRoute} answers no-store, private`);

    const config = (await (
      await fetchStatus(`${baseUrl}${BASE_PATH}/app-config.json`, 200)
    ).json()) as {brandName?: string; providers?: string[]};
    if (config.brandName !== BRAND_NAME || config.providers?.join() !== "email") {
      throw new Error(
        `GET ${BASE_PATH}/app-config.json: expected brandName ${BRAND_NAME} and default ` +
          `providers [email], got ${JSON.stringify(config)}`
      );
    }
    console.info(`✅ GET ${BASE_PATH}/app-config.json merges overrides over the defaults`);

    const protectedRoute = `${BASE_PATH}/User/123`;
    const protectedRes = await fetchStatus(`${baseUrl}${protectedRoute}`, 302);
    const expectedLocation = `${BASE_PATH}/login?returnTo=%2FUser%2F123`;
    if (protectedRes.headers.get("location") !== expectedLocation) {
      throw new Error(
        `GET ${protectedRoute}: expected a redirect to ${expectedLocation}, got ` +
          `${protectedRes.headers.get("location")}`
      );
    }
    console.info(`✅ GET ${protectedRoute} redirects an anonymous visitor to login`);
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
