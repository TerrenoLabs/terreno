/**
 * Where an agent's coding tools read files, write files, and run commands. Phase 1 ships
 * the interface only, so tools and tasks can be written against it; Node and remote
 * sandbox implementations ship with coding agents.
 */
export interface ExecutionEnv {
  /** Run a command and wait for it to exit. */
  exec(command: string, options?: ExecutionEnvExecOptions): Promise<ExecutionEnvExecResult>;
  /** Read a UTF-8 file, relative to the environment's working directory. */
  read(path: string, options?: ExecutionEnvCallOptions): Promise<string>;
  /** Create or replace a UTF-8 file, relative to the environment's working directory. */
  write(path: string, content: string, options?: ExecutionEnvCallOptions): Promise<void>;
}

export interface ExecutionEnvCallOptions {
  /** Cancels the call; pass `rt.signal` or the tool api's `signal`. */
  signal?: AbortSignal;
}

export interface ExecutionEnvExecOptions extends ExecutionEnvCallOptions {
  args?: string[];
  /** Working directory, relative to the environment's root. */
  cwd?: string;
  env?: Record<string, string>;
  /** Written to the command's standard input. */
  stdin?: string;
  timeoutMs?: number;
}

export interface ExecutionEnvExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}
