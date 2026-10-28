/**
 * Mongo-style `where` filters shared by the server request and the local view.
 *
 * The same object is serialized into `modelRouter` list query params (qs bracket
 * notation, see `encodeQueryParams`) AND compiled into a local predicate, so a
 * query window can keep its membership live: a delta that makes a cached row
 * match (or stop matching) shows up in (or drops out of) the view without a refetch.
 *
 * Only the operator subset `modelRouter` list endpoints accept through `qs` is
 * evaluated locally. An unsupported operator makes the compiled filter inexact
 * (`match: undefined`), and windows then fall back to server membership only.
 */

type WherePrimitive = string | number | boolean | null;

export interface WhereOperators {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: unknown;
  $gte?: unknown;
  $lt?: unknown;
  $lte?: unknown;
  $in?: unknown[];
  $nin?: unknown[];
  $exists?: boolean;
}

/** Field → value (equality) or operator object. Dot paths address nested fields. */
export interface WhereFilter {
  $and?: WhereFilter[];
  $or?: WhereFilter[];
  [field: string]: unknown;
}

export interface CompiledWhere {
  /** Local predicate, or undefined when the filter uses operators syncdb cannot evaluate. */
  match: ((data: unknown) => boolean) | undefined;
}

const SUPPORTED_OPERATORS = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$exists",
]);

/** Dates compare as ISO strings, matching how synced documents serialize them. */
const normalize = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as {toISO?: unknown}).toISO === "function"
  ) {
    return (value as {toISO: () => string}).toISO();
  }
  return value;
};

const getPath = (data: unknown, path: string): unknown => {
  let current: unknown = data;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) {
    return true;
  }
  // Mongo: `{field: null}` matches a missing field as well as an explicit null.
  if (b === null && a === undefined) {
    return true;
  }
  // REST query params arrive as strings; tolerate "5" vs 5 and "true" vs true.
  if (typeof a !== typeof b && a !== null && b !== null && a !== undefined && b !== undefined) {
    return String(a) === String(b);
  }
  return false;
};

/** Mongo equality: an array field matches when any element equals the value. */
const fieldEquals = (fieldValue: unknown, expected: unknown): boolean => {
  if (Array.isArray(fieldValue) && !Array.isArray(expected)) {
    return fieldValue.some((element) => valuesEqual(element, expected));
  }
  return valuesEqual(fieldValue, expected);
};

const compareValues = (left: unknown, right: unknown): number | undefined => {
  const a = normalize(left);
  const b = normalize(right);
  if (a === null || a === undefined || b === null || b === undefined) {
    return undefined;
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "number" || typeof b === "number") {
    const numA = Number(a);
    const numB = Number(b);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      return numA - numB;
    }
  }
  const strA = String(a);
  const strB = String(b);
  if (strA === strB) {
    return 0;
  }
  return strA < strB ? -1 : 1;
};

const isOperatorObject = (value: unknown): value is WhereOperators => {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => key.startsWith("$"));
};

const compileOperators = (
  path: string,
  operators: WhereOperators
): ((data: unknown) => boolean) | undefined => {
  for (const key of Object.keys(operators)) {
    if (!SUPPORTED_OPERATORS.has(key)) {
      return undefined;
    }
  }
  return (data: unknown): boolean => {
    const fieldValue = getPath(data, path);
    for (const [operator, expected] of Object.entries(operators)) {
      if (operator === "$eq" && !fieldEquals(fieldValue, expected)) {
        return false;
      }
      if (operator === "$ne" && fieldEquals(fieldValue, expected)) {
        return false;
      }
      if (operator === "$in") {
        const options = Array.isArray(expected) ? expected : [expected];
        if (!options.some((option) => fieldEquals(fieldValue, option))) {
          return false;
        }
      }
      if (operator === "$nin") {
        const options = Array.isArray(expected) ? expected : [expected];
        if (options.some((option) => fieldEquals(fieldValue, option))) {
          return false;
        }
      }
      if (operator === "$exists") {
        const exists = fieldValue !== undefined;
        if (exists !== (expected === true || expected === "true")) {
          return false;
        }
      }
      if (operator === "$gt" || operator === "$gte" || operator === "$lt" || operator === "$lte") {
        const comparison = compareValues(fieldValue, expected);
        if (comparison === undefined) {
          return false;
        }
        if (operator === "$gt" && !(comparison > 0)) {
          return false;
        }
        if (operator === "$gte" && !(comparison >= 0)) {
          return false;
        }
        if (operator === "$lt" && !(comparison < 0)) {
          return false;
        }
        if (operator === "$lte" && !(comparison <= 0)) {
          return false;
        }
      }
    }
    return true;
  };
};

const compileFilter = (where: WhereFilter): ((data: unknown) => boolean) | undefined => {
  const clauses: Array<(data: unknown) => boolean> = [];
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) {
      continue;
    }
    if (key === "$and" || key === "$or") {
      if (!Array.isArray(value)) {
        return undefined;
      }
      const subFilters = value.map((sub) => compileFilter(sub as WhereFilter));
      if (subFilters.some((sub) => sub === undefined)) {
        return undefined;
      }
      const compiled = subFilters as Array<(data: unknown) => boolean>;
      clauses.push(
        key === "$and"
          ? (data): boolean => compiled.every((sub) => sub(data))
          : (data): boolean => compiled.some((sub) => sub(data))
      );
      continue;
    }
    if (key.startsWith("$")) {
      // $search, $autocomplete, … run server-side only.
      return undefined;
    }
    if (isOperatorObject(value)) {
      const compiled = compileOperators(key, value);
      if (!compiled) {
        return undefined;
      }
      clauses.push(compiled);
      continue;
    }
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      // Whole-subdocument equality is ambiguous over qs; leave it to the server.
      return undefined;
    }
    const expected = value as WherePrimitive;
    clauses.push((data): boolean => fieldEquals(getPath(data, key), expected));
  }
  return (data: unknown): boolean => clauses.every((clause) => clause(data));
};

/** Compile a `where` filter into a local predicate (undefined when not evaluable locally). */
export const compileWhere = (where: WhereFilter | undefined): CompiledWhere => {
  if (!where) {
    return {match: (): boolean => true};
  }
  return {match: compileFilter(where)};
};

const encodeValue = (value: unknown): string => {
  const normalized = normalize(value);
  if (normalized === null) {
    return "null";
  }
  return String(normalized);
};

const appendParams = (pairs: string[], prefix: string, value: unknown): void => {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      // qs cannot express an empty array: it would vanish and silently widen the query.
      throw new Error(
        `[syncdb] Query param ${prefix} is an empty array, which list query params cannot express.`
      );
    }
    value.forEach((element, index) => {
      appendParams(pairs, `${prefix}[${index}]`, element);
    });
    return;
  }
  const normalized = normalize(value);
  if (normalized !== null && typeof normalized === "object") {
    for (const [key, nested] of Object.entries(normalized)) {
      appendParams(pairs, `${prefix}[${key}]`, nested);
    }
    return;
  }
  pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(encodeValue(normalized))}`);
};

/**
 * Serialize params in the `qs` bracket notation `@terreno/api` parses
 * (`status[$in][0]=open&created[$gte]=…`), so nested operators survive the trip.
 */
export const encodeQueryParams = (params: Record<string, unknown>): string => {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    appendParams(pairs, key, value);
  }
  return pairs.join("&");
};
