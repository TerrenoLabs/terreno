import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {resolveTerrenoProjectRoot} from "../projectRoot.js";
import {withLocalMongoDb} from "./localMongo.js";

const readEnvValue = (envPath: string, key: string): string | undefined => {
  if (!existsSync(envPath)) {
    return undefined;
  }
  const text = readFileSync(envPath, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const k = trimmed.slice(0, eq).trim();
    if (k !== key) {
      continue;
    }
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return undefined;
};

const FORBIDDEN_AGG_KEYS = new Set(["$out", "$merge", "$function"]);

/** Operators that must not appear anywhere in a `find`-style filter document. */
const FORBIDDEN_FILTER_KEYS = new Set(["$where", "$function", "$accumulator"]);

const QUERY_MAX_TIME_MS = 10_000;

const aggregateContainsForbidden = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(aggregateContainsForbidden);
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AGG_KEYS.has(key)) {
      return true;
    }
    if (aggregateContainsForbidden(child)) {
      return true;
    }
  }
  return false;
};

const filterContainsForbidden = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(filterContainsForbidden);
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FILTER_KEYS.has(key)) {
      return true;
    }
    if (filterContainsForbidden(child)) {
      return true;
    }
  }
  return false;
};

const ALLOWED = new Set(["find", "aggregate", "countDocuments", "distinct"]);

/** Exported for unit tests; local `database_query` rejects filters that include these operators. */
/** @internal */
export const databaseQueryFilterUsesForbiddenOperators = (filter: unknown): boolean => {
  return filterContainsForbidden(filter ?? {});
};

export interface DatabaseQueryArgs {
  collection: string;
  operation: string;
  filter?: unknown;
  pipeline?: unknown[];
  field?: string;
  limit?: number;
}

export const databaseQuery = async (args: DatabaseQueryArgs): Promise<string> => {
  const op = args.operation.trim();
  if (!ALLOWED.has(op)) {
    return `Unsupported operation "${op}". Allowed: ${[...ALLOWED].join(", ")}.`;
  }

  if (op === "find" || op === "countDocuments" || op === "distinct") {
    if (filterContainsForbidden(args.filter ?? {})) {
      return "Filter rejected: `$where`, `$function`, and `$accumulator` are not allowed.";
    }
  }

  if (op === "distinct") {
    const field = typeof args.field === "string" ? args.field : "";
    if (!field) {
      return "`field` is required for distinct.";
    }
  }

  if (op === "aggregate") {
    const pipeline = args.pipeline ?? [];
    if (!Array.isArray(pipeline)) {
      return "`pipeline` must be an array of aggregation stages.";
    }
    if (aggregateContainsForbidden(pipeline)) {
      return "Pipeline rejected: `$out`, `$merge`, and `$function` are not allowed.";
    }
  }

  const root = resolveTerrenoProjectRoot();
  const envPath = join(root, "backend", ".env");
  const mongoUri =
    process.env.MONGO_URI?.trim() ||
    readEnvValue(envPath, "MONGO_URI") ||
    readEnvValue(envPath, "MONGODB_URI");

  if (!mongoUri) {
    return "No Mongo URI found. Set `MONGO_URI` in `backend/.env` or export `MONGO_URI`.";
  }

  return withLocalMongoDb(mongoUri, async (db) => {
    const coll = db.collection(args.collection);
    const cap = Math.min(Math.max(args.limit ?? 50, 1), 200);

    if (op === "find") {
      const filter = (args.filter ?? {}) as Record<string, unknown>;
      const rows = await coll.find(filter, {maxTimeMS: QUERY_MAX_TIME_MS}).limit(cap).toArray();
      return JSON.stringify({collection: args.collection, count: rows.length, rows}, null, 2);
    }

    if (op === "aggregate") {
      const pipeline = args.pipeline ?? [];
      const rows = await coll
        .aggregate(pipeline as never[], {allowDiskUse: false, maxTimeMS: QUERY_MAX_TIME_MS})
        .limit(cap)
        .toArray();
      return JSON.stringify({collection: args.collection, count: rows.length, rows}, null, 2);
    }

    if (op === "countDocuments") {
      const filter = (args.filter ?? {}) as Record<string, unknown>;
      const count = await coll.countDocuments(filter, {maxTimeMS: QUERY_MAX_TIME_MS});
      return JSON.stringify({collection: args.collection, count}, null, 2);
    }

    if (op === "distinct") {
      const field = typeof args.field === "string" ? args.field : "";
      const filter = (args.filter ?? {}) as Record<string, unknown>;
      const values = await coll.distinct(field, filter, {maxTimeMS: QUERY_MAX_TIME_MS});
      const trimmed = values.slice(0, cap);
      return JSON.stringify(
        {collection: args.collection, field, truncated: values.length > cap, values: trimmed},
        null,
        2
      );
    }

    return "Unreachable";
  });
};
