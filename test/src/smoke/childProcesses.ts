import type {Subprocess} from "bun";

type SmokeChild = Subprocess<"ignore", "pipe", "pipe">;

export interface ChildOutput {
  /** stdout and stderr together, in arrival order. */
  combined: () => string;
  stdout: () => string;
  stderr: () => string;
  /** Resolves once both streams have closed. */
  drained: Promise<void>;
}

const liveChildren = new Set<SmokeChild>();
let isCleanupRegistered = false;

/**
 * Signals the child's whole process group, so a wrapper (`sh -c`, `bun run`) and the server it
 * started both get it. Falls back to the child alone when the group is already gone.
 */
export const killGroup = (child: SmokeChild, signal: NodeJS.Signals): void => {
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};

const killLiveChildren = (): void => {
  for (const child of liveChildren) {
    killGroup(child, "SIGKILL");
  }
  liveChildren.clear();
};

const registerCleanup = (): void => {
  if (isCleanupRegistered) {
    return;
  }
  isCleanupRegistered = true;
  process.on("exit", killLiveChildren);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.once(signal, () => {
      killLiveChildren();
      process.exit(code);
    });
  }
};

/**
 * Starts a child in its own process group and tracks it, so it and anything it starts die with
 * the smoke, even when the smoke crashes or is interrupted.
 */
export const spawnTracked = ({
  cmd,
  cwd,
  env,
}: {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}): SmokeChild => {
  registerCleanup();
  const child = Bun.spawn({
    cmd,
    cwd,
    detached: true,
    env: {...process.env, ...env},
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  liveChildren.add(child);
  void child.exited.then(() => liveChildren.delete(child));
  return child;
};

/** Reads a child's stdout and stderr as they arrive. */
export const collectOutput = (child: SmokeChild): ChildOutput => {
  let combined = "";
  const streams = {stderr: "", stdout: ""};
  const drain = async (name: "stderr" | "stdout"): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of child[name]) {
      const text = decoder.decode(chunk, {stream: true});
      streams[name] += text;
      combined += text;
    }
  };
  return {
    combined: (): string => combined,
    drained: Promise.all([drain("stdout"), drain("stderr")]).then(() => undefined),
    stderr: (): string => streams.stderr,
    stdout: (): string => streams.stdout,
  };
};
