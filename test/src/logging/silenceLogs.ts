// noExplicitAny: test mock typing
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, beforeEach} from "bun:test";
import {Writable} from "node:stream";
import winston from "winston";

export interface SilenceLogsOptions {
  showAllLogs?: boolean;
  /** Extra winston loggers to silence (e.g. @terreno/api winstonLogger). */
  additionalWinstonLoggers?: winston.Logger[];
  onBeforeEach?: () => void;
  onAfterEach?: () => void;
}

export interface SilenceLogsController {
  getLogs: () => string[];
  clearLogs: () => void;
  restore: () => void;
  reapply: () => void;
}

const getApiWinstonLogger = (): winston.Logger | undefined => {
  try {
    // Runtime-only so @terreno/test compiles without @terreno/api.
    const api = require("@terreno/api") as any;
    return api.winstonLogger as winston.Logger | undefined;
  } catch {
    return undefined;
  }
};

const createLogStream = (logs: string[], showAllLogs: boolean): Writable => {
  return new Writable({
    write(chunk: unknown, _encoding: unknown, callback: () => void) {
      const text = String(chunk);
      logs.push(text);
      if (showAllLogs) {
        process.stdout.write(text);
      }
      callback();
    },
  });
};

/**
 * Silences winston and console output during tests while capturing log lines in memory.
 */
export const createLogSilencer = (options: SilenceLogsOptions = {}): SilenceLogsController => {
  const showAllLogs = options.showAllLogs ?? process.env.SHOW_ALL_TEST_LOGS === "true";
  let logs: string[] = [];

  const originalConsole = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    // biome-ignore lint/suspicious/noConsole: preserve original reference
    log: console.log,
    warn: console.warn,
  };

  const logStream = createLogStream(logs, showAllLogs);
  const silentTransport = new winston.transports.Stream({
    format: winston.format.simple(),
    stream: logStream,
  });

  const captureConsoleMethod = (method: keyof typeof originalConsole): void => {
    (console as any)[method] = (...args: any[]) => {
      const logMessage = `[console.${method}] ${args
        .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
        .join(" ")}`;
      logs.push(logMessage);
      if (showAllLogs) {
        originalConsole[method](...args);
      }
    };
  };

  const applySilencing = (): void => {
    winston.clear();
    winston.add(silentTransport);

    // Only reach for @terreno/api when the caller has not supplied its logger. Requiring the
    // package from inside api's own test run would load its built dist alongside the sources
    // under test, registering every Mongoose model twice.
    const provided = options.additionalWinstonLoggers ?? [];
    const extraLoggers = (provided.length > 0 ? provided : [getApiWinstonLogger()]).filter(
      Boolean
    ) as winston.Logger[];

    for (const extraLogger of extraLoggers) {
      extraLogger.clear();
      extraLogger.add(silentTransport);
    }

    captureConsoleMethod("log");
    captureConsoleMethod("info");
    captureConsoleMethod("warn");
    captureConsoleMethod("error");
    captureConsoleMethod("debug");
  };

  applySilencing();

  return {
    clearLogs: (): void => {
      logs = [];
    },
    getLogs: (): string[] => logs,
    reapply: applySilencing,
    restore: (): void => {
      console.debug = originalConsole.debug;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
    },
  };
};

/** Registers beforeEach/afterEach hooks that silence logs and clear the capture buffer. */
export const registerLogSilencing = (options: SilenceLogsOptions = {}): SilenceLogsController => {
  const silencer = createLogSilencer(options);

  beforeEach(() => {
    options.onBeforeEach?.();
    silencer.reapply();
    silencer.clearLogs();
  });

  afterEach(() => {
    silencer.clearLogs();
    options.onAfterEach?.();
  });

  return silencer;
};
