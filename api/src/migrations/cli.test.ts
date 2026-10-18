/**
 * Tests for `terreno-migrate` argv parsing and command behavior.
 */
import {beforeEach, describe, expect, it} from "bun:test";
import {mkdtemp, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import mongoose from "mongoose";

import {setupDb} from "../tests";
import {runMigrateCli} from "./cli";
import {MIGRATION_LOCK_ID, MIGRATIONS_COLLECTION} from "./types";

const fixtures = (...parts: string[]): string => {
  return join(import.meta.dir, "fixtures", ...parts);
};

const capture = (): {
  stderr: string;
  stdout: string;
  writeErr: (chunk: string) => void;
  writeOut: (chunk: string) => void;
} => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    get stderr(): string {
      return err.join("");
    },
    get stdout(): string {
      return out.join("");
    },
    writeErr: (chunk: string): void => {
      err.push(chunk);
    },
    writeOut: (chunk: string): void => {
      out.push(chunk);
    },
  };
};

const appliedIds = async (): Promise<string[]> => {
  const docs = await mongoose.connection
    .collection(MIGRATIONS_COLLECTION)
    .find({_id: {$ne: MIGRATION_LOCK_ID}})
    .project({id: 1})
    .toArray();
  return docs.map((doc) => String(doc.id)).sort();
};

describe("runMigrateCli", () => {
  beforeEach(async () => {
    await setupDb();
    await mongoose.connection.collection(MIGRATIONS_COLLECTION).deleteMany({});
  });

  it("prints usage when no command is given", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: [],
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(1);
    expect(io.stderr).toContain("terreno-migrate");
  });

  it("rejects unknown flags from parseArgs", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["check", "--bogus"],
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(1);
    expect(io.stderr).toContain("terreno-migrate");
  });

  it("rejects unknown commands", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["explode"],
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(1);
    expect(io.stderr).toContain("Unknown command explode");
  });

  it("requires a Mongo URI when mongoose is not injected", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["status", "--dir", fixtures("valid")],
      env: {},
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(1);
    expect(io.stderr).toContain("Missing Mongo URI");
  });

  it("prints usage on --help and exits 0", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["--help"],
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(0);
    expect(`${io.stdout}${io.stderr}`).toContain("terreno-migrate");
    expect(`${io.stdout}${io.stderr}`).toContain("check");
  });

  it("generate without --models exits 1", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["generate", "--dir", fixtures("valid")],
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(1);
    expect(io.stderr).toContain("Missing --models");
  });

  it("generate reports when the models module exports none", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-cli-gen-"));
    const modelsDir = await mkdtemp(join(tmpdir(), "migrate-cli-models-"));
    try {
      const modelsPath = join(modelsDir, "scalar.ts");
      await writeFile(modelsPath, "export default 1;\n");
      const namedPath = join(modelsDir, "named.ts");
      await writeFile(namedPath, "export const extra = {foo: 1};\n");
      const arrayPath = join(modelsDir, "array.ts");
      await writeFile(arrayPath, 'export default [{name: "not-a-model"}];\n');
      const bagPath = join(modelsDir, "bag.ts");
      await writeFile(bagPath, 'export default {models: [{name: "not-a-model"}]};\n');
      const fakeModelPath = join(modelsDir, "fake-model.ts");
      await writeFile(
        fakeModelPath,
        `export default [{
  collection: {collectionName: "fake_cli"},
  modelName: "FakeCliModel",
  schema: {indexes: () => [], paths: {}},
}];
`
      );

      for (const path of [modelsPath, namedPath, arrayPath, bagPath]) {
        const io = capture();
        const code = await runMigrateCli({
          argv: ["generate", "--dir", dir, "--models", path, "--name", "init"],
          stderr: {write: io.writeErr},
          stdout: {write: io.writeOut},
        });
        expect(code).toBe(1);
        expect(io.stderr).toContain("No Mongoose models found");
      }

      const fakeIo = capture();
      const fakeCode = await runMigrateCli({
        argv: ["generate", "--dir", dir, "--models", fakeModelPath, "--name", "init"],
        stderr: {write: fakeIo.writeErr},
        stdout: {write: fakeIo.writeOut},
      });
      expect(fakeCode).toBe(0);
      expect(fakeIo.stdout).toContain("No schema changes");
    } finally {
      await rm(dir, {force: true, recursive: true});
      await rm(modelsDir, {force: true, recursive: true});
    }
  });

  it("generate writes a migration file for real Mongoose models", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-cli-gen-"));
    const modelsDir = await mkdtemp(join(tmpdir(), "migrate-cli-models-"));
    try {
      const modelsPath = join(modelsDir, "models.ts");
      const mongooseUrl = import.meta.resolve("mongoose");
      await writeFile(
        modelsPath,
        `import mongoose from ${JSON.stringify(mongooseUrl)};

const schema = new mongoose.Schema(
  {title: {description: "Title", required: true, type: String}},
  {collection: "cli_gen_todos"}
);
export const CliGenTodo = mongoose.models.CliGenTodo ?? mongoose.model("CliGenTodo", schema);
`
      );

      const io = capture();
      const code = await runMigrateCli({
        argv: ["generate", "--dir", dir, "--models", modelsPath, "--name", "init"],
        stderr: {write: io.writeErr},
        stdout: {write: io.writeOut},
      });
      expect(io.stderr).toBe("");
      expect(code).toBe(0);
      expect(io.stdout).toMatch(/^Wrote .*-init\.ts\n$/);
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toEndWith("-init.ts");

      const checkIo = capture();
      expect(
        await runMigrateCli({
          argv: ["check", "--dir", dir],
          stderr: {write: checkIo.writeErr},
          stdout: {write: checkIo.writeOut},
        })
      ).toBe(0);
      expect(checkIo.stdout).toContain("OK 1 migration(s)");
    } finally {
      await rm(dir, {force: true, recursive: true});
      await rm(modelsDir, {force: true, recursive: true});
    }
  });

  it("writes help to process stdout when io is omitted", async () => {
    expect(await runMigrateCli({argv: ["--help"]})).toBe(0);
    expect(await runMigrateCli({argv: ["nope"]})).toBe(1);
  });

  it("check validates files without Mongo", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["check", "--dir", fixtures("valid")],
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(0);
    expect(io.stdout).toContain("20260910120000-alpha");
  });

  it("dry up calls pending files and does not write history", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["up", "--dir", fixtures("valid"), "--dry"],
      mongoose,
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(0);
    expect(io.stdout).toContain("20260910120000-alpha");
    expect(await appliedIds()).toEqual([]);
  });

  it("denies production wet up without ALLOW_MIGRATIONS", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["up", "--dir", fixtures("valid"), "--force"],
      env: {NODE_ENV: "production"},
      mongoose,
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(1);
    expect(io.stderr).toContain("Migrations not allowed");
    expect(await appliedIds()).toEqual([]);
  });

  it("denies production wet up when ALLOW_MIGRATIONS is set without --force", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["up", "--dir", fixtures("valid")],
      env: {ALLOW_MIGRATIONS: "true", NODE_ENV: "production"},
      mongoose,
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(1);
    expect(io.stderr).toContain("Migrations not allowed");
  });

  it("status lists pending files before up", async () => {
    const io = capture();
    const code = await runMigrateCli({
      argv: ["status", "--dir", fixtures("valid")],
      env: {NODE_ENV: "test"},
      mongoose,
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(0);
    expect(io.stdout).toContain("Pending (2)");
    expect(io.stdout).toContain("20260910120000-alpha");
  });

  it("applies then rolls back against Mongo", async () => {
    const upIo = capture();
    const upCode = await runMigrateCli({
      argv: ["up", "--dir", fixtures("valid")],
      env: {NODE_ENV: "test"},
      mongoose,
      stderr: {write: upIo.writeErr},
      stdout: {write: upIo.writeOut},
    });
    expect(upCode).toBe(0);
    expect(await appliedIds()).toEqual(["20260910120000-alpha", "20260910120001-beta"]);

    const downIo = capture();
    const downCode = await runMigrateCli({
      argv: ["down", "--dir", fixtures("valid"), "--steps", "1"],
      env: {NODE_ENV: "test"},
      mongoose,
      stderr: {write: downIo.writeErr},
      stdout: {write: downIo.writeOut},
    });
    expect(downCode).toBe(0);
    expect(await appliedIds()).toEqual(["20260910120000-alpha"]);

    const statusIo = capture();
    const statusCode = await runMigrateCli({
      argv: ["status", "--dir", fixtures("valid")],
      env: {NODE_ENV: "test"},
      mongoose,
      stderr: {write: statusIo.writeErr},
      stdout: {write: statusIo.writeOut},
    });
    expect(statusCode).toBe(0);
    expect(statusIo.stdout).toContain("Applied (1)\n20260910120000-alpha\n");
    expect(statusIo.stdout).toContain("Pending (1)\n20260910120001-beta\n");
  });

  it("fails down when the target file has no down", async () => {
    await runMigrateCli({
      argv: ["up", "--dir", fixtures("valid")],
      env: {NODE_ENV: "test"},
      mongoose,
      stderr: {write: () => undefined},
      stdout: {write: () => undefined},
    });
    await runMigrateCli({
      argv: ["down", "--dir", fixtures("valid"), "--steps", "1"],
      env: {NODE_ENV: "test"},
      mongoose,
      stderr: {write: () => undefined},
      stdout: {write: () => undefined},
    });

    const io = capture();
    const code = await runMigrateCli({
      argv: ["down", "--dir", fixtures("valid"), "--steps", "1"],
      env: {NODE_ENV: "test"},
      mongoose,
      stderr: {write: io.writeErr},
      stdout: {write: io.writeOut},
    });
    expect(code).toBe(1);
    expect(io.stderr).toContain("has no down");
    expect(await appliedIds()).toEqual(["20260910120000-alpha"]);
  });
});
