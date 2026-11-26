import {describe, test} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {assert} from "chai";
import {generateAllFiles} from "../generate.js";

const files = generateAllFiles({appDisplayName: "My App", appName: "my-app"});

const fileAt = (path: string): string => {
  const found = files.find((file) => file.path === path);
  if (!found) {
    throw new Error(`generator did not emit ${path}`);
  }
  return found.content;
};

const SECRET_LINE = /^(TOKEN_SECRET|TOKEN_ISSUER|REFRESH_TOKEN_SECRET|SESSION_SECRET)=/m;

describe("generated Better Auth-only backend", () => {
  test("user model does not use passport", () => {
    assert.notInclude(fileAt("backend/src/models/user.ts").toLowerCase(), "passport");
  });

  test("user types do not reference passport-local-mongoose", () => {
    assert.notInclude(fileAt("backend/src/types/models/userTypes.ts"), "passport-local-mongoose");
  });

  test("server file passes legacyAuth: false", () => {
    assert.include(fileAt("backend/src/server.ts"), "legacyAuth: false");
  });

  test("backend/package.json does not depend on passport-local-mongoose", () => {
    const pkg = JSON.parse(fileAt("backend/package.json")) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.notProperty(pkg.dependencies, "passport-local-mongoose");
    assert.notProperty(pkg.devDependencies ?? {}, "passport-local-mongoose");
  });

  test("backend/.env has no legacy JWT or session secrets", () => {
    assert.notMatch(fileAt("backend/.env"), SECRET_LINE);
  });

  test("backend/.env.example has no legacy JWT or session secrets", () => {
    assert.notMatch(fileAt("backend/.env.example"), SECRET_LINE);
  });

  test("backend/.env.example keeps PORT and drops no non-secret setting", () => {
    const example = fileAt("backend/.env.example");
    assert.match(example, /^PORT=8080$/m);
    assert.match(example, /^NODE_ENV=production$/m);
    assert.notMatch(example, /^REFRESH_PORT=/m);
  });

  test("no generated backend file sets the legacy secrets", () => {
    const offenders = files
      .filter((file) => file.path.startsWith("backend/") && SECRET_LINE.test(file.content))
      .map((file) => file.path);
    assert.deepEqual(offenders, []);
  });

  test("no generated frontend file references a legacy auth route or hook", () => {
    const forbidden = [
      "/auth/login",
      "refresh_token",
      "usePostAuthForgotPasswordMutation",
      "usePostResetPasswordMutation",
    ];
    const offenders = files
      .filter((file) => file.path.startsWith("frontend/"))
      .flatMap((file) =>
        forbidden
          .filter((term) => file.content.includes(term))
          .map((term) => `${file.path}: ${term}`)
      );
    assert.deepEqual(offenders, []);
  });

  test("seed still creates the admin through Better Auth", () => {
    const seed = fileAt("backend/src/scripts/seed.ts");
    assert.include(seed, "seedBetterAuthUser");
    assert.notInclude(seed.toLowerCase(), "passport");
    assert.notInclude(seed, "register(");
  });

  test("deploy docs call the JWT secrets legacy-only", () => {
    const doc = readFileSync(
      resolve(__dirname, "../../../docs/how-to/deploy-backend-to-cloud-run.md"),
      "utf8"
    );
    const lines = doc.split("\n").filter((line) => line.includes("TOKEN_SECRET"));
    assert.isAbove(lines.length, 0);
    assert.isTrue(
      lines.every((line) => /legacyAuth/.test(line)),
      `every TOKEN_SECRET line must mention legacyAuth:\n${lines.join("\n")}`
    );
  });
});
