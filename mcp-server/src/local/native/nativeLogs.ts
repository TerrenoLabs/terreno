import {spawnSync} from "node:child_process";
import {DateTime} from "luxon";

interface NativeLogEntry {
  level?: string;
  raw: string;
  source: string;
  timestamp?: string;
}

const isNativeLogsDisabled = (): boolean => {
  const flag = process.env.TERRENO_NATIVE_LOGS?.trim().toLowerCase();
  return flag === "0" || flag === "false" || flag === "no";
};

const inferLevel = (line: string): string => {
  const lower = line.toLowerCase();
  if (lower.includes(" error ") || lower.startsWith("e/") || lower.includes("fatal")) {
    return "error";
  }
  if (lower.includes(" warn ") || lower.startsWith("w/")) {
    return "warn";
  }
  return "info";
};

const linesToEntries = (lines: string[], source: string): NativeLogEntry[] => {
  const now = DateTime.utc().toISO();
  return lines.map((line) => ({
    level: inferLevel(line),
    raw: JSON.stringify({level: inferLevel(line), message: line, source, timestamp: now}),
    source,
    timestamp: now,
  }));
};

const readAndroidLogcat = (maxLines: number): {entries: NativeLogEntry[]; status: string} => {
  const serial = process.env.TERRENO_ADB_SERIAL?.trim();
  const args = ["logcat", "-d", "-t", String(maxLines)];
  if (serial) {
    args.unshift("-s", serial);
  }
  const result = spawnSync("adb", args, {encoding: "utf-8", timeout: 5000});
  if (result.error) {
    return {entries: [], status: `native android: adb failed (${result.error.message})`};
  }
  if (result.status !== 0) {
    return {
      entries: [],
      status: `native android: adb exit ${result.status} (${(result.stderr ?? "").slice(0, 200)})`,
    };
  }
  const lines = (result.stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-maxLines);
  return {
    entries: linesToEntries(lines, "native"),
    status: `native android: ${lines.length} lines`,
  };
};

const readIosSimulatorLogs = (maxLines: number): {entries: NativeLogEntry[]; status: string} => {
  const result = spawnSync(
    "xcrun",
    ["simctl", "spawn", "booted", "log", "stream", "--style", "compact", "--timeout", "1"],
    {encoding: "utf-8", timeout: 3000}
  );
  if (result.error) {
    return {entries: [], status: `native ios: simctl failed (${result.error.message})`};
  }
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const lines = combined
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-maxLines);
  if (lines.length === 0 && result.status !== 0) {
    return {
      entries: [],
      status: `native ios: no booted simulator or log stream unavailable (exit ${result.status})`,
    };
  }
  return {
    entries: linesToEntries(lines, "native"),
    status: `native ios: ${lines.length} lines`,
  };
};

export const snapshotNativeLogs = async (
  maxLines: number
): Promise<{entries: NativeLogEntry[]; status: string}> => {
  if (isNativeLogsDisabled()) {
    return {entries: [], status: "native: disabled (TERRENO_NATIVE_LOGS=0)"};
  }
  const cap = Math.min(Math.max(maxLines, 1), 500);
  const android = readAndroidLogcat(cap);
  if (android.entries.length > 0) {
    return android;
  }
  const ios = readIosSimulatorLogs(cap);
  if (ios.entries.length > 0) {
    return ios;
  }
  const notes = [android.status, ios.status].filter(Boolean).join("; ");
  return {entries: [], status: notes || "native: no platform logs captured"};
};
