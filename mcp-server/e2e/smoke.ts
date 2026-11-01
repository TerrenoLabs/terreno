/**
 * Real-process smoke for @terreno/mcp. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * Starts each compiled binary the package ships as a child process and drives it with the real
 * MCP client over the transport it serves:
 *
 * - `terreno-mcp-local` (`dist/local/index.js`) over stdio.
 * - `terreno-mcp` (`dist/index.js`), the hosted docs server, over Streamable HTTP on a
 *   `freePort()`, reading `src/docs` through `TERRENO_MCP_DOCS_DIR`.
 *
 * For each, the client completes `initialize`, checks the server's name, and lists tools,
 * expecting at least one tool and one tool the server always registers. Exits non-zero on the first
 * failed check.
 */
import {fileURLToPath} from "node:url";
import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {freePort, type SpawnedProcess, spawnUntilReady} from "@terreno/test";
import {DateTime} from "luxon";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const LOCAL_BIN = fileURLToPath(new URL("../dist/local/index.js", import.meta.url));
const HOSTED_BIN = fileURLToPath(new URL("../dist/index.js", import.meta.url));
// `compile` emits no `dist/docs` (only `build` copies it), so the hosted server reads the
// source docs tree through its documented override.
const DOCS_DIR = fileURLToPath(new URL("../src/docs", import.meta.url));
const SERVER_READY_TIMEOUT_MS = 20000;
// Below the SDK's 60 s default, so a hung server fails inside the smoke's 30 s budget.
const REQUEST_TIMEOUT_MS = 15000;

interface ServerExpectation {
  /** The name the server reports in its `initialize` result. */
  name: string;
  /** A tool the server always registers. */
  tool: string;
}

/** Runs `initialize` and `tools/list` on a connected transport and checks the results. */
const checkServer = async ({
  client,
  label,
  expected,
}: {
  client: Client;
  label: string;
  expected: ServerExpectation;
}): Promise<void> => {
  const serverInfo = client.getServerVersion();
  if (serverInfo?.name !== expected.name) {
    throw new Error(
      `${label} initialize: expected server ${expected.name}, got ${serverInfo?.name ?? "none"}`
    );
  }
  console.info(`✅ ${label} completes initialize as ${serverInfo.name}`);

  const {tools} = await client.listTools(undefined, {timeout: REQUEST_TIMEOUT_MS});
  const names = tools.map((tool) => tool.name);
  if (names.length === 0 || !names.includes(expected.tool)) {
    throw new Error(
      `${label} tools/list: expected ${expected.tool} among the tools, got [${names.join(", ")}]`
    );
  }
  console.info(`✅ ${label} lists ${names.length} tools over its transport`);
};

/**
 * Remembers the child's pid. A failed `initialize` makes the SDK forget the child and signal it
 * only seconds later, after this process has exited, so the smoke kills it by pid itself.
 */
class TrackedStdioTransport extends StdioClientTransport {
  childPid: number | null = null;

  override async start(): Promise<void> {
    await super.start();
    this.childPid = this.pid;
  }

  killChild = (): void => {
    if (this.childPid === null) {
      return;
    }
    try {
      process.kill(this.childPid, "SIGKILL");
    } catch {
      // Already exited.
    }
    this.childPid = null;
  };
}

const smokeLocalStdio = async (): Promise<void> => {
  const client = new Client({name: "terreno-mcp-smoke", version: "1.0.0"});
  const transport = new TrackedStdioTransport({
    args: [LOCAL_BIN],
    command: process.execPath,
    cwd: PACKAGE_DIR,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  process.once("exit", transport.killChild);

  try {
    await client.connect(transport, {timeout: REQUEST_TIMEOUT_MS});
    await checkServer({
      client,
      expected: {name: "terreno-mcp-local", tool: "browser"},
      label: "terreno-mcp-local (stdio)",
    });
  } catch (error: unknown) {
    console.error(`--- terreno-mcp-local stderr ---\n${stderr}`);
    throw error;
  } finally {
    await client.close();
    transport.killChild();
  }
};

const smokeHostedHttp = async (): Promise<void> => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: SpawnedProcess | undefined;
  const client = new Client({name: "terreno-mcp-smoke", version: "1.0.0"});

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, HOSTED_BIN],
      cwd: PACKAGE_DIR,
      env: {
        MCP_HOST: "127.0.0.1",
        PORT: String(port),
        SENTRY_DSN: undefined,
        TERRENO_MCP_DOCS_DIR: DOCS_DIR,
      },
      timeoutMs: SERVER_READY_TIMEOUT_MS,
      url: `${baseUrl}/`,
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)), {
      timeout: REQUEST_TIMEOUT_MS,
    });
    await checkServer({
      client,
      expected: {name: "terreno-mcp", tool: "terreno_search_docs"},
      label: "terreno-mcp (HTTP)",
    });
  } catch (error: unknown) {
    if (server) {
      console.error(`--- terreno-mcp output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await client.close();
    await server?.stop();
  }
};

const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  await smokeLocalStdio();
  await smokeHostedHttp();
  console.info(`mcp smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
};

run().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
