/**
 * Vercel build for the example frontend: bakes the backend URL and a websocket-only socket
 * transport into the Expo manifest, then runs the static web export.
 *
 * `EXPO_PUBLIC_API_URL` alone is not enough. Expo inlines `EXPO_PUBLIC_*` only into app source,
 * and `@terreno/rtk` resolves the base URL inside `node_modules`, so a production bundle reads
 * `expoConfig.extra.BASE_URL` instead. Without it the bundle falls back to localhost.
 *
 * `SOCKET_TRANSPORTS=websocket` because Vercel Functions pin a WebSocket to one instance but
 * route socket.io's polling requests anywhere, so a polling-first handshake can fail.
 */
import {spawnSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";

interface AppJson {
  expo: {extra?: Record<string, unknown>} & Record<string, unknown>;
}

/** Returns app.json with the deployed backend URL and Vercel socket transport in `extra`. */
export const withVercelManifest = ({
  appJson,
  apiUrl,
}: {
  appJson: AppJson;
  apiUrl: string;
}): AppJson => {
  const url = new URL(apiUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error(`EXPO_PUBLIC_API_URL must be https (got ${apiUrl})`);
  }
  const baseUrl = url.origin;
  return {
    ...appJson,
    expo: {
      ...appJson.expo,
      extra: {
        ...appJson.expo.extra,
        apiBaseUrl: baseUrl,
        BASE_URL: baseUrl,
        SOCKET_TRANSPORTS: "websocket",
      },
    },
  };
};

// --clear: Metro caches the manifest, and a cached build keeps the previous BASE_URL.
const EXPO_WEB_EXPORT = ["bun", "expo", "export", "--platform", "web", "--clear"];

interface RunVercelBuildOptions {
  apiUrl: string | undefined;
  appJsonPath?: string;
  /** Command that runs the web export, from the app directory. */
  exportCommand?: string[];
}

/** Writes the Vercel manifest values into app.json, then exports. Returns the exit status. */
export const runVercelBuild = ({
  apiUrl,
  appJsonPath = resolve(import.meta.dir, "../app.json"),
  exportCommand = EXPO_WEB_EXPORT,
}: RunVercelBuildOptions): number => {
  if (!apiUrl) {
    console.error(
      "EXPO_PUBLIC_API_URL is not set. Set it on the Vercel project for this environment " +
        "(production and preview) so the bundle does not call localhost."
    );
    return 1;
  }
  const appJson = JSON.parse(readFileSync(appJsonPath, "utf8")) as AppJson;
  writeFileSync(appJsonPath, `${JSON.stringify(withVercelManifest({apiUrl, appJson}), null, 2)}\n`);
  console.info(`Building web export against ${new URL(apiUrl).origin}`);
  const [command, ...args] = exportCommand;
  const result = spawnSync(command, args, {cwd: dirname(appJsonPath), stdio: "inherit"});
  return result.status ?? 1;
};

if (import.meta.main) process.exit(runVercelBuild({apiUrl: process.env.EXPO_PUBLIC_API_URL}));
