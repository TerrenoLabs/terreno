import {describe, expect, it} from "bun:test";
import {join} from "node:path";

import {runBlocksCli} from "./cli";

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

  it("exits 1 when the command is not validate", () => {
    const result = runBlocksCli(["nope"], {
      readFile: () => "",
      readStdin: () => "",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage: terreno-blocks validate");
  });
});
