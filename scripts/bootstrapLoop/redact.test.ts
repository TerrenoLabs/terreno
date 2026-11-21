import {afterEach, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {collectEnvFileValues, redact} from "./redact";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, {force: true, recursive: true});
  }
});

describe("redact", () => {
  it("replaces a value found in the app's .env file", () => {
    const app = mkdtempSync(join(tmpdir(), "redact-"));
    dirs.push(app);
    mkdirSync(join(app, "backend"));
    writeFileSync(join(app, "backend", ".env"), "BETTER_AUTH_SECRET=s3cr3t\n");
    const values = collectEnvFileValues(app);
    expect(redact("secret is s3cr3t here", {}, values)).toBe("secret is [redacted] here");
  });

  it("replaces the password inside a connection string", () => {
    expect(redact("mongodb://u:p@host/db", {})).toBe("mongodb://u:[redacted]@host/db");
  });

  it("replaces the value of a secret-named env var", () => {
    expect(redact("token abc123", {GH_TOKEN: "abc123"})).toBe("token [redacted]");
  });

  it("leaves values of vars that do not look secret", () => {
    expect(redact("port 4000", {PORT: "4000"})).toBe("port 4000");
  });

  it("does not replace empty values", () => {
    expect(redact("nothing here", {GH_TOKEN: ""})).toBe("nothing here");
  });

  it("redacts a *_URI var only when it holds credentials", () => {
    expect(redact("mongodb://a:b@h and plain", {DB_URI: "mongodb://a:b@h"})).toBe(
      "[redacted] and plain"
    );
    expect(redact("http://example.com", {SITE_URL: "http://example.com"})).toBe(
      "http://example.com"
    );
  });
});
