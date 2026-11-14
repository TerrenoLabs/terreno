import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync, openSync} from "node:fs";
import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
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

/** Returns the session only when its process answers; clears the state file of a dead one. */
export const findLiveSession = async (io: CliIo): Promise<SessionState | undefined> => {
  const state = await readSessionState(io);
  if (!state) {
    return undefined;
  }
  try {
    const response = await sessionRequest({io, path: "/health", state});
    if (response.ok) {
      return state;
    }
  } catch {
    // The process is gone; fall through and drop the stale file.
  }
  await rm(sessionFile(io), {force: true});
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
  const response = await sessionRequest({body: {args, name}, io, path: "/call", state});
  const payload = (await response.json()) as {error?: string; result?: ToolCallResult};
  if (!response.ok || !payload.result) {
    throw new Error(payload.error ?? `Session call failed with HTTP ${String(response.status)}`);
  }
  return payload.result;
};

export const stopSession = async (io: CliIo): Promise<boolean> => {
  const state = await findLiveSession(io);
  if (!state) {
    return false;
  }
  try {
    await sessionRequest({io, path: "/stop", state});
  } catch {
    // The process may exit before it answers.
  }
  await rm(sessionFile(io), {force: true});
  return true;
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
        const body = (await request.json()) as {args?: Record<string, unknown>; name?: string};
        if (typeof body.name !== "string") {
          return Response.json({error: "Missing tool name"}, {status: 400});
        }
        return Response.json({result: await handle(body.name, body.args ?? {})});
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
}: {
  idleMinutes?: number;
  io: CliIo;
  spawnServe?: (options: {cwd: string; idleMinutes?: number; logFile: string}) => void;
}): Promise<{isNew: boolean; state: SessionState}> => {
  const existing = await findLiveSession(io);
  if (existing) {
    return {isNew: false, state: existing};
  }
  const dir = await ensureCliStateDir(io);
  spawnServe({cwd: io.cwd, idleMinutes, logFile: join(dir, "session.log")});
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await findLiveSession(io);
    if (state) {
      return {isNew: true, state};
    }
    await Bun.sleep(START_POLL_MS);
  }
  throw new Error(`The CLI session did not start. See ${join(dir, "session.log")}.`);
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
