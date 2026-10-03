// Simulator, emulator, and dev-client launch helpers shared by devClient.ts and screenshots.ts.

import {join} from "node:path";
import {type ExpoInfo, fail, getAndroidHome, run, runOrFail, warn} from "./config";

// Booting a cold emulator can take several minutes on a loaded host.
const BOOT_POLL_ATTEMPTS = 150;
const BOOT_POLL_INTERVAL_MS = 2_000;
const DEV_MENU_PREFS = "expo.modules.devmenu.sharedpreferences";

export interface SimDevice {
  name: string;
  udid: string;
  state: string;
}

export interface RunningEmulator {
  avd: string;
  serial: string;
}

// "skipIntro" only marks the dev menu intro as seen. "hideAll" also hides the floating gear
// button and the auto-open sheet, for clean screenshots.
export type DevMenuMode = "skipIntro" | "hideAll";

export const listIosSimulators = async ({
  filter,
  tag,
}: {
  filter: "booted" | "available";
  tag: string;
}): Promise<SimDevice[]> => {
  const output = await runOrFail({
    cmd: ["xcrun", "simctl", "list", "devices", filter, "-j"],
    isQuiet: true,
    tag,
  });
  // Newest runtime first, so a fresh simulator lands on the latest iOS.
  return Object.entries(JSON.parse(output).devices as Record<string, SimDevice[]>)
    .filter(([runtime]) => runtime.includes("iOS"))
    .sort(([a], [b]) => b.localeCompare(a, undefined, {numeric: true}))
    .flatMap(([, devices]) => devices);
};

export const listIosRuntimes = async ({tag}: {tag: string}): Promise<string[]> => {
  const output = await runOrFail({
    cmd: ["xcrun", "simctl", "list", "devices", "available", "-j"],
    isQuiet: true,
    tag,
  });
  return Object.keys(JSON.parse(output).devices as Record<string, SimDevice[]>)
    .filter((runtime) => runtime.includes("iOS"))
    .sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
};

// Best-effort: the simulator keeps running headless when Simulator.app isn't installed.
const openSimulatorApp = async ({tag}: {tag: string}): Promise<void> => {
  const proc = Bun.spawn(["open", "-a", "Simulator"], {stderr: "ignore", stdout: "ignore"});
  if ((await proc.exited) !== 0) {
    warn({
      message:
        "Simulator.app not found; simulator is running headless. Install it from Xcode > Settings > Components.",
      tag,
    });
  }
};

export const bootIosSimulator = async ({udid, tag}: {udid: string; tag: string}): Promise<void> => {
  const booted = await listIosSimulators({filter: "booted", tag});
  if (!booted.some((sim) => sim.udid === udid)) {
    await run({cmd: ["xcrun", "simctl", "boot", udid], isQuiet: true});
    await runOrFail({cmd: ["xcrun", "simctl", "bootstatus", udid, "-b"], isQuiet: true, tag});
  }
  await openSimulatorApp({tag});
};

export const listRunningEmulators = async ({tag}: {tag: string}): Promise<RunningEmulator[]> => {
  const output = await runOrFail({cmd: ["adb", "devices"], isQuiet: true, tag});
  const serials = output
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([serial, state]) => serial?.startsWith("emulator-") && state === "device")
    .map(([serial]) => serial as string);
  return Promise.all(
    serials.map(async (serial) => {
      const {stdout} = await run({cmd: ["adb", "-s", serial, "emu", "avd", "name"], isQuiet: true});
      return {avd: stdout.split("\n")[0]?.trim() ?? "", serial};
    })
  );
};

export const findEmulatorSerial = async ({
  avd,
  tag,
}: {
  avd?: string;
  tag: string;
}): Promise<string | undefined> => {
  const emulators = await listRunningEmulators({tag});
  return (avd ? emulators.find((emulator) => emulator.avd === avd) : emulators[0])?.serial;
};

export const listAvds = async ({tag}: {tag: string}): Promise<string[]> => {
  const emulatorBin = join(getAndroidHome({tag}), "emulator", "emulator");
  const output = await runOrFail({cmd: [emulatorBin, "-list-avds"], isQuiet: true, tag});
  return output.split("\n").filter(Boolean);
};

// Starts the AVD (if needed) and returns its adb serial once Android reports boot complete.
export const bootEmulator = async ({avd, tag}: {avd: string; tag: string}): Promise<string> => {
  const running = await findEmulatorSerial({avd, tag});
  if (running) {
    return running;
  }
  const emulatorBin = join(getAndroidHome({tag}), "emulator", "emulator");
  // nohup without a shell, so the emulator outlives this script and no value is shell-parsed.
  Bun.spawn(["nohup", emulatorBin, "-avd", avd], {
    stderr: "ignore",
    stdin: "ignore",
    stdout: "ignore",
  }).unref();
  for (let attempt = 0; attempt < BOOT_POLL_ATTEMPTS; attempt++) {
    const serial = await findEmulatorSerial({avd, tag});
    if (serial) {
      const {stdout} = await run({
        cmd: ["adb", "-s", serial, "shell", "getprop", "sys.boot_completed"],
        isQuiet: true,
      });
      if (stdout.trim() === "1") {
        return serial;
      }
    }
    await Bun.sleep(BOOT_POLL_INTERVAL_MS);
  }
  return fail({message: `Emulator ${avd} did not finish booting`, tag});
};

// The emulator reaches the host's API and Metro over localhost via adb reverse.
export const reversePorts = async ({
  serial,
  ports,
  tag,
}: {
  serial: string;
  ports: number[];
  tag: string;
}): Promise<void> => {
  for (const port of ports) {
    await runOrFail({
      cmd: ["adb", "-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`],
      isQuiet: true,
      tag,
    });
  }
};

const hideAndroidDevMenu = async ({
  serial,
  androidPackage,
  tag,
}: {
  serial: string;
  androidPackage: string;
  tag: string;
}): Promise<void> => {
  const xml = [
    "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>",
    "<map>",
    '<boolean name="isOnboardingFinished" value="true" />',
    '<boolean name="showFab" value="false" />',
    '<boolean name="showsAtLaunch" value="false" />',
    "</map>",
  ].join("");
  // Dev client builds are debuggable, so run-as can write the app's private prefs. Base64
  // avoids shell-quoting the XML; androidPackage is validated by getExpoInfo.
  const encoded = Buffer.from(xml).toString("base64");
  await runOrFail({
    cmd: [
      "adb",
      "-s",
      serial,
      "shell",
      `run-as ${androidPackage} sh -c 'mkdir -p shared_prefs && echo ${encoded} | base64 -d > shared_prefs/${DEV_MENU_PREFS}.xml'`,
    ],
    isQuiet: true,
    tag,
  });
};

// Launches the dev client straight into a Metro server. iOS passes the launcher's
// --initialUrl argument because opening an exp+ URL shows an "Open in ...?" system prompt
// that automation cannot dismiss.
export const launchDevClientIntoMetro = async ({
  platform,
  deviceId,
  expo,
  metroPort,
  devMenu,
  tag,
}: {
  platform: "ios" | "android";
  deviceId: string;
  expo: ExpoInfo;
  metroPort: number;
  devMenu: DevMenuMode;
  tag: string;
}): Promise<void> => {
  const metroUrl = `http://localhost:${metroPort}`;
  if (platform === "ios") {
    const prefs: [string, string][] =
      devMenu === "hideAll"
        ? [
            ["EXDevMenuIsOnboardingFinished", "YES"],
            ["EXDevMenuShowFloatingActionButton", "NO"],
            ["EXDevMenuShowsAtLaunch", "NO"],
          ]
        : [["EXDevMenuIsOnboardingFinished", "YES"]];
    for (const [key, value] of prefs) {
      await runOrFail({
        cmd: [
          "xcrun",
          "simctl",
          "spawn",
          deviceId,
          "defaults",
          "write",
          expo.bundleId,
          key,
          "-bool",
          value,
        ],
        isQuiet: true,
        tag,
      });
    }
    await runOrFail({
      cmd: [
        "xcrun",
        "simctl",
        "launch",
        "--terminate-running-process",
        deviceId,
        expo.bundleId,
        "--initialUrl",
        metroUrl,
      ],
      isQuiet: true,
      tag,
    });
    return;
  }

  if (devMenu === "hideAll") {
    await runOrFail({
      cmd: ["adb", "-s", deviceId, "shell", "am", "force-stop", expo.androidPackage],
      isQuiet: true,
      tag,
    });
    await hideAndroidDevMenu({androidPackage: expo.androidPackage, serial: deviceId, tag});
  }
  const url = `exp+${expo.slug}://expo-development-client/?url=${encodeURIComponent(metroUrl)}`;
  await runOrFail({
    cmd: [
      "adb",
      "-s",
      deviceId,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `'${url}'`,
    ],
    isQuiet: true,
    tag,
  });
};
