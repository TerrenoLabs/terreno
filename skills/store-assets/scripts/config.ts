// Shared config, logging, and process helpers for the store-assets scripts.
//
// Every repo-specific value (apps, ports, test accounts, brand, banner copy) lives in
// storeAssets.config.json at the repo root, or the path in STORE_ASSETS_CONFIG.

import {existsSync} from "node:fs";
import {join, resolve} from "node:path";

export interface AccountConfig {
  email: string;
  password: string;
}

export interface BannerConfig {
  headline: string;
  body: string;
  capsules?: string[];
  // Two names from storeScreenshots/android, front one first.
  screenshots: string[];
}

export interface AppConfig {
  // Directory containing the Expo app (app.json, eas.json, maestro/).
  appDir: string;
  // Port the app's `expo start` uses; the screenshot run serves a production bundle on it.
  metroPort: number;
  // Device keys to capture: iphone | ipad | android.
  devices: string[];
  account: AccountConfig;
  // Simulator to boot for `devclient:*` when none is running (e.g. "iPad (A16)").
  preferredIosSimulator?: string;
  banner?: BannerConfig;
}

export interface BannerDecoration {
  // Image path relative to the repo root.
  src: string;
  // CSS declarations positioning the image, e.g. "width:72px;right:24px;top:20px".
  style: string;
}

export interface BrandConfig {
  // Feature graphic / icon surface and the color drawn on it.
  surface: string;
  onSurface: string;
  capsuleBackground: string;
  capsuleText: string;
  border: string;
  headingFont: string;
  bodyFont: string;
  // Google Fonts css2 query, e.g. "family=Merriweather:wght@700;900&family=DM+Sans:wght@400;700".
  googleFontsQuery?: string;
  // Vector logo (wordmark lockup) for the banner, recolored via logoRecolor.
  logoSvg: string;
  logoRecolor?: Record<string, string>;
  logoHeight?: number;
  // Mark used for the store icon. Either a mark-only SVG, or a logo SVG plus the number of
  // leading <path> elements that form the mark and their viewBox.
  iconSvg: string;
  iconPathCount?: number;
  iconViewBox?: string;
  // Colors in the icon SVG to replace with onSurface (e.g. ["black"]).
  iconRecolor?: string[];
  bannerDecorations?: BannerDecoration[];
}

export interface ApiProbe {
  method: "GET" | "POST";
  path: string;
  body?: string;
}

export interface ApiConfig {
  port: number;
  // A route only this backend serves, so another project's server on the same port is
  // detected. Any status other than 404 or a connection error counts as "ours".
  probe: ApiProbe;
  // Shown when the backend is down.
  startCommand: string;
}

export interface DevClientProfiles {
  ios: string;
  android: string;
}

export interface StoreAssetsConfig {
  api: ApiConfig;
  apps: Record<string, AppConfig>;
  brand?: BrandConfig;
  devClientProfiles?: DevClientProfiles;
  homeScreenTestId?: string;
}

export interface ExpoInfo {
  androidPackage: string;
  bundleId: string;
  owner: string;
  slug: string;
}

export const REPO_ROOT = resolve(process.env.STORE_ASSETS_ROOT ?? process.cwd());

// `devclient:ensure` exit codes the screenshot run reacts to.
export const EXIT_BUILD_PENDING = 3;
export const EXIT_BUILD_NEEDED = 4;

// Identifiers interpolated into adb shell strings; reject anything a shell could interpret.
const SAFE_IDENTIFIER = /^[A-Za-z0-9._-]+$/;

export const say = ({tag, message}: {tag: string; message: string}): void => {
  console.info(`\x1b[1;36m[${tag}]\x1b[0m ${message}`);
};

export const warn = ({tag, message}: {tag: string; message: string}): void => {
  console.warn(`\x1b[1;33m[${tag}]\x1b[0m ${message}`);
};

export const fail = ({tag, message}: {tag: string; message: string}): never => {
  console.error(`\x1b[1;31m[${tag}]\x1b[0m ${message}`);
  process.exit(1);
};

export const loadConfig = async ({tag}: {tag: string}): Promise<StoreAssetsConfig> => {
  const path = resolve(REPO_ROOT, process.env.STORE_ASSETS_CONFIG ?? "storeAssets.config.json");
  if (!existsSync(path)) {
    return fail({
      message: `Missing ${path}. See the store-assets skill for the config format.`,
      tag,
    });
  }
  const config = (await Bun.file(path).json()) as Partial<StoreAssetsConfig>;
  if (!config.api?.port || !config.api.probe?.path) {
    return fail({message: `${path} needs api.port and api.probe.path`, tag});
  }
  if (!config.apps || Object.keys(config.apps).length === 0) {
    return fail({message: `${path} needs at least one entry in apps`, tag});
  }
  for (const [key, app] of Object.entries(config.apps)) {
    if (!app.appDir || !app.metroPort || !app.devices?.length || !app.account?.email) {
      return fail({message: `apps.${key} needs appDir, metroPort, devices, and account`, tag});
    }
  }
  return config as StoreAssetsConfig;
};

export const getApp = ({
  config,
  appKey,
  tag,
}: {
  config: StoreAssetsConfig;
  appKey?: string;
  tag: string;
}): AppConfig => {
  const app = appKey ? config.apps[appKey] : undefined;
  if (!app) {
    return fail({
      message: `Unknown app "${appKey ?? ""}". Use one of: ${Object.keys(config.apps).join(", ")}`,
      tag,
    });
  }
  return app;
};

export const getApiPort = ({config}: {config: StoreAssetsConfig}): number =>
  Number(process.env.STORE_ASSETS_API_PORT ?? config.api.port);

export const getExpoInfo = async ({app, tag}: {app: AppConfig; tag: string}): Promise<ExpoInfo> => {
  const path = join(REPO_ROOT, app.appDir, "app.json");
  if (!existsSync(path)) {
    return fail({message: `Missing ${path}`, tag});
  }
  const {expo} = await Bun.file(path).json();
  const info = {
    androidPackage: expo?.android?.package,
    bundleId: expo?.ios?.bundleIdentifier,
    owner: expo?.owner,
    slug: expo?.slug,
  };
  const keys: Record<keyof ExpoInfo, string> = {
    androidPackage: "expo.android.package",
    bundleId: "expo.ios.bundleIdentifier",
    owner: "expo.owner",
    slug: "expo.slug",
  };
  for (const [field, key] of Object.entries(keys) as [keyof ExpoInfo, string][]) {
    if (!info[field] || !SAFE_IDENTIFIER.test(info[field])) {
      return fail({message: `${path} needs a valid ${key} (letters, digits, ".", "_", "-")`, tag});
    }
  }
  return info as ExpoInfo;
};

export const run = async ({
  cmd,
  cwd = REPO_ROOT,
  env,
  isQuiet = false,
}: {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
  isQuiet?: boolean;
}): Promise<{exitCode: number; stdout: string}> => {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: {...process.env, ...env},
    stderr: isQuiet ? "pipe" : "inherit",
    stdin: "ignore",
    stdout: isQuiet ? "pipe" : "inherit",
  });
  // Drain both pipes together so a child that fills stderr first can't deadlock.
  const [stdout, stderr] = isQuiet
    ? await Promise.all([
        new Response(proc.stdout as ReadableStream).text(),
        new Response(proc.stderr as ReadableStream).text(),
      ])
    : ["", ""];
  const exitCode = await proc.exited;
  if (exitCode !== 0 && stderr) {
    console.error(stderr);
  }
  return {exitCode, stdout};
};

export const runOrFail = async (
  args: Parameters<typeof run>[0] & {tag: string}
): Promise<string> => {
  const {exitCode, stdout} = await run(args);
  if (exitCode !== 0) {
    fail({message: `Command failed (${exitCode}): ${args.cmd.join(" ")}`, tag: args.tag});
  }
  return stdout;
};

export const isMetroRunning = async ({port}: {port: number}): Promise<boolean> => {
  return fetch(`http://localhost:${port}/status`)
    .then(async (response) => (await response.text()).includes("packager-status:running"))
    .catch(() => false);
};

export const getAndroidHome = ({tag}: {tag: string}): string => {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(process.env.HOME ?? "", "Library", "Android", "sdk"),
    "/opt/homebrew/share/android-commandlinetools",
  ];
  const androidHome = candidates.find((path) => path && existsSync(join(path, "emulator")));
  if (!androidHome) {
    return fail({message: "Android SDK emulator not found. Set ANDROID_HOME.", tag});
  }
  return androidHome;
};
