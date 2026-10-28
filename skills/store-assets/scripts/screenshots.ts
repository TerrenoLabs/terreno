#!/usr/bin/env bun
//
// Capture App Store / Play Store screenshots by running each app's Maestro screenshot flow on
// store-sized simulators and emulators.
//
// Usage:
//   bun run screenshots:setup
//   bun run screenshots:devices <app> [--device iphone|ipad|android] [--build]
//   bun run screenshots <app> [--device iphone|ipad|android] [--build] [--keep-metro]
//   bun run screenshots:capture <app> <iphone|ipad|android> <name>
//
// Apps come from storeAssets.config.json. Final shots: <appDir>/storeScreenshots/<device>/*.png.
// Maestro artifacts and Metro logs: .storeAssets/<app>/ (git-ignored). Without --build, a device
// whose dev client needs a new EAS build is skipped instead of spending Expo credits.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {homedir} from "node:os";
import {basename, join} from "node:path";
import {
  type AppConfig,
  EXIT_BUILD_NEEDED,
  EXIT_BUILD_PENDING,
  type ExpoInfo,
  fail as failTagged,
  getApiPort,
  getApp,
  getExpoInfo,
  isMetroRunning,
  loadConfig,
  REPO_ROOT,
  run,
  runOrFail as runOrFailTagged,
  type StoreAssetsConfig,
  say as sayTagged,
  warn as warnTagged,
} from "./config";
import {
  bootEmulator,
  bootIosSimulator,
  findEmulatorSerial,
  launchDevClientIntoMetro,
  listIosRuntimes,
  listIosSimulators,
  reversePorts,
} from "./devices";

const TAG = "screenshots";
const WORK_ROOT = join(REPO_ROOT, ".storeAssets");
const MAESTRO_HOME = join(homedir(), ".maestro");
const MAESTRO_BIN = join(MAESTRO_HOME, "maestro", "bin", "maestro");
// Pinned and checksum-verified; bump both together after testing a new release.
const MAESTRO_VERSION = "2.11.0";
const MAESTRO_ZIP_URL = `https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip`;
const MAESTRO_ZIP_SHA256 = "5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a";
// First run on a fresh emulator installs Maestro's driver APKs, which takes over a minute.
const MAESTRO_DRIVER_STARTUP_TIMEOUT_MS = 180_000;
const METRO_START_SECONDS = 90;
const NOTIFICATION_SNOOZE_MS = 86_400_000;
const EXIT_SIGTERM = 143;
const EXIT_SIGINT = 130;
const JAVA_HOME_CANDIDATES = [
  process.env.JAVA_HOME,
  "/opt/homebrew/opt/openjdk@17",
  "/opt/homebrew/opt/openjdk",
  "/usr/local/opt/openjdk@17",
];

const say = (message: string): void => sayTagged({message, tag: TAG});
const warn = (message: string): void => warnTagged({message, tag: TAG});
const fail = (message: string): never => failTagged({message, tag: TAG});
const runOrFail = (args: Omit<Parameters<typeof runOrFailTagged>[0], "tag">): Promise<string> =>
  runOrFailTagged({...args, tag: TAG});

interface AndroidScreenSize {
  width: number;
  height: number;
  density: number;
}

interface IosDeviceSpec {
  label: string;
  platform: "ios";
  name: string;
  deviceType: string;
  // Accepted App Store sizes (portrait).
  storeSizes: [number, number][];
}

interface AndroidDeviceSpec {
  label: string;
  platform: "android";
  // AVD name.
  name: string;
  size: AndroidScreenSize;
}

type DeviceSpec = IosDeviceSpec | AndroidDeviceSpec;

// App Store Connect "6.5-inch" accepts 1284x2778 and 1242x2688; "13-inch iPad" accepts
// 2048x2732 and 2064x2752. Play rejects screenshots longer than 2:1, so the Android phone is a
// 16:9 1080x1920 AVD rather than a modern 20:9 Pixel.
const DEVICES: Record<string, DeviceSpec> = {
  android: {
    label: "Android phone 1080x1920",
    name: "Store_Screenshots_Phone",
    platform: "android",
    size: {density: 420, height: 1920, width: 1080},
  },
  ipad: {
    deviceType: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-12-9-inch-6th-generation-8GB",
    label: "13-inch iPad",
    name: "Store Screenshots iPad 13",
    platform: "ios",
    storeSizes: [
      [2048, 2732],
      [2064, 2752],
    ],
  },
  iphone: {
    deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-14-Plus",
    label: "6.5-inch iPhone",
    name: "Store Screenshots iPhone 6.5",
    platform: "ios",
    storeSizes: [
      [1284, 2778],
      [1242, 2688],
    ],
  },
};

interface Context {
  apiPort: number;
  apiUrl: string;
  app: AppConfig;
  appKey: string;
  config: StoreAssetsConfig;
  expo: ExpoInfo;
}

interface Options {
  device?: string;
  isBuild: boolean;
  isKeepMetro: boolean;
}

interface BootedDevice {
  // simctl UDID or adb serial
  id: string;
  key: string;
  spec: DeviceSpec;
}

const getJavaHome = (): string | undefined => {
  return JAVA_HOME_CANDIDATES.find((path) => path && existsSync(join(path, "bin", "java")));
};

const getMaestroEnv = (): Record<string, string> => {
  const javaHome = getJavaHome();
  if (!javaHome) {
    return fail("Java not found. Run: brew install openjdk@17");
  }
  return {
    JAVA_HOME: javaHome,
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
    MAESTRO_CLI_NO_ANALYTICS: "1",
    MAESTRO_DRIVER_STARTUP_TIMEOUT: String(MAESTRO_DRIVER_STARTUP_TIMEOUT_MS),
    PATH: `${join(javaHome, "bin")}:${process.env.PATH}`,
  };
};

const commandSetup = async (): Promise<void> => {
  if (!getJavaHome()) {
    fail("Java not found. Run: brew install openjdk@17");
  }
  if (!existsSync(MAESTRO_BIN)) {
    // The release zip avoids Homebrew, which refuses tap formulae when Command Line Tools are stale.
    say(`Installing Maestro ${MAESTRO_VERSION} into ${MAESTRO_HOME}`);
    mkdirSync(MAESTRO_HOME, {recursive: true});
    const zipPath = join(MAESTRO_HOME, "maestro.zip");
    await runOrFail({cmd: ["curl", "-fsSL", "-o", zipPath, MAESTRO_ZIP_URL]});
    const digest = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(zipPath).arrayBuffer())
      .digest("hex");
    if (digest !== MAESTRO_ZIP_SHA256) {
      rmSync(zipPath);
      fail(`Maestro download checksum mismatch (got ${digest}); refusing to install`);
    }
    await runOrFail({cmd: ["unzip", "-qo", zipPath, "-d", MAESTRO_HOME]});
    rmSync(zipPath);
  }
  const output = await runOrFail({
    cmd: [MAESTRO_BIN, "--version"],
    env: getMaestroEnv(),
    isQuiet: true,
  });
  const version = output.trim().split("\n").pop() ?? "";
  if (version !== MAESTRO_VERSION) {
    warn(`Maestro ${version} is installed; flows are tested with ${MAESTRO_VERSION}`);
  }
  say(`Maestro ${version} ready`);
};

// --- iOS simulators ---

const applyIosStatusBar = async ({udid}: {udid: string}): Promise<void> => {
  // prettier-ignore
  const overrides = [
    "--time",
    "9:41",
    "--dataNetwork",
    "wifi",
    "--wifiMode",
    "active",
    "--wifiBars",
    "3",
    "--cellularMode",
    "active",
    "--cellularBars",
    "4",
    "--batteryState",
    "discharging",
    "--batteryLevel",
    "100",
  ];
  await runOrFail({
    cmd: ["xcrun", "simctl", "status_bar", udid, "override", ...overrides],
    isQuiet: true,
  });
};

const ensureSimulator = async ({spec}: {spec: IosDeviceSpec}): Promise<string> => {
  const simulators = await listIosSimulators({filter: "available", tag: TAG});
  let udid = simulators.find((sim) => sim.name === spec.name)?.udid;
  if (!udid) {
    const [runtime] = await listIosRuntimes({tag: TAG});
    if (!runtime) {
      return fail("No iOS simulator runtime installed");
    }
    say(`Creating simulator "${spec.name}" on ${runtime}`);
    udid = (
      await runOrFail({
        cmd: ["xcrun", "simctl", "create", spec.name, spec.deviceType, runtime],
        isQuiet: true,
      })
    ).trim();
  }
  await bootIosSimulator({tag: TAG, udid});
  await applyIosStatusBar({udid});
  return udid;
};

// --- Android emulators ---

const getAvdHome = (): string => process.env.ANDROID_AVD_HOME ?? join(homedir(), ".android", "avd");

// Creates the screenshot AVD by cloning an existing AVD's system image settings, so the script
// doesn't need avdmanager.
const ensureAvd = ({spec}: {spec: AndroidDeviceSpec}): void => {
  const avdHome = getAvdHome();
  const avdDir = join(avdHome, `${spec.name}.avd`);
  if (existsSync(join(avdDir, "config.ini"))) {
    return;
  }
  const template = existsSync(avdHome)
    ? readdirSync(avdHome)
        .filter((name) => name.endsWith(".avd") && name !== `${spec.name}.avd`)
        .map((name) => join(avdHome, name, "config.ini"))
        .find((path) => existsSync(path))
    : undefined;
  if (!template) {
    fail("No existing Android AVD to clone. Create any phone AVD in Android Studio first.");
    return;
  }
  const {width, height, density} = spec.size;
  const overrides: Record<string, string> = {
    AvdId: spec.name,
    "avd.ini.displayname": spec.name.replaceAll("_", " "),
    "hw.device.name": "pixel_2",
    "hw.keyboard": "yes",
    "hw.lcd.density": String(density),
    "hw.lcd.height": String(height),
    "hw.lcd.width": String(width),
    // The Play Store system images crawl at the 2 GB many templates default to.
    "hw.ramSize": "4096",
    "skin.dynamic": "no",
    "skin.name": `${width}x${height}`,
  };
  const templateText = readFileSync(template, "utf8");
  const lines = templateText
    .split("\n")
    .filter((line) => line && !line.startsWith("skin.path"))
    .filter((line) => !((line.split("=")[0] ?? "").trim() in overrides));
  const config = [
    ...lines,
    ...Object.entries(overrides).map(([key, value]) => `${key}=${value}`),
  ].join("\n");
  const target = templateText.match(/image\.sysdir\.1=system-images\/([^/]+)/)?.[1];

  say(`Creating AVD ${spec.name} (${width}x${height}) from ${template}`);
  mkdirSync(avdDir, {recursive: true});
  writeFileSync(join(avdDir, "config.ini"), `${config}\n`);
  writeFileSync(
    join(avdHome, `${spec.name}.ini`),
    `avd.ini.encoding=UTF-8\npath=${avdDir}\npath.rel=avd/${spec.name}.avd\ntarget=${target ?? "android"}\n`
  );
};

const adbShell = async ({serial, args}: {serial: string; args: string[]}): Promise<void> => {
  await run({cmd: ["adb", "-s", serial, "shell", ...args], isQuiet: true});
};

// Turns off autofill (it covers login forms) and sets a clean demo-mode status bar.
const applyAndroidStatusBar = async ({serial}: {serial: string}): Promise<void> => {
  await adbShell({args: ["settings", "put", "secure", "autofill_service", "null"], serial});
  // Hidden for good on this dedicated AVD. Demo mode's `mobile` command draws a second Wi-Fi icon
  // on recent Android, so the mobile slot is blocklisted instead.
  await adbShell({
    args: ["settings", "put", "secure", "icon_blacklist", "mobile,rotate,location"],
    serial,
  });
  await adbShell({args: ["settings", "put", "global", "sysui_demo_allowed", "1"], serial});
  const demo = ({extra}: {extra: string[]}): Promise<void> =>
    adbShell({args: ["am", "broadcast", "-a", "com.android.systemui.demo", ...extra], serial});
  // Re-enter so state from a previous run doesn't linger.
  await demo({extra: ["-e", "command", "exit"]});
  await demo({extra: ["-e", "command", "enter"]});
  await demo({extra: ["-e", "command", "clock", "-e", "hhmm", "0941"]});
  await demo({extra: ["-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false"]});
  await demo({
    extra: [
      "-e",
      "command",
      "network",
      "-e",
      "wifi",
      "show",
      "-e",
      "level",
      "4",
      "-e",
      "fully",
      "true",
    ],
  });
  await demo({extra: ["-e", "command", "notifications", "-e", "visible", "false"]});

  // Demo mode no longer hides notification icons (e.g. Safety Center's "Set a screen lock").
  const {stdout} = await run({
    cmd: ["adb", "-s", serial, "shell", "cmd", "notification", "list"],
    isQuiet: true,
  });
  const keys = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[\w|=.:+/-]+$/.test(line));
  for (const key of keys) {
    await adbShell({
      args: ["cmd", "notification", "snooze", "--for", String(NOTIFICATION_SNOOZE_MS), `'${key}'`],
      serial,
    });
  }
};

const ensureEmulator = async ({
  spec,
  context,
}: {
  spec: AndroidDeviceSpec;
  context: Context;
}): Promise<string> => {
  ensureAvd({spec});
  if (!(await findEmulatorSerial({avd: spec.name, tag: TAG}))) {
    say(`Starting emulator ${spec.name}`);
  }
  const serial = await bootEmulator({avd: spec.name, tag: TAG});
  await reversePorts({ports: [context.apiPort, context.app.metroPort], serial, tag: TAG});
  await applyAndroidStatusBar({serial});
  return serial;
};

const ensureDevice = async ({
  key,
  context,
}: {
  key: string;
  context: Context;
}): Promise<BootedDevice> => {
  const spec = DEVICES[key];
  if (!spec) {
    return fail(`Unknown device "${key}". Use one of: ${Object.keys(DEVICES).join(", ")}`);
  }
  const id =
    spec.platform === "ios" ? await ensureSimulator({spec}) : await ensureEmulator({context, spec});
  return {id, key, spec};
};

// --- Dev client, backend, Metro ---

// Every run logs in fresh: a session restored from an earlier run can fail its token refresh
// (e.g. after a backend restart) and leave an error overlay in the shots. The screenshot
// devices are dedicated, so wiping app data and the simulator keychain is safe; the dev client
// is reinstalled right after.
const resetAppState = async ({
  context,
  device,
}: {
  context: Context;
  device: BootedDevice;
}): Promise<void> => {
  if (device.spec.platform === "ios") {
    await run({
      cmd: ["xcrun", "simctl", "uninstall", device.id, context.expo.bundleId],
      isQuiet: true,
    });
    await run({cmd: ["xcrun", "simctl", "keychain", device.id, "reset"], isQuiet: true});
    return;
  }
  await run({
    cmd: ["adb", "-s", device.id, "shell", "pm", "clear", context.expo.androidPackage],
    isQuiet: true,
  });
};

const ensureDevClient = async ({
  context,
  device,
  options,
}: {
  context: Context;
  device: BootedDevice;
  options: Options;
}): Promise<boolean> => {
  // devClient takes a simulator UDID on iOS and an AVD name on Android.
  const target = device.spec.platform === "ios" ? device.id : device.spec.name;
  const {exitCode} = await run({
    cmd: [
      "bun",
      join(import.meta.dir, "devClient.ts"),
      "ensure",
      context.appKey,
      device.spec.platform,
      "--device",
      target,
      ...(options.isBuild ? [] : ["--no-build"]),
    ],
  });
  if (exitCode === EXIT_BUILD_PENDING) {
    warn(
      `Dev client build for ${context.appKey} ${device.spec.platform} is still running; skipping ${device.key}`
    );
    return false;
  }
  if (exitCode === EXIT_BUILD_NEEDED) {
    warn(
      `${context.appKey} ${device.spec.platform} needs a new dev client build; skipping ${device.key} (pass --build)`
    );
    return false;
  }
  if (exitCode !== 0) {
    fail(`Could not install the ${context.appKey} dev client on ${device.key}`);
  }
  return true;
};

// Probes a route only this repo's backend serves, so another project's server on the same port
// isn't mistaken for ours.
const ensureBackend = async ({context}: {context: Context}): Promise<void> => {
  const {probe, startCommand} = context.config.api;
  const status = await fetch(`${context.apiUrl}${probe.path}`, {
    body: probe.method === "POST" ? (probe.body ?? "{}") : undefined,
    headers: {"Content-Type": "application/json"},
    method: probe.method,
  })
    .then((response) => response.status)
    .catch(() => 0);
  if (status === 0) {
    fail(
      `Backend is not reachable at ${context.apiUrl}. Start it (${startCommand}) and seed test data.`
    );
  }
  if (status === 404) {
    fail(
      `${context.apiUrl} does not serve ${probe.path}, so it is not this repo's backend. Stop the other server, ` +
        "or run this backend on another port and set STORE_ASSETS_API_PORT."
    );
  }
};

const startMetro = async ({context}: {context: Context}): Promise<(() => void) | undefined> => {
  const {app, appKey, apiUrl} = context;
  if (await isMetroRunning({port: app.metroPort})) {
    warn(
      `Reusing Metro already running on :${app.metroPort}. Dev-mode overlays may show in screenshots.`
    );
    return undefined;
  }
  const workDir = join(WORK_ROOT, appKey);
  mkdirSync(workDir, {recursive: true});
  const logPath = join(workDir, "metro.log");
  say(`Starting Metro for ${app.appDir} on :${app.metroPort} (production JS, log: ${logPath})`);
  // EXPO_PUBLIC_* values are inlined into cached transforms, so clear Metro's cache only when the
  // API URL changed; a cold production build of an app takes several minutes.
  const envMarker = join(workDir, ".metro-api-url");
  const isApiUrlChanged = !existsSync(envMarker) || readFileSync(envMarker, "utf8") !== apiUrl;
  // --no-dev --minify serves a production bundle so LogBox and dev warnings stay out of the shots.
  const proc = Bun.spawn(
    [
      "bun",
      "expo",
      "start",
      "--dev-client",
      "--port",
      String(app.metroPort),
      "--no-dev",
      "--minify",
      ...(isApiUrlChanged ? ["--clear"] : []),
    ],
    {
      cwd: join(REPO_ROOT, app.appDir),
      env: {...process.env, CI: "1", EXPO_PUBLIC_API_URL: apiUrl},
      stderr: Bun.file(logPath),
      stdin: "ignore",
      stdout: Bun.file(logPath),
    }
  );
  // fail() exits the process directly, so stop Metro from an exit hook rather than a finally.
  const stop = (): void => {
    proc.kill();
  };
  process.on("exit", stop);
  process.once("SIGINT", () => process.exit(EXIT_SIGINT));
  process.once("SIGTERM", () => process.exit(EXIT_SIGTERM));
  for (let attempt = 0; attempt < METRO_START_SECONDS; attempt++) {
    if (await isMetroRunning({port: app.metroPort})) {
      // Recorded only once Metro is up, so a failed start still clears the cache next time.
      writeFileSync(envMarker, apiUrl);
      return stop;
    }
    await Bun.sleep(1_000);
  }
  return fail(`Metro did not start; see ${logPath}`);
};

// Builds the platform bundle before the app asks for it, so a cold multi-minute Metro build
// doesn't trip Maestro's driver timeouts.
const prewarmBundle = async ({
  context,
  platform,
}: {
  context: Context;
  platform: string;
}): Promise<void> => {
  const port = context.app.metroPort;
  const manifest = await fetch(`http://localhost:${port}/`, {
    headers: {accept: "application/expo+json,application/json", "expo-platform": platform},
  })
    .then((response) => response.json())
    .catch(() => undefined);
  const bundleUrl = (manifest as {launchAsset?: {url?: string}} | undefined)?.launchAsset?.url;
  if (!bundleUrl) {
    warn("Could not read the Metro manifest; skipping bundle prewarm");
    return;
  }
  say(`Building ${platform} bundle (first build after a cache clear can take several minutes)`);
  const response = await fetch(bundleUrl.replace(/^http:\/\/[^/]+/, `http://localhost:${port}`));
  await response.arrayBuffer();
  if (!response.ok) {
    fail(
      `Metro bundle failed (HTTP ${response.status}); see ${join(WORK_ROOT, context.appKey, "metro.log")}`
    );
  }
};

// --- Capture + validation ---

const getImageSize = async ({path}: {path: string}): Promise<[number, number]> => {
  const output = await runOrFail({
    cmd: ["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
    isQuiet: true,
  });
  return [
    Number(output.match(/pixelWidth: (\d+)/)?.[1]),
    Number(output.match(/pixelHeight: (\d+)/)?.[1]),
  ];
};

const isValidStoreSize = ({
  spec,
  width,
  height,
}: {
  spec: DeviceSpec;
  width: number;
  height: number;
}): boolean => {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (spec.platform === "ios") {
    return spec.storeSizes.some(([w, h]) => w === short && h === long);
  }
  return short >= 320 && long <= 3840 && long <= short * 2;
};

const validateScreenshots = async ({
  dir,
  spec,
}: {
  dir: string;
  spec: DeviceSpec;
}): Promise<string[]> => {
  const problems: string[] = [];
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".png")) : [];
  if (files.length === 0) {
    problems.push(`No screenshots in ${dir}`);
  }
  for (const file of files.sort()) {
    const [width, height] = await getImageSize({path: join(dir, file)});
    const isValid = isValidStoreSize({height, spec, width});
    say(`${isValid ? "ok " : "BAD"} ${file} ${width}x${height}`);
    if (!isValid) {
      problems.push(`${file} is ${width}x${height}, not a valid ${spec.label} size`);
    }
  }
  return problems;
};

const getOutputDir = ({app, deviceKey}: {app: AppConfig; deviceKey: string}): string =>
  join(REPO_ROOT, app.appDir, "storeScreenshots", deviceKey);

const runFlow = async ({
  context,
  device,
}: {
  context: Context;
  device: BootedDevice;
}): Promise<string[]> => {
  const {app, appKey, config, expo} = context;
  const flow = join(REPO_ROOT, app.appDir, "maestro", "screenshots.yaml");
  if (!existsSync(flow)) {
    return [`Missing flow ${flow}`];
  }
  const outDir = getOutputDir({app, deviceKey: device.key});
  rmSync(outDir, {force: true, recursive: true});
  mkdirSync(outDir, {recursive: true});

  const flowEnv: Record<string, string> = {
    APP_ID: device.spec.platform === "ios" ? expo.bundleId : expo.androidPackage,
    DEVICE: device.key,
    EMAIL: process.env.SCREENSHOT_EMAIL ?? app.account.email,
    HOME_SCREEN_ID: config.homeScreenTestId ?? "home-screen",
    PASSWORD: process.env.SCREENSHOT_PASSWORD ?? app.account.password,
    PLATFORM: device.spec.platform,
  };
  await prewarmBundle({context, platform: device.spec.platform});
  await launchDevClientIntoMetro({
    deviceId: device.id,
    devMenu: "hideAll",
    expo,
    metroPort: app.metroPort,
    platform: device.spec.platform,
    tag: TAG,
  });
  say(`Running ${appKey} screenshot flow on ${device.spec.label} (${device.id})`);
  const maestroDir = join(WORK_ROOT, appKey, `maestro-${device.key}`);
  rmSync(maestroDir, {force: true, recursive: true});
  const {exitCode} = await run({
    cmd: [
      MAESTRO_BIN,
      "--device",
      device.id,
      "test",
      flow,
      "--test-output-dir",
      maestroDir,
      ...Object.entries(flowEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    ],
    env: getMaestroEnv(),
  });
  // Maestro only writes takeScreenshot files inside its own run folder; copy the named shots out.
  const shots = existsSync(maestroDir)
    ? readdirSync(maestroDir, {recursive: true})
        .map(String)
        .filter((path) => /(^|\/)\d{2}-[^/]+\.png$/.test(path))
    : [];
  for (const shot of shots) {
    copyFileSync(join(maestroDir, shot), join(outDir, basename(shot)));
  }
  const problems =
    exitCode === 0
      ? []
      : [`Maestro flow failed on ${device.key} (exit ${exitCode}); see ${maestroDir}`];
  return [...problems, ...(await validateScreenshots({dir: outDir, spec: device.spec}))];
};

const getDeviceKeys = ({context, options}: {context: Context; options: Options}): string[] => {
  const {app, appKey} = context;
  if (!options.device) {
    return app.devices;
  }
  if (!app.devices.includes(options.device)) {
    return fail(`${appKey} screenshots use ${app.devices.join(", ")}; not ${options.device}`);
  }
  return [options.device];
};

const commandDevices = async ({
  context,
  options,
}: {
  context: Context;
  options: Options;
}): Promise<void> => {
  for (const key of getDeviceKeys({context, options})) {
    const device = await ensureDevice({context, key});
    await ensureDevClient({context, device, options});
    say(`${device.spec.label}: ${device.id}`);
  }
};

const commandRun = async ({
  context,
  options,
}: {
  context: Context;
  options: Options;
}): Promise<void> => {
  if (!existsSync(MAESTRO_BIN)) {
    fail("Maestro not installed. Run: bun run screenshots:setup");
  }
  await ensureBackend({context});
  const stopMetro = await startMetro({context});
  const problems: string[] = [];
  try {
    for (const key of getDeviceKeys({context, options})) {
      const device = await ensureDevice({context, key});
      await resetAppState({context, device});
      if (!(await ensureDevClient({context, device, options}))) {
        problems.push(`${key}: dev client not available`);
        continue;
      }
      problems.push(...(await runFlow({context, device})).map((problem) => `${key}: ${problem}`));
    }
  } finally {
    if (stopMetro && options.isKeepMetro) {
      process.removeListener("exit", stopMetro);
    } else {
      stopMetro?.();
    }
  }
  say(`Screenshots in ${join(REPO_ROOT, context.app.appDir, "storeScreenshots")}`);
  if (problems.length > 0) {
    fail(`Problems:\n  ${problems.join("\n  ")}`);
  }
};

const commandCapture = async ({
  context,
  args,
}: {
  context: Context;
  args: string[];
}): Promise<void> => {
  const [deviceKey, name] = args;
  if (!deviceKey || !name) {
    fail("Usage: bun run screenshots:capture <app> <iphone|ipad|android> <name>");
    return;
  }
  const device = await ensureDevice({context, key: deviceKey});
  const outDir = getOutputDir({app: context.app, deviceKey: device.key});
  mkdirSync(outDir, {recursive: true});
  const path = join(outDir, `${name}.png`);
  if (device.spec.platform === "ios") {
    await runOrFail({cmd: ["xcrun", "simctl", "io", device.id, "screenshot", path], isQuiet: true});
  } else {
    const proc = Bun.spawn(["adb", "-s", device.id, "exec-out", "screencap", "-p"], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [bytes, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      proc.exited,
    ]);
    if (exitCode !== 0 || bytes.byteLength === 0) {
      fail(`adb screencap failed (exit ${exitCode})`);
    }
    await Bun.write(path, bytes);
  }
  await validateScreenshots({dir: outDir, spec: device.spec});
  say(`Saved ${path}`);
};

const main = async (): Promise<void> => {
  const [command, appKey, ...rest] = process.argv.slice(2);
  if (command === "setup") {
    await commandSetup();
    return;
  }
  const config = await loadConfig({tag: TAG});
  const app = getApp({appKey, config, tag: TAG});
  const expo = await getExpoInfo({app, tag: TAG});
  // Override when another project already owns the configured API port.
  const apiPort = getApiPort({config});
  const context: Context = {
    apiPort,
    apiUrl: `http://localhost:${apiPort}`,
    app,
    appKey: appKey as string,
    config,
    expo,
  };

  if (command === "capture") {
    await commandCapture({args: rest, context});
    return;
  }

  const options: Options = {isBuild: false, isKeepMetro: false};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--device") {
      options.device = rest[++i] ?? fail("--device requires a value");
    } else if (flag === "--build") {
      options.isBuild = true;
    } else if (flag === "--keep-metro") {
      options.isKeepMetro = true;
    } else {
      fail(`Unknown flag "${flag}"`);
    }
  }

  if (command === "devices") {
    await commandDevices({context, options});
  } else if (command === "run") {
    await commandRun({context, options});
  } else {
    fail(`Unknown command "${command ?? ""}". Use one of: setup, devices, run, capture`);
  }
};

await main();
