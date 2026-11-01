import {afterAll, afterEach, beforeEach, describe, test} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {assert} from "chai";
import {generateAllFiles} from "../generate.js";

/**
 * Runs the generated backend/src/utils/betterAuthConfig.ts against the real @terreno/api. The
 * generated file imports `@terreno/api`; the copy here imports the workspace source instead, so
 * the test needs no compiled api package.
 */
interface GeneratedBetterAuthConfigModule {
  buildBetterAuthConfig: () => Record<string, unknown> | undefined;
  getWebOrigins: () => string[];
}

const API_SOURCE = resolve(import.meta.dir, "../../../api/src/index.ts");
const ENV_KEYS = [
  "AUTH_ACCOUNT_LINKING",
  "AUTH_PROVIDER",
  "AUTH_SIGN_UP",
  "BETTER_AUTH_SECRET",
  "CORS_ORIGINS",
  "FRONTEND_URL",
  "NODE_ENV",
  "PASSKEY_RP_ID",
] as const;

const generated = generateAllFiles({appDisplayName: "Config App", appName: "config-app"}).find(
  (file) => file.path === "backend/src/utils/betterAuthConfig.ts"
);
if (!generated) {
  throw new Error("generator did not emit backend/src/utils/betterAuthConfig.ts");
}

const tempDir = mkdtempSync(join(tmpdir(), "cta-generated-config-"));
const configPath = join(tempDir, "betterAuthConfig.ts");
writeFileSync(
  configPath,
  generated.content.replace('from "@terreno/api"', `from ${JSON.stringify(API_SOURCE)}`)
);
let generatedConfig: GeneratedBetterAuthConfigModule;
try {
  generatedConfig = (await import(configPath)) as GeneratedBetterAuthConfigModule;
} catch (error) {
  rmSync(tempDir, {force: true, recursive: true});
  throw error;
}

const savedEnv = new Map<string, string | undefined>();

const setEnv = (values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void => {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
};

describe("generated buildBetterAuthConfig", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    setEnv({BETTER_AUTH_SECRET: "generated-config-test-secret-0123456789"});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  afterAll(() => {
    rmSync(tempDir, {force: true, recursive: true});
  });

  test("dev defaults turn on the whole suite with passkeys on localhost", () => {
    const config = generatedConfig.buildBetterAuthConfig();

    assert.deepEqual(config?.accountLinking, {mode: "verified-email"});
    assert.deepEqual(config?.signUp, {mode: "open"});
    assert.deepEqual(config?.twoFactor, {issuer: "Config App", trustDeviceDays: 30});
    assert.isTrue(config?.lastLoginMethod);
    assert.deepEqual(config?.multiSession, {});
    assert.isTrue(config?.nativeApps);
    assert.equal(config?.publicAppUrl, "http://localhost:8082");
    assert.deepEqual(config?.passkey, {
      origin: ["http://localhost:8082"],
      rpID: "localhost",
      rpName: "Config App",
    });
  });

  test("production on a loopback FRONTEND_URL leaves passkeys off", () => {
    setEnv({NODE_ENV: "production"});

    const config = generatedConfig.buildBetterAuthConfig();

    assert.notProperty(config, "passkey");
    assert.deepEqual(config?.twoFactor, {issuer: "Config App", trustDeviceDays: 30});
  });

  test("production with PASSKEY_RP_ID binds passkeys to the parent domain", () => {
    setEnv({
      CORS_ORIGINS: "https://admin.example.com,https://other.test",
      FRONTEND_URL: "https://app.example.com",
      NODE_ENV: "production",
      PASSKEY_RP_ID: "example.com",
    });

    const config = generatedConfig.buildBetterAuthConfig();

    assert.deepEqual(config?.passkey, {
      origin: ["https://app.example.com", "https://admin.example.com"],
      rpID: "example.com",
      rpName: "Config App",
    });
    assert.equal(config?.publicAppUrl, "https://app.example.com");
  });

  test("FRONTEND_URL's origin joins CORS and trustedOrigins", () => {
    setEnv({FRONTEND_URL: "https://app.example.com/welcome"});

    const config = generatedConfig.buildBetterAuthConfig();

    assert.include(generatedConfig.getWebOrigins(), "https://app.example.com");
    assert.include(config?.trustedOrigins as string[], "https://app.example.com");
    assert.include(config?.trustedOrigins as string[], "config-app://");
  });

  test("AUTH_SIGN_UP=closed closes sign-up", () => {
    setEnv({AUTH_SIGN_UP: "closed"});

    assert.deepEqual(generatedConfig.buildBetterAuthConfig()?.signUp, {mode: "closed"});
  });

  test("AUTH_ACCOUNT_LINKING=never turns linking off", () => {
    setEnv({AUTH_ACCOUNT_LINKING: "never"});

    assert.deepEqual(generatedConfig.buildBetterAuthConfig()?.accountLinking, {mode: "never"});
  });

  test("an unknown AUTH_SIGN_UP refuses to start", () => {
    setEnv({AUTH_SIGN_UP: "bogus"});

    assert.throws(
      () => generatedConfig.buildBetterAuthConfig(),
      "AUTH_SIGN_UP must be open or closed"
    );
  });

  test("AUTH_PROVIDER=jwt returns no Better Auth config", () => {
    setEnv({AUTH_PROVIDER: "jwt"});

    assert.isUndefined(generatedConfig.buildBetterAuthConfig());
  });
});
