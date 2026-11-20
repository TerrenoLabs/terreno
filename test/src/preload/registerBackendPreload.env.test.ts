import {afterAll, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

// Runs in a child `bun test` so the fixture's preload is the only one registered, as in an
// app; this package's own preload would otherwise reset the env before the fixture's hooks.
const fixtureDir = mkdtempSync(join(tmpdir(), "terreno-preload-env-"));

afterAll(() => {
  rmSync(fixtureDir, {force: true, recursive: true});
});

describe("registerBackendPreload test env", () => {
  it("is applied before a test file's beforeAll, where apps are built", () => {
    const preload = join(fixtureDir, "preload.ts");
    writeFileSync(
      preload,
      `import {registerBackendPreload} from ${JSON.stringify(join(__dirname, "registerBackendPreload.ts"))};
registerBackendPreload({
  disableDb: true,
  sentryMock: false,
  silenceLogs: false,
  testEnv: {extra: {EARLY_ENV_MARKER: "set"}, tokenIssuer: "early-env.test"},
});
`
    );
    const testFile = join(fixtureDir, "env.test.ts");
    writeFileSync(
      testFile,
      `import {beforeAll, expect, it} from "bun:test";
let seen: Record<string, string | undefined> = {};
beforeAll(() => {
  seen = {issuer: process.env.TOKEN_ISSUER, marker: process.env.EARLY_ENV_MARKER, secret: process.env.TOKEN_SECRET};
});
it("sees the test env in beforeAll", () => {
  expect(seen).toEqual({issuer: "early-env.test", marker: "set", secret: "secret"});
});
`
    );

    const env = {...process.env};
    for (const key of ["TOKEN_ISSUER", "TOKEN_SECRET", "EARLY_ENV_MARKER"]) {
      delete env[key];
    }
    const result = Bun.spawnSync({
      cmd: [process.execPath, "test", "--preload", preload, testFile],
      cwd: fixtureDir,
      env,
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.stderr.toString()).toContain("1 pass");
    expect(result.exitCode).toBe(0);
  });
});
