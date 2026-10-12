/**
 * Dev-only bridge that ships client console errors to the backend's
 * `POST /__terreno/browser-logs` route so `read_logs` / `last_error` (terreno-mcp-local)
 * and `terreno logs --sources browser` can read them.
 *
 * Lives in syncdb (not @terreno/rtk) so apps that have dropped RTK keep the bridge.
 * Exposed from the package root and from the `@terreno/syncdb/devConsoleLogger`
 * subpath; the subpath lets `@terreno/rtk`'s deprecated re-export pull in this file
 * without bundling the sync client.
 */
import {DateTime} from "luxon";

// Metro/React Native global; undefined under Node and Bun.
declare const __DEV__: boolean | undefined;

export interface InstallTerrenoDevConsoleLoggerArgs {
  /** API origin that serves `/__terreno/browser-logs`, e.g. `baseUrl` from `@terreno/rtk`. */
  baseUrl: string;
}

interface Queued {
  level: string;
  message: string;
  stack?: string;
  timestamp: string;
}

const MAX_BATCH_ENTRIES = 100;
const MAX_QUEUE_ENTRIES = 1000;

let queue: Queued[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let restoreConsole: (() => void) | undefined;
let restoreErrorUtils: (() => void) | undefined;
let logsUrl = "";

const postEntries = async (url: string, entries: Queued[]): Promise<Response> => {
  return fetch(url, {
    body: JSON.stringify({entries}),
    headers: {"Content-Type": "application/json"},
    method: "POST",
  });
};

const isDevOrTestInstall = (): boolean => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    return true;
  }
  if (process.env.TERRENO_DEV_CONSOLE_LOGGER_TEST === "true") {
    return true;
  }
  return false;
};

const flush = async (): Promise<void> => {
  if (queue.length === 0) {
    return;
  }
  const pending = queue;
  queue = [];
  const url = logsUrl;
  for (let offset = 0; offset < pending.length; offset += MAX_BATCH_ENTRIES) {
    const entries = pending.slice(offset, offset + MAX_BATCH_ENTRIES);
    try {
      const response = await postEntries(url, entries);
      if (!response.ok) {
        await postEntries(url, entries);
      }
    } catch {
      try {
        await postEntries(url, entries);
      } catch {
        // Dev-only bridge; never break the app if the backend is down.
      }
    }
  }
};

const scheduleFlush = (): void => {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flush();
  }, 400);
};

const push = (level: string, message: string, stack?: string): void => {
  if (queue.length >= MAX_QUEUE_ENTRIES) {
    queue.splice(0, queue.length - MAX_QUEUE_ENTRIES + 1);
  }
  queue.push({
    level,
    message: message.slice(0, 8000),
    stack,
    timestamp: DateTime.now().toISO(),
  });
  scheduleFlush();
};

/**
 * Test-only teardown: clears timers, restores patched globals, and allows
 * `installTerrenoDevConsoleLogger` to run again. Not exported from the package root.
 */
export const resetTerrenoDevConsoleLoggerForTests = (): void => {
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = undefined;
  queue = [];
  restoreConsole?.();
  restoreConsole = undefined;
  restoreErrorUtils?.();
  restoreErrorUtils = undefined;
  logsUrl = "";
  const g = globalThis as typeof globalThis & {__TERRENO_CONSOLE_LOGGER__?: boolean};
  delete g.__TERRENO_CONSOLE_LOGGER__;
};

/**
 * Batches `console.error` / `console.warn`, React Native `ErrorUtils`, and web
 * `window` error hooks to `POST {baseUrl}/__terreno/browser-logs` (dev-only backend route).
 * No-op outside `__DEV__`; installs at most once per JS runtime.
 */
export const installTerrenoDevConsoleLogger = ({
  baseUrl,
}: InstallTerrenoDevConsoleLoggerArgs): void => {
  if (!isDevOrTestInstall()) {
    return;
  }
  const g = globalThis as typeof globalThis & {__TERRENO_CONSOLE_LOGGER__?: boolean};
  if (g.__TERRENO_CONSOLE_LOGGER__) {
    return;
  }
  g.__TERRENO_CONSOLE_LOGGER__ = true;
  logsUrl = `${baseUrl.replace(/\/$/, "")}/__terreno/browser-logs`;

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  restoreConsole = (): void => {
    console.error = origError;
    console.warn = origWarn;
  };
  console.error = (...args: unknown[]): void => {
    push("error", args.map(String).join(" "));
    origError(...args);
  };
  console.warn = (...args: unknown[]): void => {
    push("warn", args.map(String).join(" "));
    origWarn(...args);
  };

  const errorUtils = (globalThis as Record<string, unknown>).ErrorUtils as
    | {
        getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
        setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
      }
    | undefined;
  if (errorUtils?.setGlobalHandler) {
    const prev = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      if (error instanceof Error) {
        push("error", error.message, error.stack);
      } else {
        push("error", String(error));
      }
      if (prev) {
        prev(error, isFatal);
      }
    });
    restoreErrorUtils = (): void => {
      if (prev) {
        errorUtils.setGlobalHandler?.(prev);
      }
    };
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
      push("error", String(ev.reason ?? "unhandledrejection"));
    });
    window.addEventListener("error", (ev: ErrorEvent) => {
      const st = ev.error instanceof Error ? ev.error.stack : undefined;
      push("error", String(ev.message ?? "window.error"), st);
    });
  }
};
