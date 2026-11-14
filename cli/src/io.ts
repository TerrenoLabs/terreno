export interface ToolCallResult {
  content: Array<{text: string; type: string}>;
}

export type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>;

/** The terreno-mcp-local tools a command runs; tests pass a fake instead of mocking the module. */
interface LocalToolRunner {
  call: ToolHandler;
  tools: Array<{description?: string; inputSchema: unknown; name: string}>;
}

export interface CliIo {
  cwd: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  /** Defaults to the tools from `@terreno/mcp/local-tools`. */
  localTools?: LocalToolRunner;
  stderr: (line: string) => void;
  stdout: (line: string) => void;
}

export const createProcessIo = (): CliIo => {
  return {
    cwd: process.cwd(),
    env: process.env,
    fetch: globalThis.fetch.bind(globalThis),
    stderr: (line: string) => {
      process.stderr.write(`${line}\n`);
    },
    stdout: (line: string) => {
      process.stdout.write(`${line}\n`);
    },
  };
};

export const printJson = (io: CliIo, value: unknown): void => {
  io.stdout(JSON.stringify(value, null, 2));
};
