import type {AsyncLocalStorage} from "node:async_hooks";
import type {AdminSpaAppConfig} from "./appConfig";

/**
 * Key of the process global the serve plugin publishes for the server render. The Expo
 * `render.js` bundle and its loaders run in the same process as Express but are bundled
 * separately, so a process global is the one place both can read. `Symbol.for` keeps the
 * key identical across the two bundles.
 */
const ADMIN_SPA_SERVER_CONTEXT_KEY = Symbol.for("terreno.adminSpa.server");

/** Key of the one per-request `AsyncLocalStorage`, shared by every bundle in the process. */
const ADMIN_SPA_REQUEST_STORE_KEY = Symbol.for("terreno.adminSpa.requestStore");

/** What the serve plugin publishes for `render.js`, `+html.tsx`, and route loaders. */
export interface AdminSpaServerContext {
  appConfig: AdminSpaAppConfig;
  basePath: string;
  /** Origin loopback SSR fetches go to. Never built from `Host` or `X-Forwarded-*`. */
  internalOrigin: string;
  /** API path prefixes a server render may fetch; anything else is rejected. */
  ssrApiPrefixes: string[];
}

/**
 * What one request's server render may read: set by Express before the Expo handler runs,
 * visible to that request's render and loaders only.
 */
export interface AdminSpaRequestScope {
  appConfig: AdminSpaAppConfig;
  basePath: string;
  /** The Better Auth session snapshot, or null for an anonymous visitor. Set by the gate. */
  session?: AdminSpaSessionSnapshot | null;
  /** The visitor's `GET /auth/me` body, or null when anonymous. Set by the gate. */
  profile?: unknown;
  /** The `GET {adminApiBasePath}/config` body for an admin, else null. Set by the gate. */
  adminConfig?: unknown;
  /** Status of the admin config read (200 admin, 403 forbidden), or null when not read. */
  adminConfigStatus?: number | null;
}

/** The Better Auth session as the client's session source reads it. */
export interface AdminSpaSessionSnapshot {
  userId: string;
  user: unknown;
}

type GlobalWithContext = typeof globalThis & {
  [ADMIN_SPA_SERVER_CONTEXT_KEY]?: AdminSpaServerContext;
  [ADMIN_SPA_REQUEST_STORE_KEY]?: AsyncLocalStorage<AdminSpaRequestScope>;
};

/** Publish the server context. One admin SPA per process: a later call replaces it. */
export const publishAdminSpaServerContext = (context: AdminSpaServerContext): void => {
  (globalThis as GlobalWithContext)[ADMIN_SPA_SERVER_CONTEXT_KEY] = context;
};

/** Read the published server context, or undefined before the plugin registers. */
export const getAdminSpaServerContext = (): AdminSpaServerContext | undefined => {
  return (globalThis as GlobalWithContext)[ADMIN_SPA_SERVER_CONTEXT_KEY];
};

/**
 * True while rendering on the server: there is no browser `window`, and the serve plugin has
 * published its context in this process. A server render reads what it was given and never
 * starts watchers, sockets or requests of its own.
 */
export const isAdminSpaServerRender = (): boolean => {
  return !("window" in globalThis) && getAdminSpaServerContext() !== undefined;
};

/**
 * The process-wide request store, created on first use. `process.getBuiltinModule` keeps
 * `node:async_hooks` out of the static import graph, because this module is also bundled for
 * the browser, where there is no request store.
 */
const requestStore = (): AsyncLocalStorage<AdminSpaRequestScope> => {
  const global = globalThis as GlobalWithContext;
  const existing = global[ADMIN_SPA_REQUEST_STORE_KEY];
  if (existing) {
    return existing;
  }
  const asyncHooks = process.getBuiltinModule(
    "node:async_hooks"
  ) as typeof import("node:async_hooks");
  const store = new asyncHooks.AsyncLocalStorage<AdminSpaRequestScope>();
  global[ADMIN_SPA_REQUEST_STORE_KEY] = store;
  return store;
};

/** Run `fn` with `scope` as the current request scope (server only). */
export const runInAdminSpaRequest = <T>(scope: AdminSpaRequestScope, fn: () => T): T => {
  return requestStore().run(scope, fn);
};

/** The current request's scope, or undefined outside a request (and always in the browser). */
export const getAdminSpaRequest = (): AdminSpaRequestScope | undefined => {
  return (globalThis as GlobalWithContext)[ADMIN_SPA_REQUEST_STORE_KEY]?.getStore();
};

/**
 * Serialize a value for embedding in HTML (an inline `<script>` or a JSON script blob): JSON
 * with every character that could close the script or break a JS string literal escaped.
 */
export const serializeForHtml = (value: unknown): string => {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
};
