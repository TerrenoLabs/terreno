export interface CliIo {
  cwd: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
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
