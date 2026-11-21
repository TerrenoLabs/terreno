import {afterAll, describe, expect, it, setDefaultTimeout} from "bun:test";
import {existsSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

setDefaultTimeout(540_000);

const ROOT = join(import.meta.dir, "..", "..", "..");
const runDir = mkdtempSync(join(tmpdir(), "bootstrap-loop-e1-"));

afterAll(() => {
  rmSync(runDir, {force: true, recursive: true});
});

describe("bootstrap-loop stage scaffold (process)", () => {
  it("scaffolds the local template and type-checks the backend", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        join(ROOT, "scripts/bootstrapLoop/cli.ts"),
        "stage",
        "scaffold",
        "--version",
        "local",
        "--run-dir",
        runDir,
      ],
      {
        env: {
          ...process.env,
          BOOTSTRAP_LOOP_BUILDER_CMD: `bun ${join(ROOT, "scripts/bootstrapLoop/fixtures/fakeBuilder.ts")}`,
          BOOTSTRAP_LOOP_FAKE_MODE: "local",
        },
      }
    );
    expect(result.exitCode).toBe(0);
    const stage = JSON.parse(readFileSync(join(runDir, "stages", "scaffold.json"), "utf8")) as {
      checks: {name: string; status: string}[];
      status: string;
    };
    expect(stage.status).toBe("PASS");
    expect(stage.checks.find((check) => check.name === "backend-typecheck")?.status).toBe("PASS");
    expect(existsSync(join(runDir, "app", "backend", "package.json"))).toBe(true);
  });
});
