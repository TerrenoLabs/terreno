#!/usr/bin/env bun
/**
 * `terreno-migrate` CLI: check, generate, status, up, and down. Production wet
 * up/down requires ALLOW_MIGRATIONS=true and `--force`.
 */
import {isAbsolute, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import type {Model, Document as MongooseDocument} from "mongoose";
import mongoose from "mongoose";

import {APIError} from "../errors";
import {logger} from "../logger";
import {generateMigration} from "./generate";
import {checkMigrationFiles} from "./load";
import {
  assertMigrationsAllowed,
  getMigrationStatus,
  runDownMigrations,
  runMigrations,
} from "./runner";

const USAGE = `Usage: terreno-migrate <command> [options]

Commands:
  check     Validate migration files (no Mongo)
  generate  Write a timestamped file from the model vs schemaAfter diff
  status    List applied and pending migrations
  up        Apply pending migrations
  down      Roll back applied migrations

Options:
  --dir <path>     Migration directory (default: ./migrations)
  --models <path>  Module exporting models or {models} (generate)
  --name <slug>    Filename slug for generate (default: auto)
  --dry            Call up/down with dryRun true; do not write history
  --force          Required for production wet up/down (with ALLOW_MIGRATIONS=true)
  --steps <n>      Number of applied migrations to roll back (down only, default 1)
  --help           Show this help
`;

export interface MigrateCliIo {
  write: (chunk: string) => void;
}

export interface RunMigrateCliOptions {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  mongoose?: typeof mongoose;
  stdout?: MigrateCliIo;
  stderr?: MigrateCliIo;
}

const writeLine = (io: MigrateCliIo, line: string): void => {
  io.write(`${line}\n`);
};

const errorMessage = (error: unknown): string => {
  if (error instanceof APIError) {
    return error.detail ? `${error.title}: ${error.detail}` : error.title;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isMongooseModel = (value: unknown): value is Model<MongooseDocument> => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  return "schema" in value && "modelName" in value;
};

const collectModels = (mod: unknown): Model<MongooseDocument>[] => {
  if (Array.isArray(mod)) {
    return mod.filter(isMongooseModel);
  }
  if (typeof mod !== "object" || mod === null) {
    return [];
  }
  const record = mod as Record<string, unknown>;
  if (Array.isArray(record.models)) {
    return record.models.filter(isMongooseModel);
  }
  return Object.values(record).filter(isMongooseModel);
};

const loadModelsModule = async (modulePath: string): Promise<Model<MongooseDocument>[]> => {
  const resolved = isAbsolute(modulePath) ? modulePath : resolve(modulePath);
  const imported = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  const fromDefault = collectModels(imported.default);
  if (fromDefault.length > 0) {
    return fromDefault;
  }
  return collectModels(imported);
};

export const runMigrateCli = async ({
  argv,
  env = process.env,
  mongoose: mongooseNs,
  stderr = {write: (chunk: string) => process.stderr.write(chunk)},
  stdout = {write: (chunk: string) => process.stdout.write(chunk)},
}: RunMigrateCliOptions): Promise<number> => {
  let values: {
    dir?: string;
    dry?: boolean;
    force?: boolean;
    help?: boolean;
    models?: string;
    name?: string;
    steps?: string;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      allowPositionals: true,
      args: argv,
      options: {
        dir: {type: "string"},
        dry: {default: false, type: "boolean"},
        force: {default: false, type: "boolean"},
        help: {default: false, type: "boolean"},
        models: {type: "string"},
        name: {type: "string"},
        steps: {type: "string"},
      },
      strict: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    writeLine(stderr, errorMessage(error));
    writeLine(stderr, USAGE);
    return 1;
  }

  if (values.help) {
    writeLine(stdout, USAGE);
    return 0;
  }

  const command = positionals[0];
  if (!command) {
    writeLine(stderr, USAGE);
    return 1;
  }

  const dir = values.dir ?? "./migrations";
  const dryRun = values.dry === true;
  const force = values.force === true;

  try {
    if (command === "check") {
      const loaded = await checkMigrationFiles({dir});
      writeLine(stdout, `OK ${loaded.length} migration(s)`);
      for (const migration of loaded) {
        writeLine(stdout, migration.id);
      }
      return 0;
    }

    if (command === "generate") {
      if (!values.models) {
        throw new APIError({
          detail: "Pass --models <module> that exports models",
          status: 400,
          title: "Missing --models",
        });
      }
      const models = await loadModelsModule(values.models);
      const result = await generateMigration({
        dir,
        models,
        name: values.name,
      });
      if (result.noop) {
        writeLine(stdout, "No schema changes");
        return 0;
      }
      writeLine(stdout, `Wrote ${result.path}`);
      return 0;
    }

    if (command !== "status" && command !== "up" && command !== "down") {
      writeLine(stderr, `Unknown command ${command}`);
      writeLine(stderr, USAGE);
      return 1;
    }

    if (command === "up" || command === "down") {
      assertMigrationsAllowed({
        allowEnv: env.ALLOW_MIGRATIONS === "true",
        dryRun,
        force,
        isProduction: env.NODE_ENV === "production",
      });
    }

    let connectedHere = false;
    const mongooseLib = mongooseNs ?? mongoose;
    if (mongooseNs == null) {
      const uri = env.MONGO_URI ?? env.MONGODB_URI;
      if (!uri) {
        throw new APIError({
          detail: "Set MONGO_URI or MONGODB_URI",
          status: 400,
          title: "Missing Mongo URI",
        });
      }
      await mongooseLib.connect(uri);
      connectedHere = true;
    }

    try {
      const migrations = await checkMigrationFiles({dir});
      const connection = mongooseLib.connection;

      if (command === "status") {
        const status = await getMigrationStatus({connection, migrations});
        writeLine(stdout, `Applied (${status.applied.length})`);
        for (const row of status.applied) {
          writeLine(stdout, row.id);
        }
        writeLine(stdout, `Pending (${status.pending.length})`);
        for (const row of status.pending) {
          writeLine(stdout, row.id);
        }
        return 0;
      }

      if (command === "up") {
        const result = await runMigrations({
          connection,
          dryRun,
          logger,
          migrations,
          mongoose: mongooseLib,
        });
        writeLine(
          stdout,
          dryRun ? `Dry-run applied ${result.applied.length}` : `Applied ${result.applied.length}`
        );
        for (const id of result.applied) {
          writeLine(stdout, id);
        }
        return 0;
      }

      const steps = values.steps == null ? 1 : Number(values.steps);
      const result = await runDownMigrations({
        connection,
        dryRun,
        logger,
        migrations,
        mongoose: mongooseLib,
        steps,
      });
      writeLine(
        stdout,
        dryRun ? `Dry-run reversed ${result.reversed.length}` : `Reversed ${result.reversed.length}`
      );
      for (const id of result.reversed) {
        writeLine(stdout, id);
      }
      return 0;
    } finally {
      if (connectedHere) {
        await mongooseLib.disconnect();
      }
    }
  } catch (error) {
    writeLine(stderr, errorMessage(error));
    return 1;
  }
};

if (Bun.main === __filename) {
  void runMigrateCli({argv: process.argv.slice(2)}).then((code) => {
    process.exit(code);
  });
}
