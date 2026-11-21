import {describe, it} from "bun:test";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {assert} from "chai";

const script = join(import.meta.dir, "run-logged-parallel.sh");

const run = (args: string[]): {status: number | null; stdout: string} => {
  const result = spawnSync("sh", [script, ...args], {encoding: "utf8"});
  return {status: result.status, stdout: result.stdout};
};

describe("run-logged-parallel", () => {
  it("prints both logs and fails when one command fails", () => {
    const result = run(["ok=echo hello", "bad=echo boom && exit 3"]);
    assert.equal(result.status, 3);
    assert.include(result.stdout, "===== ok (exit 0) =====");
    assert.include(result.stdout, "hello");
    assert.include(result.stdout, "===== bad (exit 3) =====");
    assert.include(result.stdout, "boom");
  });

  it("exits 0 when every command exits 0", () => {
    const result = run(["a=echo one", "b=echo two"]);
    assert.equal(result.status, 0);
    assert.include(result.stdout, "one");
    assert.include(result.stdout, "two");
  });
});
