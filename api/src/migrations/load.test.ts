/**
 * Tests for loading timestamped migration files (order, id match, required `up`).
 */
import {describe, expect, it} from "bun:test";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {APIError} from "../errors";
import {checkMigrationFiles, loadMigrations, resolveMigrationDir} from "./load";

const fixtures = (...parts: string[]): string => {
  return join(__dirname, "fixtures", ...parts);
};

describe("checkMigrationFiles", () => {
  it("loads timestamped files in filename order with optional down", async () => {
    const loaded = await checkMigrationFiles({dir: fixtures("valid")});
    expect(loaded.map((m) => m.id)).toEqual(["20260910120000-alpha", "20260910120001-beta"]);
    expect(typeof loaded[0].up).toBe("function");
    expect(loaded[0].down).toBeUndefined();
    expect(typeof loaded[1].down).toBe("function");
    expect(loaded[0].checksum).toHaveLength(64);
  });

  it("rejects an id that does not match the filename", async () => {
    await expect(checkMigrationFiles({dir: fixtures("bad-id")})).rejects.toThrow(
      "Migration id does not match filename"
    );
  });

  it("rejects a filename that is not YYYYMMDDHHmmss-slug.ts", async () => {
    await expect(checkMigrationFiles({dir: fixtures("bad-name")})).rejects.toThrow(
      "Invalid migration filename"
    );
  });

  it("rejects a module without up", async () => {
    await expect(checkMigrationFiles({dir: fixtures("missing-up")})).rejects.toThrow(
      "Migration missing up"
    );
  });

  it("maps a missing directory to a 404 APIError", async () => {
    try {
      await checkMigrationFiles({dir: join(tmpdir(), "terreno-migrations-missing-dir")});
      throw new Error("expected checkMigrationFiles to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      expect((error as APIError).status).toBe(404);
      expect((error as APIError).message).toBe("Migration directory not found");
    }
  });

  it("loads from MIGRATIONS_DIR when dir is on $bunfs", async () => {
    const root = await mkdtemp(join(tmpdir(), "terreno-migrations-bunfs-"));
    const dir = join(root, "migrations");
    await mkdir(dir);
    await writeFile(
      join(dir, "20260910120000-from-env.ts"),
      'export const id = "20260910120000-from-env";\nexport const up = async () => {};\n'
    );
    process.env.MIGRATIONS_DIR = dir;
    try {
      const loaded = await checkMigrationFiles({dir: "/$bunfs/migrations"});
      expect(loaded.map((migration) => migration.id)).toEqual(["20260910120000-from-env"]);
    } finally {
      Reflect.deleteProperty(process.env, "MIGRATIONS_DIR");
      await rm(root, {force: true, recursive: true});
    }
  });
});

describe("resolveMigrationDir", () => {
  it("keeps a real on-disk dir", () => {
    expect(resolveMigrationDir({dir: "/app/migrations", envDir: "/env/migrations"})).toBe(
      "/app/migrations"
    );
  });

  it("does not keep a $bunfs dir; uses MIGRATIONS_DIR then cwd/migrations", () => {
    expect(
      resolveMigrationDir({
        cwd: "/app",
        dir: "/$bunfs/migrations",
        envDir: "/app/migrations",
      })
    ).toBe("/app/migrations");
    expect(
      resolveMigrationDir({cwd: "/app", dir: "file:///$bunfs/root/src/migrationsDir.ts"})
    ).toBe("/app/migrations");
  });
});

describe("loadMigrations", () => {
  it("aliases checkMigrationFiles", async () => {
    const loaded = await loadMigrations({dir: fixtures("valid")});
    expect(loaded.map((migration) => migration.id)).toEqual([
      "20260910120000-alpha",
      "20260910120001-beta",
    ]);
  });
});
