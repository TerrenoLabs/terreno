import isEqual from "lodash/isEqual";

import type {UserModel} from "./auth";
import type {BetterAuthUser} from "./betterAuth";
import {type BetterAuthInstance, syncBetterAuthUser} from "./betterAuthSetup";
import {APIError, errorMessage} from "./errors";
import {logger, type ScopedLogger} from "./logger";

export type SeedMode = "reset" | "sync";
export type SeedChange = "created" | "deleted" | "unchanged" | "updated";

interface SeedDocument {
  get: (path: string) => unknown;
  save: () => Promise<unknown>;
  set: (pathOrValues: object, value?: unknown) => unknown;
}

/** The small structural subset of a Mongoose model used by seed helpers. */
export interface SeedModel {
  new (): SeedDocument;
  modelName: string;
  countDocuments: (filter: Record<string, unknown>) => PromiseLike<number>;
  deleteMany: (filter: Record<string, unknown>) => PromiseLike<unknown>;
  find: (filter: Record<string, unknown>) => {
    limit: (limit: number) => PromiseLike<SeedDocument[]>;
  };
}

export interface SeedChangeResult {
  change: SeedChange;
  count: number;
  key: string;
  model: string;
}

export interface SeedContext {
  dryRun: boolean;
  mode: SeedMode;
  changes: SeedChangeResult[];
  deleteMany: (model: SeedModel, filter?: Record<string, unknown>) => Promise<SeedChangeResult>;
  upsert: <TValues extends object>(
    model: SeedModel,
    key: Record<string, unknown>,
    values: TValues
  ) => Promise<SeedChangeResult>;
}

export interface SeedStep {
  name: string;
  description?: string;
  dependsOn?: string[];
  reset?: (context: SeedContext) => Promise<void>;
  run: (context: SeedContext) => Promise<void>;
}

export interface SeedRunOptions {
  name: string;
  steps: SeedStep[];
  mode?: SeedMode;
  dryRun?: boolean;
  only?: string[];
  force?: boolean;
  allowProductionReset?: boolean | (() => boolean | Promise<boolean>);
  connect?: () => Promise<void>;
  disconnect?: () => Promise<void>;
  log?: ScopedLogger;
}

export interface SeedRunResult {
  changes: SeedChangeResult[];
  dryRun: boolean;
  mode: SeedMode;
  name: string;
  steps: string[];
  summary: Record<SeedChange, number>;
  success: boolean;
}

export interface SeedCliOptions extends Omit<SeedRunOptions, "dryRun" | "force" | "mode" | "only"> {
  argv?: string[];
}

export interface SeedCliResult {
  exitCode: number;
  help?: string;
  result?: SeedRunResult;
}

export interface BetterAuthSeedUser {
  email: string;
  name: string;
  password: string;
}

const EMPTY_SUMMARY: Record<SeedChange, number> = {
  created: 0,
  deleted: 0,
  unchanged: 0,
  updated: 0,
};

const formatKey = (key: Record<string, unknown>): string => {
  return JSON.stringify(key);
};

const toComparableSeedValue = (value: unknown): unknown => {
  if (value == null) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([entryKey, nested]) => [
        String(entryKey),
        toComparableSeedValue(nested),
      ])
    );
  }
  if (typeof (value as {toObject?: () => unknown}).toObject === "function") {
    return toComparableSeedValue((value as {toObject: () => unknown}).toObject());
  }
  if (Array.isArray(value)) {
    return value.map(toComparableSeedValue);
  }
  if (typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [field, nested] of Object.entries(value as Record<string, unknown>)) {
      if (field === "_id") {
        continue;
      }
      next[field] = toComparableSeedValue(nested);
    }
    return next;
  }
  return value;
};

const seedValuesEqual = (currentValues: unknown, nextValues: unknown): boolean => {
  return isEqual(toComparableSeedValue(currentValues), toComparableSeedValue(nextValues));
};

/**
 * Create a Better Auth credential user when missing, verify existing credentials,
 * and reconcile the corresponding application user document.
 */
export const seedBetterAuthUser = async ({
  auth,
  user,
  userModel,
}: {
  auth: BetterAuthInstance;
  user: BetterAuthSeedUser;
  userModel: UserModel;
}): Promise<Awaited<ReturnType<typeof syncBetterAuthUser>>> => {
  let authUser: BetterAuthUser | undefined;
  try {
    const result = await auth.api.signUpEmail({body: user});
    authUser = result.user as BetterAuthUser;
  } catch {
    const result = await auth.api.signInEmail({
      body: {email: user.email, password: user.password},
    });
    authUser = result.user as BetterAuthUser;
  }
  if (!authUser) {
    throw new APIError({
      detail: user.email,
      status: 500,
      title: "Better Auth seed returned no user",
    });
  }
  // The seed knows the plaintext password, so it can claim a legacy User whose passport hash
  // matches, the same way a real sign-up does.
  return syncBetterAuthUser(userModel, authUser, undefined, {password: user.password});
};

const selectSteps = (steps: SeedStep[], only?: string[]): SeedStep[] => {
  const stepByName = new Map(steps.map((step) => [step.name, step]));
  if (stepByName.size !== steps.length) {
    throw new APIError({status: 500, title: "Seed step names must be unique"});
  }
  if (!only || only.length === 0) {
    return steps;
  }

  const selectedNames = new Set<string>();
  const include = (name: string, ancestry: string[] = []): void => {
    const step = stepByName.get(name);
    if (!step) {
      throw new APIError({
        detail: `Unknown seed step "${name}". Available steps: ${steps.map((item) => item.name).join(", ")}`,
        status: 400,
        title: "Unknown seed step",
      });
    }
    if (ancestry.includes(name)) {
      throw new APIError({
        detail: [...ancestry, name].join(" -> "),
        status: 500,
        title: "Seed step dependency cycle",
      });
    }
    if (selectedNames.has(name)) {
      return;
    }
    for (const dependency of step.dependsOn ?? []) {
      include(dependency, [...ancestry, name]);
    }
    selectedNames.add(name);
  };

  for (const name of only) {
    include(name);
  }
  return steps.filter((step) => selectedNames.has(step.name));
};

const isProductionResetAllowed = async ({
  allowProductionReset,
  force,
}: Pick<SeedRunOptions, "allowProductionReset" | "force">): Promise<boolean> => {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  if (!force || allowProductionReset === undefined) {
    return false;
  }
  return typeof allowProductionReset === "function"
    ? await allowProductionReset()
    : allowProductionReset;
};

const makeContext = ({dryRun, mode}: {dryRun: boolean; mode: SeedMode}): SeedContext => {
  const changes: SeedChangeResult[] = [];
  const record = (change: SeedChangeResult): SeedChangeResult => {
    changes.push(change);
    return change;
  };

  return {
    changes,
    deleteMany: async (
      model: SeedModel,
      filter: Record<string, unknown> = {}
    ): Promise<SeedChangeResult> => {
      const count = await model.countDocuments(filter);
      if (!dryRun && count > 0) {
        await model.deleteMany(filter);
      }
      return record({
        change: count > 0 ? "deleted" : "unchanged",
        count,
        key: formatKey(filter),
        model: model.modelName,
      });
    },
    dryRun,
    mode,
    upsert: async <TValues extends object>(
      model: SeedModel,
      key: Record<string, unknown>,
      values: TValues
    ): Promise<SeedChangeResult> => {
      const findByKey = async (filter: Record<string, unknown>): Promise<SeedDocument[]> => {
        return [...(await model.find(filter).limit(100))];
      };

      let documents = await findByKey(key);
      if (documents.length === 0) {
        documents = await findByKey({...key, deleted: true});
      }

      const extras = documents.slice(1);
      if (extras.length > 0) {
        if (!dryRun) {
          for (const extra of extras) {
            const extraDeleted = extra.get("deleted");
            if (extraDeleted === true || extraDeleted === false) {
              extra.set({deleted: true});
              await extra.save();
            } else {
              await model.deleteMany({_id: extra.get("_id")});
            }
          }
        }
        record({
          change: "deleted",
          count: extras.length,
          key: formatKey(key),
          model: model.modelName,
        });
      }

      const document = documents[0];
      if (!document) {
        if (!dryRun) {
          const createdDocument = new model();
          createdDocument.set(key);
          createdDocument.set(values);
          await createdDocument.save();
        }
        return record({
          change: "created",
          count: 1,
          key: formatKey(key),
          model: model.modelName,
        });
      }

      const isDeleted = document.get("deleted") === true;
      const currentValues = Object.fromEntries(
        Object.keys(values).map((field) => [field, document.get(field)])
      );
      if (!isDeleted && seedValuesEqual(currentValues, values)) {
        return record({
          change: "unchanged",
          count: 1,
          key: formatKey(key),
          model: model.modelName,
        });
      }
      if (!dryRun) {
        document.set(isDeleted ? {...values, deleted: false} : values);
        await document.save();
      }
      return record({
        change: "updated",
        count: 1,
        key: formatKey(key),
        model: model.modelName,
      });
    },
  };
};

const summarizeChanges = (changes: SeedChangeResult[]): Record<SeedChange, number> => {
  const summary = {...EMPTY_SUMMARY};
  for (const item of changes) {
    summary[item.change] += item.count;
  }
  return summary;
};

/** Run an ordered, idempotent seed plan in sync or reset-and-reseed mode. */
export const runSeeds = async (options: SeedRunOptions): Promise<SeedRunResult> => {
  const mode = options.mode ?? "sync";
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? logger;
  const steps = selectSteps(options.steps, options.only);
  if (
    mode === "reset" &&
    !(await isProductionResetAllowed({
      allowProductionReset: options.allowProductionReset,
      force: options.force,
    }))
  ) {
    throw new APIError({
      detail:
        "Production resets require force: true and allowProductionReset: true (or an approving callback).",
      status: 403,
      title: "Production seed reset is disabled",
    });
  }

  const context = makeContext({dryRun, mode});
  await options.connect?.();
  try {
    log.info(
      `${dryRun ? "Previewing" : "Running"} ${options.name} seeds in ${mode} mode (${steps.length} step(s))`
    );
    if (mode === "reset") {
      for (const step of [...steps].reverse()) {
        await step.reset?.(context);
      }
    }
    for (const step of steps) {
      log.info(`Seed step: ${step.name}`);
      await step.run(context);
    }
    const summary = summarizeChanges(context.changes);
    log.info(
      `Seed complete: created=${summary.created} updated=${summary.updated} deleted=${summary.deleted} unchanged=${summary.unchanged}`
    );
    return {
      changes: context.changes,
      dryRun,
      mode,
      name: options.name,
      steps: steps.map((step) => step.name),
      success: true,
      summary,
    };
  } finally {
    await options.disconnect?.();
  }
};

const seedHelp = (name: string, steps: SeedStep[]): string => {
  return [
    `Usage: ${name} [--reset] [--dry-run] [--only <step>] [--force]`,
    "",
    "Modes:",
    "  (default)  Sync code-defined seed data into the database",
    "  --reset    Run step reset handlers in reverse order, then reseed",
    "",
    "Options:",
    "  --dry-run  Report changes without writing",
    "  --only     Run one step plus its dependencies; may be repeated",
    "  --force    Required with an explicitly allowed production reset",
    "  --help     Show this help",
    "",
    `Steps: ${steps.map((step) => step.name).join(", ")}`,
  ].join("\n");
};

const readRepeatedOption = (argv: string[], name: string): string[] => {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === `--${name}` && argv[index + 1]) {
      values.push(argv[index + 1]);
      index++;
      continue;
    }
    if (token.startsWith(`--${name}=`)) {
      values.push(token.slice(name.length + 3));
    }
  }
  return values;
};

/** CLI adapter for runSeeds. It returns an exit code and never terminates the process. */
export const runSeedCli = async (options: SeedCliOptions): Promise<SeedCliResult> => {
  const argv = options.argv ?? process.argv.slice(2);
  const help = seedHelp(options.name, options.steps);
  if (argv.includes("--help") || argv.includes("-h")) {
    return {exitCode: 0, help};
  }
  const knownOptions = new Set(["--dry-run", "--force", "--help", "-h", "--only", "--reset"]);
  const unknown = argv.filter(
    (token, index) =>
      token.startsWith("-") &&
      !knownOptions.has(token) &&
      !token.startsWith("--only=") &&
      argv[index - 1] !== "--only"
  );
  if (unknown.length > 0) {
    return {exitCode: 2, help: `Unknown option(s): ${unknown.join(", ")}\n\n${help}`};
  }

  try {
    const result = await runSeeds({
      ...options,
      dryRun: argv.includes("--dry-run"),
      force: argv.includes("--force"),
      mode: argv.includes("--reset") ? "reset" : "sync",
      only: readRepeatedOption(argv, "only"),
    });
    return {exitCode: 0, result};
  } catch (error: unknown) {
    (options.log ?? logger).error(`Seed failed: ${errorMessage(error)}`);
    return {exitCode: 1};
  }
};
