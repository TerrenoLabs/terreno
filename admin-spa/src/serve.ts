import path from "node:path";
import type {TerrenoPlugin} from "@terreno/api";
import {logger} from "@terreno/api";
import {createRequestHandler, type RequestHandlerParams} from "expo-server/adapter/express";
import express from "express";
import {type AdminSpaAppConfig, resolveAppConfig} from "./appConfig";
import {bakedBaseUrlOf, prepareRoutesManifest, readRoutesManifest} from "./routesManifest";
import {
  getAdminSpaRequest,
  publishAdminSpaServerContext,
  runInAdminSpaRequest,
} from "./serverContext";

// Compiled (CommonJS) file lives at src/dist/serve.js; the export root (`client/` +
// `server/`) lives at admin-spa/dist. `__dirname` is the CommonJS module-directory global.
const DIST_DIR = path.resolve(__dirname, "../../dist");

const NO_STORE = "no-store";

/** Server-rendered pages and loader data can hold PHI: never cached, never shared. */
const NO_STORE_PRIVATE = "no-store, private";

/** API prefixes a server render may fetch, besides the admin API base path. */
const DEFAULT_SSR_API_PREFIXES = [
  "/auth/me",
  "/orgs",
  "/jobs",
  "/comms",
  "/configuration",
  "/rbac",
];

/** Where Expo's client fetches route loader data: the site root, whatever the baseUrl. */
const ROOT_LOADERS_PATH = "/_expo/loaders";

export interface AdminSpaServeOptions {
  /** Path the SPA is mounted at. Default: "/console". Non-breaking with the AdminApp `/admin` API. */
  basePath?: string;
  /** Runtime config served at `${basePath}/app-config.json`. Merged with defaults. */
  appConfig?: Partial<AdminSpaAppConfig>;
  /**
   * Override the export root the bundle is served from: it holds `client/` (static files)
   * and `server/` (the Expo server build). Used by tests, custom builds, and compiled binaries.
   */
  distDir?: string;
  /**
   * In dev, proxy all SPA paths to a running `expo start --web` server, e.g.
   * "http://localhost:8083". Avoids re-running `expo export` per change.
   */
  devProxyTarget?: string;
  /**
   * Origin the server render fetches API data from, with the visitor's cookie. Default:
   * `http://127.0.0.1:${PORT ?? 4000}`, this process. Never derived from `Host` or
   * `X-Forwarded-*`, so a request cannot point the render at another host.
   */
  internalOrigin?: string;
  /**
   * API path prefixes a server render may fetch. Default: the admin API base path plus
   * `/auth/me`, `/orgs`, `/jobs`, `/comms`, `/configuration`, and `/rbac`.
   */
  ssrApiPrefixes?: string[];
}

/**
 * @deprecated The server-rendered build no longer serves a static index.html. Kept for
 * consumers of the static-export API; it will be removed in the next major release.
 *
 * Rewrite the absolute `/_expo/` and `/assets/` references emitted by Expo's static
 * web export so a single pre-built bundle works when mounted at any `basePath`.
 */
export const rewriteIndexHtml = (rawIndex: string, basePath: string): string => {
  return rawIndex
    .replaceAll('href="/_expo/', `href="${basePath}/_expo/`)
    .replaceAll('src="/_expo/', `src="${basePath}/_expo/`)
    .replaceAll('href="/assets/', `href="${basePath}/assets/`)
    .replaceAll('src="/assets/', `src="${basePath}/assets/`);
};

/**
 * @deprecated `+html.tsx` now writes `window.__ADMIN_SPA_BASE__` into the server-rendered
 * page. Kept for consumers of the static-export API; it will be removed in the next major.
 *
 * Inject `window.__ADMIN_SPA_BASE__` so the SPA can build absolute URLs (e.g.
 * `${base}/app-config.json`) regardless of the current deep route. Inserted before
 * `</head>` so it runs before the bundle.
 */
export const injectBaseGlobal = (html: string, basePath: string): string => {
  const script = `<script>window.__ADMIN_SPA_BASE__=${JSON.stringify(basePath)};</script>`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${script}</head>`);
  }
  return script + html;
};

/**
 * Opt-in Express plugin that server-renders the pre-built admin SPA (Expo Router
 * `web.output: "server"` export) from the same Node process as a Terreno backend. Mounts at
 * `/console` by default; `basePath` must equal the baseUrl the bundle was built with.
 *
 * @example
 * ```typescript
 * new TerrenoApp({userModel: User})
 *   .register(new BetterAuthApp({config, userModel: User}))
 *   .register(new AdminApp({models: [...]}))
 *   .register(new AdminSpaServeApp({basePath: "/console", appConfig: {brandName: "Acme"}}))
 *   .start();
 * ```
 */
export class AdminSpaServeApp implements TerrenoPlugin {
  constructor(private readonly opts: AdminSpaServeOptions = {}) {}

  register(app: express.Application): void {
    const basePath = this.opts.basePath ?? "/console";
    const distDir = this.opts.distDir ?? DIST_DIR;
    const appConfig = resolveAppConfig(this.opts.appConfig);

    // Dev proxy: forward SPA assets to `expo start --web`, but keep app-config on the plugin.
    if (this.opts.devProxyTarget) {
      // Register before the catch-all proxy so Express matches this route first.
      app.get(`${basePath}/app-config.json`, (_req, res) => {
        res.set("Cache-Control", NO_STORE).json(appConfig);
      });
      // Lazy require so production deploys without the dev dependency don't break.
      // Module types are not available at runtime for this optional dev-only dependency.
      const {createProxyMiddleware} = require("http-proxy-middleware") as {
        createProxyMiddleware: (options: {
          changeOrigin: boolean;
          pathRewrite: Record<string, string>;
          target: string;
          ws: boolean;
        }) => express.RequestHandler;
      };
      app.use(
        basePath,
        createProxyMiddleware({
          changeOrigin: true,
          pathRewrite: {[`^${basePath}`]: ""},
          target: this.opts.devProxyTarget,
          ws: true,
        })
      );
      logger.info(`Admin SPA dev-proxied to ${this.opts.devProxyTarget} at ${basePath}/`);
      return;
    }

    publishAdminSpaServerContext({
      appConfig,
      basePath,
      internalOrigin: this.opts.internalOrigin ?? `http://127.0.0.1:${process.env.PORT ?? 4000}`,
      ssrApiPrefixes: this.opts.ssrApiPrefixes ?? [
        appConfig.adminApiBasePath ?? "/admin",
        ...DEFAULT_SSR_API_PREFIXES,
      ],
    });

    // 1. Hashed client asset directories: long cache, immutable.
    const clientDir = path.join(distDir, "client");
    const staticOpts = {immutable: true, maxAge: "365d"};
    app.use(`${basePath}/_expo`, express.static(path.join(clientDir, "_expo"), staticOpts));
    app.use(`${basePath}/assets`, express.static(path.join(clientDir, "assets"), staticOpts));

    // 2. Runtime config, never cached.
    app.get(`${basePath}/app-config.json`, (_req, res) => {
      res.set("Cache-Control", NO_STORE).json(appConfig);
    });

    // 3. Server render. Without a server build, answer 503 instead of crashing the backend.
    const serverDir = path.join(distDir, "server");
    const rawManifest = readRoutesManifest(serverDir);
    if (!rawManifest) {
      logger.warn(
        `Admin SPA: no server build found at ${serverDir}. ` +
          "Run `bun run --filter '@terreno/admin-spa' build:web` or set devProxyTarget."
      );
      const unavailable = (_req: express.Request, res: express.Response): void => {
        res.status(503).set("Cache-Control", NO_STORE).type("text").send("Admin SPA unavailable");
      };
      app.get(basePath, unavailable);
      app.get(`${basePath}/*splat`, unavailable);
      return;
    }
    const bakedBaseUrl = bakedBaseUrlOf(rawManifest);
    if (bakedBaseUrl !== basePath) {
      throw new Error(
        `Admin SPA basePath "${basePath}" does not match the bundle's baseUrl "${bakedBaseUrl}"`
      );
    }

    // Hand expo-server the manifest with HTML routes in match-priority order (see
    // prepareRoutesManifest); it would otherwise read routes.json as exported.
    type ExpoManifest = Awaited<ReturnType<NonNullable<RequestHandlerParams["getRoutesManifest"]>>>;
    const manifest = prepareRoutesManifest(rawManifest, {
      pageCacheControl: NO_STORE_PRIVATE,
    }) as unknown as ExpoManifest;
    const handler = createRequestHandler(
      {build: serverDir},
      {getRoutesManifest: async (): Promise<ExpoManifest> => manifest}
    );
    // Every server render runs in a request scope, so a render reads only its own request's
    // data. Middleware that set a richer scope earlier (the auth gate) keeps it.
    const noStorePrivate: express.RequestHandler = (_req, res, next) => {
      res.set("Cache-Control", NO_STORE_PRIVATE);
      if (getAdminSpaRequest()) {
        next();
        return;
      }
      runInAdminSpaRequest({appConfig, basePath}, next);
    };
    // A failed render or loader logs the route path and the error only: never the query string
    // or response data, which can hold PHI.
    const renderError: express.ErrorRequestHandler = (error, req, res, _next) => {
      logger.error(`Admin SPA render failed for ${req.path}`, {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
      });
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(500).set("Cache-Control", NO_STORE_PRIVATE).type("text").send("Admin SPA error");
    };
    app.use(basePath, noStorePrivate, handler, renderError);
    // Expo 58's client fetches loader data from the site root, ignoring the baked baseUrl,
    // so the root loader path reaches the same handler (D11 in the SSR plan).
    const rootLoaders: express.RequestHandler = (req, res, next) => {
      req.url = `${ROOT_LOADERS_PATH}${req.url}`;
      return handler(req, res, next);
    };
    app.use(ROOT_LOADERS_PATH, noStorePrivate, rootLoaders, renderError);

    logger.info(`Admin SPA mounted at ${basePath}/`);
  }
}
