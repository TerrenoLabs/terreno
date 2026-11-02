import type {AdminSpaAppConfig} from "./appConfig";

/**
 * Key of the process global the serve plugin publishes for the server render. The Expo
 * `render.js` bundle and its loaders run in the same process as Express but are bundled
 * separately, so a process global is the one place both can read. `Symbol.for` keeps the
 * key identical across the two bundles.
 */
const ADMIN_SPA_SERVER_CONTEXT_KEY = Symbol.for("terreno.adminSpa.server");

/** What the serve plugin publishes for `render.js`, `+html.tsx`, and route loaders. */
export interface AdminSpaServerContext {
  appConfig: AdminSpaAppConfig;
  basePath: string;
}

type GlobalWithContext = typeof globalThis & {
  [ADMIN_SPA_SERVER_CONTEXT_KEY]?: AdminSpaServerContext;
};

/** Publish the server context. One admin SPA per process: a later call replaces it. */
export const publishAdminSpaServerContext = (context: AdminSpaServerContext): void => {
  (globalThis as GlobalWithContext)[ADMIN_SPA_SERVER_CONTEXT_KEY] = context;
};

/** Read the published server context, or undefined before the plugin registers. */
export const getAdminSpaServerContext = (): AdminSpaServerContext | undefined => {
  return (globalThis as GlobalWithContext)[ADMIN_SPA_SERVER_CONTEXT_KEY];
};
