import {describe, expect, it} from "bun:test";
import {join} from "node:path";

import {launchBlocksCli, runBlocksCli} from "./cli";

const validFixture = join(import.meta.dir, "fixtures", "valid", "prose.yaml");
const invalidFixture = join(import.meta.dir, "fixtures", "invalid", "unknown-key.yaml");

describe("terreno-blocks validate", () => {
  it("exits 0 for a valid file and 1 for an invalid file", async () => {
    const valid = Bun.spawn(["bun", join(import.meta.dir, "cli.ts"), "validate", validFixture], {
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await valid.exited).toBe(0);
    expect(await new Response(valid.stdout).text()).toBe("");

    const invalid = Bun.spawn(
      ["bun", join(import.meta.dir, "cli.ts"), "validate", invalidFixture],
      {stderr: "pipe", stdout: "pipe"}
    );
    expect(await invalid.exited).toBe(1);
    const report = await new Response(invalid.stdout).text();
    expect(report).toContain("blocks[0].color  UNKNOWN_KEY  ");
    expect(report).toContain(" — ");
  });

  it("reads stdin when the path is -", () => {
    const result = runBlocksCli(["validate", "-"], {
      readFile: () => {
        throw new Error("readFile should not run");
      },
      readStdin: () => "v: 1\nblocks:\n  - type: divider\n",
    });
    expect(result).toEqual({code: 0, stderr: "", stdout: ""});
  });

  it("prints the file error, a non-document, and a field error", () => {
    const missing = runBlocksCli(["validate", "missing.yaml"], {
      readFile: () => {
        throw new Error("ENOENT");
      },
      readStdin: () => "",
    });
    expect(missing).toEqual({code: 1, stderr: "ENOENT\n", stdout: ""});

    const unnamed = runBlocksCli(["validate", "missing.yaml"], {
      readFile: () => {
        throw "nope";
      },
      readStdin: () => "",
    });
    expect(unnamed.stderr).toBe("Could not read the file.\n");

    const prose = runBlocksCli(["validate", "note.txt"], {
      readFile: () => "hello",
      readStdin: () => "",
    });
    expect(prose.code).toBe(1);
    expect(prose.stdout).toContain("NOT_A_DOCUMENT");

    const invalid = runBlocksCli(["validate", "bad.yaml"], {
      readFile: () => "v: 1\nblocks:\n  - type: heading\n    text: Hi\n    color: red\n",
      readStdin: () => "",
    });
    expect(invalid.code).toBe(1);
    expect(invalid.stdout).toContain("UNKNOWN_KEY");
    expect(invalid.stdout).toContain(" — ");
  });

  it("runs from the installed bin name and writes both streams", () => {
    const run = (argv1: string, args: string[]): {code: number; stderr: string; stdout: string} => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const originalArgv = process.argv;
      const originalExit = process.exit;
      const originalStdout = process.stdout.write;
      const originalStderr = process.stderr.write;
      process.argv = ["bun", argv1, ...args];
      process.stdout.write = ((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      let code = 0;
      process.exit = ((status?: number) => {
        code = status ?? 0;
        throw new Error("exit");
      }) as typeof process.exit;
      try {
        launchBlocksCli(argv1);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "exit") {
          throw error;
        }
      } finally {
        process.argv = originalArgv;
        process.exit = originalExit;
        process.stdout.write = originalStdout;
        process.stderr.write = originalStderr;
      }
      return {code, stderr: stderr.join(""), stdout: stdout.join("")};
    };

    const invalid = run("terreno-blocks", ["validate", invalidFixture]);
    expect(invalid.code).toBe(1);
    expect(invalid.stdout).toContain("UNKNOWN_KEY");

    const usage = run("cli.js", ["nope"]);
    expect(usage.code).toBe(1);
    expect(usage.stderr).toContain("Usage: terreno-blocks validate");

    const valid = run("cli.ts", ["validate", validFixture]);
    expect(valid).toEqual({code: 0, stderr: "", stdout: ""});

    const stdin = run("terreno-blocks", ["validate", "-"]);
    expect(stdin.code).toBe(1);
    expect(stdin.stdout).toContain("NOT_A_DOCUMENT");

    expect(run("bun", ["validate", validFixture])).toEqual({code: 0, stderr: "", stdout: ""});
  });

  it("exits 1 when the command is not validate", () => {
    const result = runBlocksCli(["nope"], {
      readFile: () => "",
      readStdin: () => "",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage: terreno-blocks validate");
  });
});
