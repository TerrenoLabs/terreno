import {realpathSync} from "node:fs";

interface RunningProcess {
  pid: number;
  command: string;
  cwd?: string;
}

interface StopRunProcessesOptions {
  runDir: string;
  list?: () => RunningProcess[];
  kill?: (pid: number) => void;
}

const listProcesses = (): RunningProcess[] => {
  const ps = Bun.spawnSync({cmd: ["ps", "-axo", "pid=,command="]});
  const cwds = new Map<number, string>();
  const lsof = Bun.spawnSync({cmd: ["lsof", "-d", "cwd", "-Fpn"]});
  let current = 0;
  for (const line of lsof.stdout.toString().split("\n")) {
    if (line.startsWith("p")) {
      current = Number(line.slice(1));
    } else if (line.startsWith("n") && current) {
      cwds.set(current, line.slice(1));
    }
  }
  return ps.stdout
    .toString()
    .split("\n")
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(.*)$/);
      return match
        ? [{command: match[2], cwd: cwds.get(Number(match[1])), pid: Number(match[1])}]
        : [];
    });
};

const resolvedPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * Stops processes a stage's builder left behind: anything whose working directory or command
 * line is inside the run directory. Returns the pids it signalled.
 */
export const stopRunProcesses = ({
  runDir,
  list = listProcesses,
  kill = (pid: number): void => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already exited.
    }
  },
}: StopRunProcessesOptions): number[] => {
  const roots = [...new Set([runDir, resolvedPath(runDir)])];
  const inside = (value: string | undefined): boolean =>
    value !== undefined && roots.some((root) => value === root || value.includes(`${root}/`));
  const stopped = list()
    .filter((item) => item.pid !== process.pid && item.pid !== process.ppid)
    .filter((item) => inside(item.cwd) || inside(item.command))
    .map((item) => item.pid);
  for (const pid of stopped) {
    kill(pid);
  }
  return stopped;
};
