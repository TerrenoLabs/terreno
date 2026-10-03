#!/usr/bin/env bun
//
// Keep a simulator/emulator Expo dev client in sync with an app's native fingerprint.
//
// The dev client only needs rebuilding when native code changes. EAS stamps each build with
// the project fingerprint, so we compute the local fingerprint and look for a matching EAS
// build: cached locally -> install, finished on EAS -> download, otherwise start an EAS build.
//
// Usage:
//   bun run devclient:status <app> <platform>
//   bun run devclient:download <app> <platform> [--wait]
//   bun run devclient:build <app> <platform> [--wait] [--force]
//   bun run devclient:install <app> <platform> [--device <udid|avd>]
//   bun run devclient:ensure <app> <platform> [--wait] [--no-build] [--device <udid|avd>]
//   bun run devclient:open <app> <platform> [--device <udid|avd>]
//
// Apps come from storeAssets.config.json. Platforms: ios | android.
// `ensure` exits 3 while an EAS build is running, and 4 when --no-build found none to use.

import {existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {basename, join} from "node:path";
import {
  type AppConfig,
  EXIT_BUILD_NEEDED,
  EXIT_BUILD_PENDING,
  fail as failTagged,
  getApiPort,
  getApp,
  getExpoInfo,
  isMetroRunning,
  loadConfig,
  REPO_ROOT,
  runOrFail as runOrFailTagged,
  type StoreAssetsConfig,
  say as sayTagged,
} from "./config";
import {
  bootEmulator,
  bootIosSimulator,
  findEmulatorSerial,
  launchDevClientIntoMetro,
  listAvds,
  listIosSimulators,
  reversePorts,
} from "./devices";

const TAG = "devclient";
const CACHE_ROOT =
  process.env.DEV_CLIENT_CACHE_DIR ??
  join(homedir(), ".cache", "store-assets", basename(REPO_ROOT), "devClients");
const POLL_INTERVAL_MS = 30_000;
const METRO_WAIT_SECONDS = 120;
const COMPLETE_MARKER = ".complete";
const PENDING_STATUSES = ["NEW", "IN_QUEUE", "IN_PROGRESS"];
// iOS needs a simulator-only build; Android's internal development build is an installable APK.
const DEFAULT_PROFILES = {android: "development", ios: "development:simulator"};

const say = (message: string): void => sayTagged({message, tag: TAG});
const fail = (message: string): never => failTagged({message, tag: TAG});
const runOrFail = (args: Omit<Parameters<typeof runOrFailTagged>[0], "tag">): Promise<string> =>
  runOrFailTagged({...args, tag: TAG});

interface Target {
  app: AppConfig;
  appKey: string;
  apiPort: number;
  platform: "ios" | "android";
  profile: string;
}

interface Options {
  device?: string;
  isForce: boolean;
  isNoBuild: boolean;
  isWait: boolean;
}

interface EasArtifacts {
  buildUrl?: string;
  applicationArchiveUrl?: string;
}

interface EasBuild {
  id: string;
  status: string;
  artifacts?: EasArtifacts;
}

interface Status {
  action: "install" | "download" | "wait" | "build";
  app: string;
  buildUrl?: string;
  cachedPath?: string;
  fingerprint: string;
  platform: string;
  profile: string;
  remoteBuildId?: string;
  remoteBuildStatus?: string;
}

const getArtifactUrl = ({build}: {build: EasBuild}): string | undefined =>
  build.artifacts?.buildUrl ?? build.artifacts?.applicationArchiveUrl;

const eas = async ({target, args}: {target: Target; args: string[]}): Promise<string> => {
  return runOrFail({
    cmd: ["bunx", "eas-cli", ...args],
    cwd: join(REPO_ROOT, target.app.appDir),
    isQuiet: true,
  });
};

const getBuildPageUrl = async ({
  target,
  buildId,
}: {
  target: Target;
  buildId: string;
}): Promise<string> => {
  const {owner, slug} = await getExpoInfo({app: target.app, tag: TAG});
  return `https://expo.dev/accounts/${owner}/projects/${slug}/builds/${buildId}`;
};

const getFingerprint = async ({target}: {target: Target}): Promise<string> => {
  const output = await eas({
    args: [
      "fingerprint:generate",
      "-p",
      target.platform,
      "-e",
      target.profile,
      "--json",
      "--non-interactive",
    ],
    target,
  });
  const hash = JSON.parse(output)?.hash;
  if (!hash) {
    return fail("Could not compute fingerprint");
  }
  return hash;
};

const getCacheDir = ({target, fingerprint}: {target: Target; fingerprint: string}): string => {
  return join(CACHE_ROOT, target.appKey, target.platform, fingerprint);
};

const findCachedArtifact = ({
  target,
  fingerprint,
}: {
  target: Target;
  fingerprint: string;
}): string | undefined => {
  const dir = getCacheDir({fingerprint, target});
  // Written only after a full download (and extract), so interrupted downloads aren't reused.
  if (!existsSync(join(dir, COMPLETE_MARKER))) {
    return undefined;
  }
  const extension = target.platform === "ios" ? ".app" : ".apk";
  // Simulator tarballs may nest the .app; skip bundles embedded inside another .app.
  const match = readdirSync(dir, {recursive: true})
    .map(String)
    .find(
      (name) => name.endsWith(extension) && !name.slice(0, -extension.length).includes(".app/")
    );
  return match ? join(dir, match) : undefined;
};

const findRemoteBuilds = async ({
  target,
  fingerprint,
}: {
  target: Target;
  fingerprint: string;
}): Promise<EasBuild[]> => {
  const output = await eas({
    args: [
      "build:list",
      "-p",
      target.platform,
      "-e",
      target.profile,
      "--fingerprint-hash",
      fingerprint,
      "--limit",
      "10",
      "--json",
      "--non-interactive",
    ],
    target,
  });
  return JSON.parse(output || "[]") as EasBuild[];
};

const getStatus = async ({target}: {target: Target}): Promise<Status> => {
  const fingerprint = await getFingerprint({target});
  const base = {
    app: target.appKey,
    fingerprint,
    platform: target.platform,
    profile: target.profile,
  };

  const cachedPath = findCachedArtifact({fingerprint, target});
  if (cachedPath) {
    return {...base, action: "install", cachedPath};
  }

  const builds = await findRemoteBuilds({fingerprint, target});
  const finished = builds.find((build) => build.status === "FINISHED" && getArtifactUrl({build}));
  if (finished) {
    return {
      ...base,
      action: "download",
      buildUrl: await getBuildPageUrl({buildId: finished.id, target}),
      remoteBuildId: finished.id,
      remoteBuildStatus: finished.status,
    };
  }

  const pending = builds.find((build) => PENDING_STATUSES.includes(build.status));
  if (pending) {
    return {
      ...base,
      action: "wait",
      buildUrl: await getBuildPageUrl({buildId: pending.id, target}),
      remoteBuildId: pending.id,
      remoteBuildStatus: pending.status,
    };
  }

  return {...base, action: "build"};
};

const viewBuild = async ({
  target,
  buildId,
}: {
  target: Target;
  buildId: string;
}): Promise<EasBuild> => {
  return JSON.parse(await eas({args: ["build:view", buildId, "--json"], target})) as EasBuild;
};

const waitForBuild = async ({
  target,
  buildId,
}: {
  target: Target;
  buildId: string;
}): Promise<EasBuild> => {
  say(`Waiting for build ${await getBuildPageUrl({buildId, target})}`);
  for (;;) {
    const build = await viewBuild({buildId, target});
    if (build.status === "FINISHED") {
      return build;
    }
    if (!PENDING_STATUSES.includes(build.status)) {
      return fail(`Build ${buildId} ended with status ${build.status}`);
    }
    say(`Build ${buildId} is ${build.status}; checking again in ${POLL_INTERVAL_MS / 1000}s`);
    await Bun.sleep(POLL_INTERVAL_MS);
  }
};

const downloadBuild = async ({
  target,
  fingerprint,
  build,
}: {
  target: Target;
  fingerprint: string;
  build: EasBuild;
}): Promise<string> => {
  const url = getArtifactUrl({build});
  if (!url) {
    return fail(`Build ${build.id} has no downloadable artifact`);
  }
  const dir = getCacheDir({fingerprint, target});
  rmSync(dir, {force: true, recursive: true});
  mkdirSync(dir, {recursive: true});

  say(`Downloading ${url}`);
  const archivePath = join(dir, url.endsWith(".apk") ? "app.apk" : "app.tar.gz");
  // Android dev APKs are several hundred MB; abort stalled transfers and resume on retry.
  await runOrFail({
    cmd: [
      "curl",
      "-fL",
      "--retry",
      "5",
      "--retry-all-errors",
      "--speed-limit",
      "10000",
      "--speed-time",
      "60",
      "-C",
      "-",
      "--progress-bar",
      "-o",
      archivePath,
      url,
    ],
  });

  if (target.platform === "ios") {
    await runOrFail({cmd: ["tar", "-xzf", archivePath, "-C", dir]});
    rmSync(archivePath);
  }

  writeFileSync(join(dir, COMPLETE_MARKER), build.id);
  const artifact = findCachedArtifact({fingerprint, target});
  if (!artifact) {
    rmSync(join(dir, COMPLETE_MARKER));
    return fail(`No ${target.platform === "ios" ? ".app" : ".apk"} found in ${dir}`);
  }
  say(`Cached dev client at ${artifact}`);
  return artifact;
};

const startBuild = async ({target}: {target: Target}): Promise<string> => {
  say(`Starting EAS ${target.profile} build for ${target.appKey} (${target.platform})`);
  const output = await eas({
    args: [
      "build",
      "-p",
      target.platform,
      "-e",
      target.profile,
      "--non-interactive",
      "--no-wait",
      "--json",
    ],
    target,
  });
  const [build] = JSON.parse(output) as EasBuild[];
  if (!build?.id) {
    return fail("EAS did not return a build id");
  }
  say(`Build queued: ${await getBuildPageUrl({buildId: build.id, target})}`);
  return build.id;
};

const getSimulatorFamily = ({target}: {target: Target}): "iPad" | "iPhone" =>
  target.app.preferredIosSimulator?.startsWith("iPad") ? "iPad" : "iPhone";

// Reuses a booted simulator of the app's family, else boots the preferred one.
const ensureIosSimulator = async ({
  target,
  device,
}: {
  target: Target;
  device?: string;
}): Promise<string> => {
  if (device) {
    await bootIosSimulator({tag: TAG, udid: device});
    return device;
  }
  const family = getSimulatorFamily({target});
  const booted = await listIosSimulators({filter: "booted", tag: TAG});
  const running = booted.find((sim) => sim.name.startsWith(family));
  if (running) {
    return running.udid;
  }
  const available = await listIosSimulators({filter: "available", tag: TAG});
  const match =
    available.find((sim) => sim.name === target.app.preferredIosSimulator) ??
    available.find((sim) => sim.name.startsWith(family));
  if (!match) {
    return fail(
      `No available ${family} simulator. Install one from Xcode > Settings > Components.`
    );
  }
  say(`Booting iOS simulator ${match.name} (${match.udid})`);
  await bootIosSimulator({tag: TAG, udid: match.udid});
  return match.udid;
};

const ensureAndroidEmulator = async ({device}: {device?: string}): Promise<string> => {
  const running = await findEmulatorSerial({avd: device, tag: TAG});
  if (running) {
    return running;
  }
  const avds = await listAvds({tag: TAG});
  const avd = device ?? avds[0];
  if (!avd) {
    return fail("No Android AVDs found. Create one in Android Studio.");
  }
  if (!avds.includes(avd)) {
    return fail(`AVD "${avd}" not found. Available: ${avds.join(", ")}`);
  }
  say(`Starting Android emulator ${avd}`);
  return bootEmulator({avd, tag: TAG});
};

const installArtifact = async ({
  target,
  artifact,
  device,
}: {
  target: Target;
  artifact: string;
  device?: string;
}): Promise<void> => {
  if (target.platform === "ios") {
    const udid = await ensureIosSimulator({device, target});
    say(`Installing ${artifact} on ${udid}`);
    await runOrFail({cmd: ["xcrun", "simctl", "install", udid, artifact]});
    return;
  }
  const serial = await ensureAndroidEmulator({device});
  say(`Installing ${artifact} on ${serial}`);
  await runOrFail({cmd: ["adb", "-s", serial, "install", "-r", artifact]});
};

const printStatus = ({status}: {status: Status}): void => {
  console.info(JSON.stringify(status, null, 2));
};

const commandStatus = async ({target}: {target: Target; options: Options}): Promise<void> => {
  printStatus({status: await getStatus({target})});
};

const commandDownload = async ({
  target,
  options,
}: {
  target: Target;
  options: Options;
}): Promise<void> => {
  const status = await getStatus({target});
  if (status.cachedPath) {
    say(`Already cached: ${status.cachedPath}`);
    return;
  }
  if (!status.remoteBuildId) {
    fail(`No EAS build matches fingerprint ${status.fingerprint}. Run devclient:build first.`);
    return;
  }
  if (status.action === "wait" && !options.isWait) {
    fail(`Build ${status.buildUrl} is still ${status.remoteBuildStatus}. Re-run with --wait.`);
  }
  const build =
    status.action === "wait"
      ? await waitForBuild({buildId: status.remoteBuildId, target})
      : await viewBuild({buildId: status.remoteBuildId, target});
  await downloadBuild({build, fingerprint: status.fingerprint, target});
};

const commandBuild = async ({
  target,
  options,
}: {
  target: Target;
  options: Options;
}): Promise<void> => {
  const status = await getStatus({target});
  if (!options.isForce && status.action !== "build") {
    say(
      `Skipping build: fingerprint ${status.fingerprint} already has action "${status.action}". Use --force.`
    );
    printStatus({status});
    return;
  }
  const buildId = await startBuild({target});
  if (options.isWait) {
    const build = await waitForBuild({buildId, target});
    await downloadBuild({build, fingerprint: status.fingerprint, target});
  }
};

const commandInstall = async ({
  target,
  options,
}: {
  target: Target;
  options: Options;
}): Promise<void> => {
  const fingerprint = await getFingerprint({target});
  const artifact = findCachedArtifact({fingerprint, target});
  if (!artifact) {
    fail(`No cached dev client for fingerprint ${fingerprint}. Run devclient:ensure.`);
    return;
  }
  await installArtifact({artifact, device: options.device, target});
};

const commandEnsure = async ({
  target,
  options,
}: {
  target: Target;
  options: Options;
}): Promise<void> => {
  const status = await getStatus({target});
  say(`Fingerprint ${status.fingerprint}: ${status.action}`);

  let artifact = status.cachedPath;
  if (status.action === "download" && status.remoteBuildId) {
    const build = await viewBuild({buildId: status.remoteBuildId, target});
    artifact = await downloadBuild({build, fingerprint: status.fingerprint, target});
  }

  if (status.action === "build" && options.isNoBuild) {
    say(
      `No dev client matches fingerprint ${status.fingerprint}; a new EAS build (uses Expo credits) is needed.`
    );
    say(`Start one with: bun run devclient:build ${target.appKey} ${target.platform}`);
    process.exit(EXIT_BUILD_NEEDED);
  }

  if (status.action === "wait" || status.action === "build") {
    const buildId = status.remoteBuildId ?? (await startBuild({target}));
    if (!options.isWait) {
      say(`Dev client build pending: ${await getBuildPageUrl({buildId, target})}`);
      say("Re-run with --wait to block until it finishes, then download and install.");
      process.exit(EXIT_BUILD_PENDING);
    }
    const build = await waitForBuild({buildId, target});
    artifact = await downloadBuild({build, fingerprint: status.fingerprint, target});
  }

  if (!artifact) {
    fail("No dev client artifact to install");
    return;
  }
  await installArtifact({artifact, device: options.device, target});
  say(
    `Dev client ready. Start Metro (cd ${target.app.appDir} && bun run start), then: ` +
      `bun run devclient:open ${target.appKey} ${target.platform}`
  );
};

// Launches the dev client straight into this app's Metro server on the same device `ensure`
// installed to, instead of letting `expo start --ios` pick whichever simulator is booted.
const commandOpen = async ({
  target,
  options,
}: {
  target: Target;
  options: Options;
}): Promise<void> => {
  const port = target.app.metroPort;
  for (let attempt = 0; !(await isMetroRunning({port})); attempt++) {
    if (attempt === 0) {
      say(`Waiting for Metro on :${port} (cd ${target.app.appDir} && bun run start)`);
    }
    if (attempt >= METRO_WAIT_SECONDS) {
      fail(`Metro is not running on :${port}`);
    }
    await Bun.sleep(1_000);
  }
  const expo = await getExpoInfo({app: target.app, tag: TAG});
  const deviceId =
    target.platform === "ios"
      ? await ensureIosSimulator({device: options.device, target})
      : await ensureAndroidEmulator({device: options.device});
  if (target.platform === "android") {
    await reversePorts({ports: [target.apiPort, port], serial: deviceId, tag: TAG});
  }
  say(`Launching ${target.appKey} on ${deviceId} with Metro http://localhost:${port}`);
  await launchDevClientIntoMetro({
    deviceId,
    devMenu: "skipIntro",
    expo,
    metroPort: port,
    platform: target.platform,
    tag: TAG,
  });
};

const COMMANDS: Record<string, (args: {target: Target; options: Options}) => Promise<void>> = {
  build: commandBuild,
  download: commandDownload,
  ensure: commandEnsure,
  install: commandInstall,
  open: commandOpen,
  status: commandStatus,
};

const parseArgs = ({
  argv,
  config,
}: {
  argv: string[];
  config: StoreAssetsConfig;
}): {command: string; target: Target; options: Options} => {
  const [command, appKey, platform, ...rest] = argv;
  if (!command || !COMMANDS[command]) {
    return fail(
      `Unknown command "${command ?? ""}". Use one of: ${Object.keys(COMMANDS).join(", ")}`
    );
  }
  const app = getApp({appKey, config, tag: TAG});
  if (platform !== "ios" && platform !== "android") {
    return fail(`Unknown platform "${platform ?? ""}". Use ios or android.`);
  }

  const options: Options = {isForce: false, isNoBuild: false, isWait: false};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--wait") {
      options.isWait = true;
    } else if (flag === "--force") {
      options.isForce = true;
    } else if (flag === "--no-build") {
      options.isNoBuild = true;
    } else if (flag === "--device") {
      options.device = rest[++i] ?? fail("--device requires a value");
    } else {
      fail(`Unknown flag "${flag}"`);
    }
  }

  const profiles = config.devClientProfiles ?? DEFAULT_PROFILES;
  return {
    command,
    options,
    target: {
      apiPort: getApiPort({config}),
      app,
      appKey: appKey as string,
      platform,
      profile: profiles[platform],
    },
  };
};

if (import.meta.main) {
  const config = await loadConfig({tag: TAG});
  const {command, target, options} = parseArgs({argv: process.argv.slice(2), config});
  await COMMANDS[command]?.({options, target});
}
