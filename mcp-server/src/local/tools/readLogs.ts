import {existsSync, readFileSync} from "node:fs";
import {DateTime} from "luxon";

import {resolveExistingAppLogPaths, resolveExistingBrowserLogPaths} from "../logPaths.js";
import {
  ensureCdpConnected,
  ensureMetroEventsConnected,
  getCdpConnectionStatus,
  snapshotCdpConsoleRing,
  snapshotMetroEventsRing,
} from "../metro/metroDevSession.js";
import {resolveTerrenoProjectRoot} from "../projectRoot.js";

interface LogEntry {
  level?: string;
  message?: unknown;
  timestamp?: string;
  source: string;
  raw: string;
}

const parseJsonlFile = (path: string, source: string, maxLines: number): LogEntry[] => {
  if (!existsSync(path)) {
    return [];
  }
  const text = readFileSync(path, "utf-8");
  const lines = text.split("\n").filter(Boolean);
  const slice = lines.slice(-maxLines);
  const out: LogEntry[] = [];
  for (const raw of slice) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      out.push({
        level: typeof obj.level === "string" ? obj.level : undefined,
        message: obj.message,
        raw,
        source,
        timestamp: typeof obj.timestamp === "string" ? obj.timestamp : undefined,
      });
    } catch {
      out.push({raw, source});
    }
  }
  return out;
};

const ringToEntries = (
  ring: Array<{level?: string; raw: string; source: string; timestamp?: string}>
): LogEntry[] => {
  return ring.map((r) => {
    try {
      const obj = JSON.parse(r.raw) as Record<string, unknown>;
      return {
        level: typeof obj.level === "string" ? obj.level : r.level,
        message: obj.message,
        raw: r.raw,
        source: r.source,
        timestamp: typeof obj.timestamp === "string" ? obj.timestamp : r.timestamp,
      };
    } catch {
      return {raw: r.raw, source: r.source, timestamp: r.timestamp};
    }
  });
};

const parseIso = (s: string | undefined): DateTime | undefined => {
  if (!s) {
    return undefined;
  }
  const dt = DateTime.fromISO(s);
  if (!dt.isValid) {
    return undefined;
  }
  return dt;
};

const mergeByTimestamp = (entries: LogEntry[]): LogEntry[] => {
  return [...entries].sort((a, b) => {
    const ta = parseIso(a.timestamp)?.toMillis() ?? 0;
    const tb = parseIso(b.timestamp)?.toMillis() ?? 0;
    if (ta !== tb) {
      return ta - tb;
    }
    return a.raw.localeCompare(b.raw);
  });
};

export interface ReadLogsArgs {
  sources?: string[];
  entries?: number;
  level?: string;
  since?: string;
}

export const readLogs = async (args: ReadLogsArgs): Promise<string> => {
  const maxEntries = Math.min(Math.max(args.entries ?? 200, 1), 2000);
  const want = (args.sources ?? ["backend", "browser", "metro", "app"]).map((s) => s.toLowerCase());
  const levelFilter = args.level?.toLowerCase();
  const sinceDt = args.since ? DateTime.fromISO(args.since) : undefined;
  const sinceThreshold = sinceDt?.isValid ? sinceDt : undefined;

  const merged: LogEntry[] = [];
  const status: string[] = [];

  if (want.includes("backend")) {
    for (const p of resolveExistingAppLogPaths()) {
      merged.push(...parseJsonlFile(p, "backend", maxEntries));
    }
  }
  if (want.includes("browser")) {
    for (const p of resolveExistingBrowserLogPaths()) {
      merged.push(...parseJsonlFile(p, "browser", maxEntries));
    }
  }

  if (want.includes("metro")) {
    const metroConn = await ensureMetroEventsConnected();
    status.push(metroConn.detail);
    merged.push(...ringToEntries(snapshotMetroEventsRing()));
  }

  if (want.includes("app")) {
    const cdp = await ensureCdpConnected();
    status.push(cdp.detail);
    merged.push(...ringToEntries(snapshotCdpConsoleRing()));
  }

  let filtered = merged;
  if (sinceThreshold) {
    const ms = sinceThreshold.toMillis();
    filtered = merged.filter((e) => {
      const t = parseIso(e.timestamp)?.toMillis();
      if (t === undefined) {
        return true;
      }
      return t >= ms;
    });
  }
  if (levelFilter) {
    filtered = filtered.filter((e) => (e.level ?? "").toLowerCase() === levelFilter);
  }

  const sorted = mergeByTimestamp(filtered);
  const tail = sorted.slice(-maxEntries);

  return JSON.stringify(
    {
      connection: getCdpConnectionStatus(),
      entries: tail,
      metroHint: status.join(" | ") || undefined,
      projectRoot: resolveTerrenoProjectRoot(),
    },
    null,
    2
  );
};

export interface LastErrorArgs {
  sources?: string[];
}

export const lastError = async (args: LastErrorArgs): Promise<string> => {
  const want = (args.sources ?? ["backend", "browser", "metro", "app"]).map((s) => s.toLowerCase());
  let last: LogEntry | undefined;

  const consider = (entries: LogEntry[]): void => {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const e = entries[i];
      if (!e) {
        continue;
      }
      if ((e.level ?? "").toLowerCase() === "error") {
        last = e;
        return;
      }
    }
  };

  const pool: LogEntry[] = [];
  if (want.includes("backend")) {
    for (const p of resolveExistingAppLogPaths()) {
      pool.push(...parseJsonlFile(p, "backend", 500));
    }
  }
  if (want.includes("browser")) {
    for (const p of resolveExistingBrowserLogPaths()) {
      pool.push(...parseJsonlFile(p, "browser", 500));
    }
  }
  if (want.includes("metro")) {
    await ensureMetroEventsConnected();
    pool.push(...ringToEntries(snapshotMetroEventsRing()));
  }
  if (want.includes("app")) {
    await ensureCdpConnected();
    pool.push(...ringToEntries(snapshotCdpConsoleRing()));
  }

  consider(mergeByTimestamp(pool));

  if (!last) {
    return `No recent error-level entries in selected sources (${want.join(", ")}). ${getCdpConnectionStatus()}`;
  }
  return last.raw;
};
