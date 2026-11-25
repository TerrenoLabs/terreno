import {describe, expect, it} from "bun:test";
import fs from "node:fs";
import path from "node:path";

const apiRoot = path.resolve(__dirname, "../..");

// One tsc run over the fixture project; each case is a fixture file with no diagnostics.
let cachedOutput: string | undefined;
const compileFixtures = (): string => {
  if (cachedOutput !== undefined) {
    return cachedOutput;
  }
  for (const required of ["api/dist/index.d.ts", "comms/dist/index.d.ts"]) {
    if (!fs.existsSync(path.join(apiRoot, "..", required))) {
      throw new Error(
        `${required} is missing; run \`bun run --cwd api compile\` and \`bun run comms:compile\` first`
      );
    }
  }
  const project = path.join(apiRoot, "typeFixtures", "registeredUser", "tsconfig.json");
  const result = Bun.spawnSync(["bun", "tsc", "--noEmit", "-p", project], {cwd: apiRoot});
  cachedOutput = `${result.stdout.toString()}${result.stderr.toString()}`;
  return cachedOutput;
};

const diagnosticsFor = (file: string): string[] =>
  compileFixtures()
    .split("\n")
    .filter((line) => line.includes(`${file}(`));

describe("TerrenoUserModel on userModel options", () => {
  it("accepts a plain Mongoose user model on all seven options with no cast", () => {
    const diagnostics = diagnosticsFor("userModel.ts");
    expect(diagnostics).toEqual([]);
  }, 180_000);

  it("still accepts a passport-local-mongoose model type", () => {
    const diagnostics = diagnosticsFor("userModelPassport.ts");
    expect(diagnostics).toEqual([]);
  }, 180_000);

  it("keeps UserModel as an alias of PassportUserModel", () => {
    const diagnostics = diagnosticsFor("userModelAlias.ts");
    expect(diagnostics).toEqual([]);
  }, 180_000);
});
