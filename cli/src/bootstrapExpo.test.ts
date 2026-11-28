import {describe, expect, test} from "bun:test";
import {existsSync} from "node:fs";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {runBootstrapCommand} from "./commands/bootstrap";
import type {CliIo} from "./io";
import {parseArgs} from "./parseArgs";

interface TestIo extends CliIo {
  stderrLines: string[];
  stdoutLines: string[];
}

const createIo = (cwd: string): TestIo => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    cwd,
    env: {},
    fetch: globalThis.fetch,
    stderr: (line: string): void => {
      stderrLines.push(line);
    },
    stderrLines,
    stdout: (line: string): void => {
      stdoutLines.push(line);
    },
    stdoutLines,
  };
};

const withTempDir = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "terreno-cli-expo-"));
  try {
    await body(dir);
  } finally {
    await rm(dir, {force: true, recursive: true});
  }
};

describe("bootstrap app --expo", () => {
  test("runs the Expo setup in the frontend and reports each step", async (): Promise<void> => {
    await withTempDir(async (dir) => {
      const io = createIo(dir);
      const calls: string[] = [];
      const parsed = parseArgs([
        "bootstrap",
        "app",
        "--name",
        "demo-app",
        "--dir",
        "app",
        "--expo",
        "--expo-account",
        "acme",
        "--expo-platform",
        "android",
        "--bundle-id",
        "com.acme.demoapp",
      ]);
      const code = await runBootstrapCommand(parsed, io, true, undefined, {
        hasToken: true,
        isInteractive: false,
        run: (command) => {
          calls.push(`${command.cwd}: ${command.command} ${command.args.join(" ")}`);
          return {exitCode: 0, stdout: ""};
        },
      });

      const frontendPath = join(dir, "app", "frontend");
      expect(code).toBe(0);
      expect(calls).toEqual([
        `${frontendPath}: bun install`,
        `${frontendPath}: bunx eas-cli init --account acme --non-interactive --force`,
      ]);
      const output = JSON.parse(io.stdoutLines.join("\n"));
      expect(output.ok).toBe(true);
      expect(output.expo.map((step: {name: string}) => step.name)).toEqual([
        "dependencies",
        "login",
        "project",
        "credentials:android",
      ]);
      const appJson = JSON.parse(await readFile(join(frontendPath, "app.json"), "utf8"));
      expect(appJson.expo.android.package).toBe("com.acme.demoapp");
    });
  });

  test("exits non-zero and prints the failed step when the setup fails", async (): Promise<void> => {
    await withTempDir(async (dir) => {
      const io = createIo(dir);
      const parsed = parseArgs([
        "bootstrap",
        "app",
        "--name",
        "demo-app",
        "--dir",
        "app",
        "--expo",
      ]);
      const code = await runBootstrapCommand(parsed, io, false, undefined, {
        hasToken: true,
        isInteractive: false,
        run: () => ({exitCode: 1, stdout: ""}),
      });
      expect(code).toBe(1);
      expect(io.stdoutLines.join("\n")).toContain("dependencies: failed (bun install failed)");
    });
  });

  test("rejects a bad bundle id or platform before writing files", async (): Promise<void> => {
    await withTempDir(async (dir) => {
      const base = ["bootstrap", "app", "--name", "demo-app", "--dir", "app"];
      for (const extra of [
        ["--bundle-id", "demo-app"],
        ["--expo", "--expo-platform", "windows"],
      ]) {
        const io = createIo(dir);
        expect(await runBootstrapCommand(parseArgs([...base, ...extra]), io, false)).toBe(1);
        expect(io.stderrLines).toHaveLength(1);
      }
      expect(existsSync(join(dir, "app"))).toBe(false);
    });
  });
});
