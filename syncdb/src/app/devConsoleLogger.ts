import {DateTime} from "luxon";

import {baseUrl as defaultBaseUrl} from "../config/baseUrl";

interface Queued {
  level: string;
  message: string;
  stack?: string;
  timestamp: string;
}

export interface InstallDevConsoleLoggerOptions {
  /** API origin hosting `POST /__terreno/browser-logs`. Defaults to `@terreno/syncdb/config` `baseUrl`. */
  baseUrl?: string;
}

const MAX_BATCH_ENTRIES = 100;
const MAX_QUEUE_ENTRIES = 1000;
const FLUSH_DELAY_MS = 400;

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
  if ((globalThis as {__DEV__?: boolean}).__DEV__ === true) {
    return true;
  }
  return process.env.TERRENO_DEV_CONSOLE_LOGGER_TEST === "true";
};

const flush = async (): Promise<void> => {
  if (queue.length === 0) {
    return;
  }
  const pending = queue;
  queue = [];
  for (let offset = 0; offset < pending.length; offset += MAX_BATCH_ENTRIES) {
    const entries = pending.slice(offset, offset + MAX_BATCH_ENTRIES);
    try {
      const response = await postEntries(logsUrl, entries);
      if (!response.ok) {
        await postEntries(logsUrl, entries);
      }
    } catch {
      try {
        await postEntries(logsUrl, entries);
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
  }, FLUSH_DELAY_MS);
};

const push = (level: string, message: string, stack?: string): void => {
  if (queue.length >= MAX_QUEUE_ENTRIES) {
    queue.splice(0, queue.length - MAX_QUEUE_ENTRIES + 1);
  }
  queue.push({
    level,
    message: message.slice(0, 8000),
    stack,
    timestamp: DateTime.now().toISO() ?? "",
  });
  scheduleFlush();
};

/**
 * Test-only teardown: clears timers, restores patched globals, and allows
 * `installDevConsoleLogger` to run again. Not exported from `@terreno/syncdb/app`.
 */
export const resetDevConsoleLoggerForTests = (): void => {
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = undefined;
  queue = [];
  restoreConsole?.();
  restoreConsole = undefined;
  restoreErrorUtils?.();
  restoreErrorUtils = undefined;
  const g = globalThis as typeof globalThis & {__TERRENO_CONSOLE_LOGGER__?: boolean};
  delete g.__TERRENO_CONSOLE_LOGGER__;
};

/**
 * Batches `console.error` / `console.warn`, React Native `ErrorUtils`, and web
 * `window` error hooks to `POST /__terreno/browser-logs` (dev-only backend route),
 * so agents and developers can read client errors from the backend log. No-op
 * outside `__DEV__`; safe to call more than once.
 */
export const installDevConsoleLogger = (options: InstallDevConsoleLoggerOptions = {}): void => {
  if (!isDevOrTestInstall()) {
    return;
  }
  const g = globalThis as typeof globalThis & {__TERRENO_CONSOLE_LOGGER__?: boolean};
  if (g.__TERRENO_CONSOLE_LOGGER__) {
    return;
  }
  g.__TERRENO_CONSOLE_LOGGER__ = true;
  logsUrl = `${(options.baseUrl ?? defaultBaseUrl).replace(/\/$/, "")}/__terreno/browser-logs`;

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
