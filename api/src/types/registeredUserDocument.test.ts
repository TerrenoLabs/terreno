import {describe, expect, it} from "bun:test";
import fs from "node:fs";
import path from "node:path";

const apiRoot = path.resolve(__dirname, "../..");

const runFixture = (name: string): {exitCode: number; output: string} => {
  const project = path.join(apiRoot, "typeFixtures", name, "tsconfig.json");
  const result = Bun.spawnSync(["bun", "tsc", "--noEmit", "-p", project], {cwd: apiRoot});
  return {
    exitCode: result.exitCode ?? 1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

describe("registered user document passes through api types without a cast", () => {
  it("has built declarations to compile against", () => {
    expect(fs.existsSync(path.join(apiRoot, "dist/index.d.ts"))).toBe(true);
  });

  it("modelRouter accepts a user model with statics and methods", () => {
    const {exitCode, output} = runFixture("registeredUserDocument");
    expect(output).not.toMatch(/userDocument\.ts\(\d+,\d+\): error TS\d+.*(ModelLike|Model<)/);
    expect(exitCode).toBe(0);
  }, 180_000);

  it("changeUserPassword accepts the instanceAction doc, and rejects a non-user", () => {
    const {exitCode, output} = runFixture("registeredUserDocument");
    expect(output).not.toContain("TS2578");
    expect(output).not.toContain("changeUserPassword");
    expect(exitCode).toBe(0);
  }, 180_000);

  it("seedBetterAuthUser and syncBetterAuthUser resolve to the registered document", () => {
    const {exitCode, output} = runFixture("registeredUserDocument");
    expect(output).not.toContain("roles");
    expect(output).not.toContain("save");
    expect(exitCode).toBe(0);
  }, 180_000);
});
