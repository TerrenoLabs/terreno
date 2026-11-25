import {describe, expect, it} from "bun:test";
import fs from "node:fs";
import path from "node:path";

const apiRoot = path.resolve(__dirname, "../..");

const runFixture = (name: string): {exitCode: number; output: string} => {
  const project = path.join(apiRoot, "typeFixtures", name, "tsconfig.json");
  const result = Bun.spawnSync(["bun", "tsc", "--noEmit", "-p", project], {
    cwd: apiRoot,
  });
  return {
    exitCode: result.exitCode ?? 1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

describe("TerrenoRegister consumer fixtures", () => {
  it("has built declarations to compile against", () => {
    if (!fs.existsSync(path.join(apiRoot, "dist/index.d.ts"))) {
      throw new Error("api/dist/index.d.ts is missing; run `bun run --cwd api compile` first");
    }
  });

  it("an augmented consumer sees the app user type", () => {
    const {exitCode, output} = runFixture("registeredUser");
    if (exitCode !== 0) {
      console.error(output);
    }
    expect(exitCode).toBe(0);
  }, 120_000);

  it("an unaugmented consumer gets RegisteredUser equal to User", () => {
    const {exitCode, output} = runFixture("unregisteredUser");
    if (exitCode !== 0) {
      console.error(output);
    }
    expect(exitCode).toBe(0);
  }, 120_000);
});
