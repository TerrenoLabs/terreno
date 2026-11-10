import {
  cdpRuntimeEvaluate,
  ensureCdpConnected,
  getCdpConnectionStatus,
} from "../metro/metroDevSession.js";

const MAX_STORAGE_KEYS = 200;
const MAX_STORAGE_VALUE_CHARS = 8192;

type DevStorageAdapter = {
  canWriteKey: (key: string) => boolean;
  get: (key: string) => Promise<string | null>;
  listKeys: () => Promise<string[]>;
  set: (key: string, value: string) => Promise<void>;
};

type DevCommandRegistry = Record<
  string,
  {
    description: string;
    handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
    inputSchema?: Record<string, unknown>;
  }
>;

type DevClientDispatch = {
  dispatch: (action: {payload?: unknown; type: string}) => unknown;
};

type DevMcpGlobal = typeof globalThis & {
  __TERRENO_DEV_CLIENT_DISPATCH__?: DevClientDispatch;
  __TERRENO_DEV_COMMANDS__?: DevCommandRegistry;
  __TERRENO_DEV_STORAGE__?: DevStorageAdapter;
};

const SENSITIVE_STORAGE_KEY = /(?:^|\/)(?:auth|token|session|password|credential|cookie|secret)/i;

const formatStorageValue = (key: string, value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  if (SENSITIVE_STORAGE_KEY.test(key)) {
    return `[REDACTED len=${value.length}]`;
  }
  if (value.length > MAX_STORAGE_VALUE_CHARS) {
    return `${value.slice(0, MAX_STORAGE_VALUE_CHARS)}…`;
  }
  return value;
};

const isTerrenoMcpEvalEnabled = (): boolean => {
  return process.env.TERRENO_MCP_EVAL === "1" || process.env.TERRENO_MCP_EVAL === "true";
};

const refuseEval = (tool: string): string => {
  return `Refused: set \`TERRENO_MCP_EVAL=1\` to opt in to \`${tool}\`.`;
};

const getDevClientDispatch = (): DevClientDispatch | undefined => {
  return (globalThis as DevMcpGlobal).__TERRENO_DEV_CLIENT_DISPATCH__;
};

const getDevStorage = (): DevStorageAdapter | undefined => {
  return (globalThis as DevMcpGlobal).__TERRENO_DEV_STORAGE__;
};

const listDevCommandsInProcess = (): Array<{
  description: string;
  inputSchema?: Record<string, unknown>;
  name: string;
}> => {
  const map = (globalThis as DevMcpGlobal).__TERRENO_DEV_COMMANDS__ ?? {};
  return Object.entries(map)
    .map(([name, cmd]) => ({
      description: cmd.description,
      inputSchema: cmd.inputSchema,
      name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const runDevCommandInProcess = async (
  name: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  const cmd = (globalThis as DevMcpGlobal).__TERRENO_DEV_COMMANDS__?.[name];
  if (!cmd) {
    throw new Error(`Unknown dev command: ${name}`);
  }
  return cmd.handler(args);
};

export interface DispatchClientActionArgs {
  payload?: unknown;
  type: string;
}

export const dispatchClientAction = async (args: DispatchClientActionArgs): Promise<string> => {
  if (!isTerrenoMcpEvalEnabled()) {
    return refuseEval("dispatch_client_action");
  }
  const type = args.type.trim();
  if (!type) {
    return "No action type provided.";
  }
  const bus = getDevClientDispatch();
  if (bus) {
    try {
      const result = bus.dispatch({payload: args.payload, type});
      return JSON.stringify({ok: true, result, status: "in-process dispatch"}, null, 2);
    } catch (e) {
      return JSON.stringify({error: String(e), ok: false}, null, 2);
    }
  }
  const typeJson = JSON.stringify(type);
  const payloadJson = JSON.stringify(args.payload ?? null);
  const expression = `(() => {
    const bus = globalThis.__TERRENO_DEV_CLIENT_DISPATCH__;
    if (!bus || typeof bus.dispatch !== "function") {
      return { ok: false, error: "no __TERRENO_DEV_CLIENT_DISPATCH__ (call registerTerrenoDevClientDispatch from @terreno/syncdb)" };
    }
    bus.dispatch({ type: ${typeJson}, payload: ${payloadJson} });
    return { ok: true };
  })()`;
  await ensureCdpConnected();
  const ev = await cdpRuntimeEvaluate(expression, false);
  if (ev.error) {
    return JSON.stringify({error: ev.error, status: getCdpConnectionStatus()}, null, 2);
  }
  return JSON.stringify({result: ev.value, status: getCdpConnectionStatus()}, null, 2);
};

export interface ReadLocalStorageArgs {
  keys?: string[];
  prefix?: string;
}

const readStorageInProcess = async (
  adapter: DevStorageAdapter,
  args: ReadLocalStorageArgs
): Promise<string> => {
  let keys = args.keys ?? [];
  if (keys.length === 0) {
    keys = await adapter.listKeys();
    const prefix = args.prefix?.trim();
    if (prefix) {
      keys = keys.filter((k) => k.startsWith(prefix));
    }
  }
  keys = keys.slice(0, MAX_STORAGE_KEYS);
  const entries: Record<string, string | null> = {};
  for (const key of keys) {
    const value = await adapter.get(key);
    entries[key] = formatStorageValue(key, value);
  }
  return JSON.stringify({count: keys.length, entries, status: "in-process adapter"}, null, 2);
};

export const readLocalStorage = async (args: ReadLocalStorageArgs): Promise<string> => {
  const adapter = getDevStorage();
  if (adapter) {
    return readStorageInProcess(adapter, args);
  }
  const keysJson = JSON.stringify(args.keys ?? null);
  const prefixJson = JSON.stringify(args.prefix ?? null);
  const expression = `(async () => {
    const storage = globalThis.__TERRENO_DEV_STORAGE__;
    if (!storage) return { error: "no __TERRENO_DEV_STORAGE__" };
    let keys = ${keysJson};
    if (!keys || keys.length === 0) {
      keys = await storage.listKeys();
      const prefix = ${prefixJson};
      if (prefix) keys = keys.filter((k) => k.startsWith(prefix));
    }
    keys = keys.slice(0, ${MAX_STORAGE_KEYS});
    const entries = {};
    const sensitive = new RegExp(${JSON.stringify(SENSITIVE_STORAGE_KEY.source)}, "i");
    const redact = (key, value) => {
      if (value === null) return null;
      if (sensitive.test(key)) return "[REDACTED len=" + value.length + "]";
      if (value.length > ${MAX_STORAGE_VALUE_CHARS}) return value.slice(0, ${MAX_STORAGE_VALUE_CHARS}) + "…";
      return value;
    };
    for (const key of keys) {
      const value = await storage.get(key);
      entries[key] = redact(key, value);
    }
    return { count: keys.length, entries };
  })()`;
  await ensureCdpConnected();
  const ev = await cdpRuntimeEvaluate(expression, true);
  if (ev.error) {
    return JSON.stringify({error: ev.error, status: getCdpConnectionStatus()}, null, 2);
  }
  return JSON.stringify({result: ev.value, status: getCdpConnectionStatus()}, null, 2);
};

export interface WriteLocalStorageArgs {
  key: string;
  value: string;
}

export const writeLocalStorage = async (args: WriteLocalStorageArgs): Promise<string> => {
  if (!isTerrenoMcpEvalEnabled()) {
    return refuseEval("write_local_storage");
  }
  const key = args.key.trim();
  if (!key) {
    return "No key provided.";
  }
  const adapter = getDevStorage();
  if (adapter) {
    try {
      if (!adapter.canWriteKey(key)) {
        return JSON.stringify({error: `Key not writable: ${key}`, ok: false}, null, 2);
      }
      await adapter.set(key, args.value);
      return JSON.stringify({key, ok: true, status: "in-process adapter"}, null, 2);
    } catch (e) {
      return JSON.stringify({error: String(e), ok: false}, null, 2);
    }
  }
  const keyJson = JSON.stringify(key);
  const valueJson = JSON.stringify(args.value);
  const expression = `(async () => {
    const storage = globalThis.__TERRENO_DEV_STORAGE__;
    if (!storage) return { ok: false, error: "no __TERRENO_DEV_STORAGE__" };
    if (!storage.canWriteKey(${keyJson})) return { ok: false, error: "key not writable" };
    await storage.set(${keyJson}, ${valueJson});
    return { ok: true, key: ${keyJson} };
  })()`;
  await ensureCdpConnected();
  const ev = await cdpRuntimeEvaluate(expression, true);
  if (ev.error) {
    return JSON.stringify({error: ev.error, status: getCdpConnectionStatus()}, null, 2);
  }
  return JSON.stringify({result: ev.value, status: getCdpConnectionStatus()}, null, 2);
};

export const listDevCommands = async (): Promise<string> => {
  const inProcess = listDevCommandsInProcess();
  if (inProcess.length > 0) {
    return JSON.stringify({commands: inProcess, status: "in-process registry"}, null, 2);
  }
  const expression = `JSON.stringify(Object.entries(globalThis.__TERRENO_DEV_COMMANDS__ ?? {}).map(([name, cmd]) => ({
    name,
    description: cmd.description,
    inputSchema: cmd.inputSchema,
  })))`;
  await ensureCdpConnected();
  const ev = await cdpRuntimeEvaluate(expression, false);
  if (ev.error) {
    return JSON.stringify(
      {commands: [], error: ev.error, status: getCdpConnectionStatus()},
      null,
      2
    );
  }
  const parsed = typeof ev.value === "string" ? JSON.parse(ev.value) : ev.value;
  return JSON.stringify({commands: parsed ?? [], status: getCdpConnectionStatus()}, null, 2);
};

export interface InvokeDevCommandArgs {
  arguments?: Record<string, unknown>;
  name: string;
}

export const invokeDevCommand = async (args: InvokeDevCommandArgs): Promise<string> => {
  if (!isTerrenoMcpEvalEnabled()) {
    return refuseEval("invoke_dev_command");
  }
  const name = args.name.trim();
  if (!name) {
    return "No command name provided.";
  }
  const payload = args.arguments ?? {};
  const commands = (globalThis as DevMcpGlobal).__TERRENO_DEV_COMMANDS__;
  if (commands && Object.keys(commands).length > 0) {
    try {
      const result = await runDevCommandInProcess(name, payload);
      return JSON.stringify({ok: true, result, status: "in-process registry"}, null, 2);
    } catch (e) {
      return JSON.stringify({error: String(e), ok: false}, null, 2);
    }
  }
  const nameJson = JSON.stringify(name);
  const argsJson = JSON.stringify(payload);
  const expression = `(async () => {
    const cmd = globalThis.__TERRENO_DEV_COMMANDS__?.[${nameJson}];
    if (!cmd) return { ok: false, error: "unknown command" };
    return { ok: true, result: await cmd.handler(${argsJson}) };
  })()`;
  await ensureCdpConnected();
  const ev = await cdpRuntimeEvaluate(expression, true);
  if (ev.error) {
    return JSON.stringify({error: ev.error, status: getCdpConnectionStatus()}, null, 2);
  }
  return JSON.stringify({result: ev.value, status: getCdpConnectionStatus()}, null, 2);
};
