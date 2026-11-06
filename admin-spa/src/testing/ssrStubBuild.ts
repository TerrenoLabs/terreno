import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STUB_ASSET_CONTENT = "CONTENT";
export const STUB_ASSET_PATH = "/_expo/static/js/web/foo.abc123.js";

export interface StubSsrBuildOptions {
  /** URL prefix baked into routes.json asset URLs, like Expo's `experiments.baseUrl`. */
  bakedBaseUrl?: string;
  /** Skip writing `server/`, like a deploy that lost the export's server half. */
  omitServer?: boolean;
  /**
   * List a dynamic `/[model]` route (no loader) before `/login` in routes.json, the order
   * Expo 58 actually exports, where its regex also matches `/login`.
   */
  dynamicRouteFirst?: boolean;
  /**
   * Extra HTML routes, each with a CommonJS loader body (`exports.loader = ...`). `path` is
   * the in-app path (e.g. "/phi"); its loader file is named after it.
   */
  extraRoutes?: Array<{path: string; loaderSource: string}>;
  /**
   * Absolute paths of the T2 server modules. When set, render.js (a) emits the loader data
   * through `serializeForHtml` in a JSON script blob and (b) prints the request scope
   * (`getAdminSpaRequest()`) in a `data-scope` attribute, so tests can prove both from HTML.
   */
  ssrModules?: {serverContext: string; loadSsrPayload: string};
}

/** Loader file name for an in-app path such as "/phi". */
const loaderNameOf = (routePath: string): string =>
  routePath.replace(/^\//, "").replace(/\//g, "_");

/**
 * Writes a stand-in for an `expo export` (`web.output: "server"`) into a temp directory:
 * `client/` (static files) and `server/` (routes.json, render.js, one loader), in the exact
 * shape expo-server 58's node environment loads. Returns the export root (the `distDir`).
 * The real ~4 minute build is exercised by the browser specs, not by unit tests.
 *
 * render.js and the loader read the process global `Symbol.for("terreno.adminSpa.server")`
 * that the serve plugin publishes, so a test can prove what the plugin published.
 */
export const writeStubSsrBuild = (options: StubSsrBuildOptions = {}): string => {
  const baked = options.bakedBaseUrl ?? "/console";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admin-spa-ssr-dist-"));

  const jsDir = path.join(root, "client", "_expo", "static", "js", "web");
  fs.mkdirSync(jsDir, {recursive: true});
  fs.writeFileSync(path.join(jsDir, "foo.abc123.js"), STUB_ASSET_CONTENT);
  fs.mkdirSync(path.join(root, "client", "assets"), {recursive: true});
  fs.writeFileSync(path.join(root, "client", "assets", "logo.png"), STUB_ASSET_CONTENT);

  if (options.omitServer) {
    return root;
  }

  const serverExpo = path.join(root, "server", "_expo");
  fs.mkdirSync(path.join(serverExpo, "server"), {recursive: true});
  fs.mkdirSync(path.join(serverExpo, "loaders"), {recursive: true});

  const routes = {
    apiRoutes: [],
    assets: {css: [], js: [`${baked}/_expo/static/js/web/entry-abc123.js`]},
    htmlRoutes: [
      ...(options.extraRoutes ?? []).map((route) => ({
        file: `${loaderNameOf(route.path)}.js`,
        loader: `_expo/loaders/${loaderNameOf(route.path)}.js`,
        namedRegex: `^${route.path}(?:/)?$`,
        page: route.path,
        routeKeys: {},
      })),
      ...(options.dynamicRouteFirst
        ? [
            {
              file: "[model]/index.js",
              namedRegex: "^/(?<model>[^/]+?)(?:/)?$",
              page: "/[model]/index",
              routeKeys: {model: "model"},
            },
          ]
        : []),
      {
        file: "login.js",
        loader: "_expo/loaders/login.js",
        namedRegex: "^/login(?:/)?$",
        page: "/login",
        routeKeys: {},
      },
    ],
    notFoundRoutes: [],
    // Expo 58 exports this rule for every loader response, as the real routes.json does.
    pageHeaders: [{headers: {"Cache-Control": "no-store"}, namedRegex: "^/_expo/loaders/.+$"}],
    redirects: [],
    rendering: {file: "_expo/server/render.js", mode: "ssr"},
    rewrites: [],
  };
  fs.writeFileSync(path.join(serverExpo, "routes.json"), JSON.stringify(routes));

  const mods = options.ssrModules;
  const modsPrelude = mods
    ? `const ctxMod = require(${JSON.stringify(mods.serverContext)});
const ssrMod = require(${JSON.stringify(mods.loadSsrPayload)});
`
    : "";
  const modsHtml = mods
    ? `+ "<i data-scope=" + JSON.stringify(JSON.stringify(ctxMod.getAdminSpaRequest() ?? null)) + "></i>" +
    '<script type="application/json" id="loader-blob">' + ctxMod.serializeForHtml(options.loader ? options.loader.data : null) + "</script>"`
    : "";
  fs.writeFileSync(
    path.join(serverExpo, "server", "render.js"),
    `${modsPrelude}const read = () => globalThis[Symbol.for("terreno.adminSpa.server")];
exports.getStaticContent = async (_location, options) => {
  const published = read();
  const brand = published ? published.appConfig.brandName : "UNPUBLISHED";
  return "<!DOCTYPE html><html><head><script>window.__ADMIN_SPA_BASE__=" +
    JSON.stringify(published ? published.basePath : "") + ";</script></head><body>" +
    "<h1>" + brand + "</h1>" +
    '<input data-testid="admin-spa-login-email" />' +
    ${mods ? '""' : '"<script data-loader=" + JSON.stringify(JSON.stringify(options.loader ? options.loader.data : null)) + "></script>"'} ${modsHtml} +
    "</body></html>";
};
`
  );
  fs.writeFileSync(
    path.join(serverExpo, "loaders", "login.js"),
    `exports.loader = () => ({appConfig: globalThis[Symbol.for("terreno.adminSpa.server")].appConfig});\n`
  );
  for (const route of options.extraRoutes ?? []) {
    fs.writeFileSync(
      path.join(serverExpo, "loaders", `${loaderNameOf(route.path)}.js`),
      `const LOAD_SSR_PAYLOAD = ${JSON.stringify(mods?.loadSsrPayload ?? "")};\n${route.loaderSource}\n`
    );
  }
  return root;
};

export const removeStubSsrBuild = (root: string): void => {
  fs.rmSync(root, {force: true, recursive: true});
};
