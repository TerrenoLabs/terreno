import {installTerrenoDevConsoleLogger as installSyncDbDevConsoleLogger} from "@terreno/syncdb/devConsoleLogger";

import {baseUrl} from "./constants";

/**
 * Batches dev console errors to the backend's `POST /__terreno/browser-logs` route,
 * defaulting the target to this package's resolved `baseUrl`.
 *
 * @deprecated Moved to `@terreno/syncdb`. Use
 * `import {installTerrenoDevConsoleLogger} from "@terreno/syncdb"` and call it with
 * `{baseUrl}`. This re-export stays for the `@terreno/rtk` deprecation window only.
 */
export const installTerrenoDevConsoleLogger = (args?: {baseUrl?: string}): void => {
  installSyncDbDevConsoleLogger({baseUrl: args?.baseUrl ?? baseUrl});
};
