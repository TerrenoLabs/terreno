/**
 * Isolated because `runMigrateCli` disconnects the default mongoose connection
 * when it opens Mongo from a URI. Sharing that with the rest of `bun test` races
 * org/notification/MCP suites.
 */
import {describe, it} from "bun:test";
import {join} from "node:path";
import {assert} from "chai";
import mongoose from "mongoose";
import {runMigrateCli} from "../migrations/cli";
import {setupDb} from "../tests";

const fixtures = (...parts: string[]): string => {
  return join(import.meta.dir, "..", "migrations", "fixtures", ...parts);
};

describe("runMigrateCli Mongo URI connect", () => {
  it("connects and disconnects itself when given a Mongo URI", async () => {
    await setupDb();
    const {host, name, port} = mongoose.connection;
    const uri = `mongodb://${host}:${port}/${name}`;
    await mongoose.disconnect();
    assert.equal(mongoose.connection.readyState, 0);

    try {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runMigrateCli({
        argv: ["status", "--dir", fixtures("valid")],
        env: {MONGODB_URI: uri, NODE_ENV: "test"},
        stderr: {
          write: (chunk: string): void => {
            err.push(chunk);
          },
        },
        stdout: {
          write: (chunk: string): void => {
            out.push(chunk);
          },
        },
      });
      assert.equal(code, 0);
      assert.include(out.join(""), "Applied (0)");
      assert.include(out.join(""), "Pending (2)");
      assert.equal(err.join(""), "");
      assert.equal(mongoose.connection.readyState, 0);
    } finally {
      await mongoose.connect(uri);
    }
  });
});
