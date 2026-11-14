import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync, openSync} from "node:fs";
import {chmod, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {resolveTerrenoProjectRoot} from "@terreno/mcp/project-root";

import type {CliIo, ToolCallResult, ToolHandler} from "./io";

/**
 * A CLI session is one long-lived `terreno session serve` process per project. It keeps the
 * state that a one-shot command would lose on exit: the open browser view, the in-memory
 * SyncDB snapshots, and the single Hermes debugger connection.
 */
export interface SessionState {
  pid: number;
  port: number;
  startedAt: string;
  token: string;
}

interface SessionServer {
  port: number;
  stop: () => Promise<void>;
  stopped: Promise<void>;
}

const DEFAULT_IDLE_MINUTES = 30;
const START_TIMEOUT_MS = 10000;
const START_POLL_MS = 100;
/** A start lock older than this belongs to a command that died while starting. */
const STALE_LOCK_MS = 15000;
const EVAL_ENV = "TERRENO_MCP_EVAL";

export const cliStateDir = (io: CliIo): string => {
  return join(resolveTerrenoProjectRoot(io.cwd), ".terreno", "cli");
};

const sessionFile = (io: CliIo): string => join(cliStateDir(io), "session.json");

/** Creates the state directory with a gitignore so tokens and logs are never committed. */
export const ensureCliStateDir = async (io: CliIo): Promise<string> => {
  const dir = cliStateDir(io);
  await mkdir(dir, {recursive: true});
  const ignoreFile = join(dir, ".gitignore");
  if (!existsSync(ignoreFile)) {
    await writeFile(ignoreFile, "*\n");
  }
  return dir;
};

export const writePrivateJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await chmod(path, 0o600);
};

const readSessionState = async (io: CliIo): Promise<SessionState | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(sessionFile(io), "utf8")) as Partial<SessionState>;
    if (
      typeof parsed.port !== "number" ||
      typeof parsed.token !== "string" ||
      typeof parsed.pid !== "number"
    ) {
      return undefined;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      token: parsed.token,
    };
  } catch {
    return undefined;
  }
};

const sessionRequest = async ({
  body,
  io,
  path,
  state,
}: {
  body?: unknown;
  io: CliIo;
  path: string;
  state: SessionState;
}): Promise<Response> => {
  return io.fetch(`http://127.0.0.1:${String(state.port)}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {authorization: `Bearer ${state.token}`, "content-type": "application/json"},
    method: "POST",
  });
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const isSessionHealthy = async (io: CliIo, state: SessionState): Promise<boolean> => {
  try {
    const response = await sessionRequest({io, path: "/health", state});
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Returns the session only when its process answers. The state file of an exited process is
 * cleared; one whose process is alive but not answering is kept, so `session stop` can still
 * end that process.
 */
export const findLiveSession = async (io: CliIo): Promise<SessionState | undefined> => {
  const state = await readSessionState(io);
  if (!state) {
    return undefined;
  }
  if (await isSessionHealthy(io, state)) {
    return state;
  }
  if (!isProcessAlive(state.pid)) {
    await rm(sessionFile(io), {force: true});
  }
  return undefined;
};

export const callSessionTool = async ({
  args,
  io,
  name,
  state,
}: {
  args: Record<string, unknown>;
  io: CliIo;
  name: string;
  state: SessionState;
}): Promise<ToolCallResult> => {
  // The eval opt-in belongs to the command being run, not to whichever command started the
  // session, so each call carries the caller's own setting.
  const evalOptIn = io.env[EVAL_ENV];
  const response = await sessionRequest({
    body: {args, evalOptIn: evalOptIn === "1" || evalOptIn === "true", name},
    io,
    path: "/call",
    state,
  });
  const payload = (await response.json()) as {error?: string; result?: ToolCallResult};
  if (!response.ok || !payload.result) {
    throw new Error(payload.error ?? `Session call failed with HTTP ${String(response.status)}`);
  }
  return payload.result;
};

export const stopSession = async (io: CliIo): Promise<boolean> => {
  const state = await readSessionState(io);
  if (!state) {
    return false;
  }
  const wasHealthy = await isSessionHealthy(io, state);
  const wasAlive = isProcessAlive(state.pid);
  if (wasHealthy) {
    try {
      await sessionRequest({io, path: "/stop", state});
    } catch {
      // The process may exit before it answers.
    }
  } else if (wasAlive && state.pid !== process.pid) {
    // Alive but not answering: end it so it does not keep the browser and debugger connection.
    process.kill(state.pid);
  }
  await rm(sessionFile(io), {force: true});
  return wasHealthy || wasAlive;
};

/**
 * Serves tool calls on a loopback port. Every request needs the bearer token from the state
 * file, so other local users and web pages cannot drive the browser or the app.
 */
const createSessionServer = ({
  handle,
  idleMinutes = DEFAULT_IDLE_MINUTES,
  token,
}: {
  handle: ToolHandler;
  idleMinutes?: number;
  token: string;
}): SessionServer => {
  let resolveStopped: () => void = (): void => {};
  const stopped = new Promise<void>((resolvePromise) => {
    resolveStopped = resolvePromise;
  });
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let isStopped = false;
  let callQueue: Promise<unknown> = Promise.resolve();

  /**
   * Runs one call at a time with the caller's eval opt-in in place of this process's own, so a
   * gated tool is allowed exactly when the command that asked for it opted in.
   */
  const runCall = (
    name: string,
    args: Record<string, unknown>,
    evalOptIn: boolean
  ): Promise<ToolCallResult> => {
    const task = callQueue.then(async (): Promise<ToolCallResult> => {
      const previous = process.env[EVAL_ENV];
      if (evalOptIn) {
        process.env[EVAL_ENV] = "1";
      } else {
        delete process.env[EVAL_ENV];
      }
      try {
        return await handle(name, args);
      } finally {
        if (previous === undefined) {
          delete process.env[EVAL_ENV];
        } else {
          process.env[EVAL_ENV] = previous;
        }
      }
    });
    callQueue = task.catch((): void => {});
    return task;
  };

  const server = Bun.serve({
    fetch: async (request: Request): Promise<Response> => {
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return Response.json({error: "unauthorized"}, {status: 401});
      }
      resetIdleTimer();
      const {pathname} = new URL(request.url);
      if (pathname === "/health") {
        return Response.json({ok: true});
      }
      if (pathname === "/stop") {
        setTimeout((): void => {
          void stop();
        }, 0);
        return Response.json({ok: true});
      }
      if (pathname !== "/call") {
        return Response.json({error: "not found"}, {status: 404});
      }
      try {
        const body = (await request.json()) as {
          args?: Record<string, unknown>;
          evalOptIn?: boolean;
          name?: string;
        };
        if (typeof body.name !== "string") {
          return Response.json({error: "Missing tool name"}, {status: 400});
        }
        return Response.json({
          result: await runCall(body.name, body.args ?? {}, body.evalOptIn === true),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({error: message}, {status: 500});
      }
    },
    hostname: "127.0.0.1",
    // Browser waits and Metro reconnects can outlast Bun's default 10 second idle timeout.
    idleTimeout: 255,
    port: 0,
  });

  const stop = async (): Promise<void> => {
    if (isStopped) {
      return;
    }
    isStopped = true;
    clearTimeout(idleTimer);
    await server.stop(true);
    resolveStopped();
  };

  const resetIdleTimer = (): void => {
    clearTimeout(idleTimer);
    if (idleMinutes <= 0) {
      return;
    }
    idleTimer = setTimeout((): void => {
      void stop();
    }, idleMinutes * 60000);
  };
  resetIdleTimer();

  return {port: server.port ?? 0, stop, stopped};
};

/** Runs the session in this process until it is stopped or idles out. */
export const serveSession = async ({
  handle,
  idleMinutes,
  io,
}: {
  handle: ToolHandler;
  idleMinutes?: number;
  io: CliIo;
}): Promise<void> => {
  const dir = await ensureCliStateDir(io);
  // Never replace a session that is answering: its browser and snapshots would be orphaned.
  if (await findLiveSession(io)) {
    return;
  }
  const token = randomBytes(24).toString("hex");
  const server = createSessionServer({handle, idleMinutes, token});
  const state: SessionState = {
    pid: process.pid,
    port: server.port,
    startedAt: new Date().toISOString(),
    token,
  };
  await writePrivateJson(join(dir, "session.json"), state);
  await server.stopped;
  const current = await readSessionState(io);
  if (current?.token === token) {
    await rm(join(dir, "session.json"), {force: true});
  }
};

/** Starts a detached session process unless one is already answering. */
export const startSession = async ({
  idleMinutes,
  io,
  spawnServe = spawnDetachedServe,
  timeoutMs = START_TIMEOUT_MS,
}: {
  idleMinutes?: number;
  io: CliIo;
  spawnServe?: (options: {cwd: string; idleMinutes?: number; logFile: string}) => void;
  timeoutMs?: number;
}): Promise<{isNew: boolean; state: SessionState}> => {
  const existing = await findLiveSession(io);
  if (existing) {
    return {isNew: false, state: existing};
  }
  const dir = await ensureCliStateDir(io);
  const lockFile = join(dir, "session.lock");
  // Two commands that start at once must not both spawn: only the lock holder does, and the
  // other waits for that session.
  const hasLock = await acquireStartLock(lockFile);
  try {
    if (hasLock) {
      spawnServe({cwd: io.cwd, idleMinutes, logFile: join(dir, "session.log")});
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await findLiveSession(io);
      if (state) {
        return {isNew: hasLock, state};
      }
      await Bun.sleep(START_POLL_MS);
    }
  } finally {
    if (hasLock) {
      await rm(lockFile, {force: true});
    }
  }
  throw new Error(`The CLI session did not start. See ${join(dir, "session.log")}.`);
};

const acquireStartLock = async (lockFile: string): Promise<boolean> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockFile, String(process.pid), {flag: "wx"});
      return true;
    } catch {
      const age = await stat(lockFile).then(
        (info) => Date.now() - info.mtimeMs,
        () => 0
      );
      if (age < STALE_LOCK_MS) {
        return false;
      }
      await rm(lockFile, {force: true});
    }
  }
  return false;
};

const spawnDetachedServe = ({
  cwd,
  idleMinutes,
  logFile,
}: {
  cwd: string;
  idleMinutes?: number;
  logFile: string;
}): void => {
  const script = process.argv[1];
  if (!script) {
    throw new Error("Cannot find the terreno CLI entry point to start a session.");
  }
  const log = openSync(logFile, "a");
  const args = [script, "session", "serve"];
  if (idleMinutes !== undefined) {
    args.push("--idle-minutes", String(idleMinutes));
  }
  const child = spawn(process.execPath, args, {
    cwd,
    detached: true,
    env: process.env,
    stdio: ["ignore", log, log],
  });
  child.unref();
};
