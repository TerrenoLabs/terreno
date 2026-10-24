/**
 * Simple in-memory MongoDB query matcher.
 * Evaluates a MongoDB-style query object against a document without hitting the database.
 *
 * Supports: equality, $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists, $and, $or, $not.
 */

const getNestedValue = (doc: Record<string, unknown>, path: string): unknown => {
  const parts = path.split(".");
  let current: unknown = doc;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const normalize = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  // Handle ObjectId-like objects with toString
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const ctorName = (obj.constructor as {name?: string} | undefined)?.name;
    if (typeof obj.toString === "function" && ctorName !== "Object") {
      return String(value);
    }
  }
  return value;
};

/**
 * JS abstract relational comparison on unknown values.
 * Numeric operands compare numerically; everything else compares as strings.
 * This mirrors the coercion behaviour of `>` / `<` on the `any`-typed values
 * that MongoDB in-memory matching historically received.
 */
const compareValues = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const numA = Number(a);
  const numB = Number(b);
  return numA - numB;
};

const matchesCondition = (rawValue: unknown, condition: unknown): boolean => {
  const value = normalize(rawValue);

  // Direct equality (non-object condition)
  if (condition === null || condition === undefined || typeof condition !== "object") {
    const normalizedCondition = normalize(condition);
    return value === normalizedCondition || String(value) === String(normalizedCondition);
  }

  // Array equality
  if (Array.isArray(condition)) {
    return JSON.stringify(value) === JSON.stringify(condition);
  }

  // Operator object
  for (const [op, operand] of Object.entries(condition as Record<string, unknown>)) {
    const normOp = normalize(operand);

    switch (op) {
      case "$eq":
        if (value !== normOp && String(value) !== String(normOp)) {
          return false;
        }
        break;
      case "$ne":
        if (value === normOp || String(value) === String(normOp)) {
          return false;
        }
        break;
      case "$gt": {
        const cmp = compareValues(value, normOp);
        if (Number.isNaN(cmp) || cmp <= 0) {
          return false;
        }
        break;
      }
      case "$gte": {
        const cmp = compareValues(value, normOp);
        if (Number.isNaN(cmp) || cmp < 0) {
          return false;
        }
        break;
      }
      case "$lt": {
        const cmp = compareValues(value, normOp);
        if (Number.isNaN(cmp) || cmp >= 0) {
          return false;
        }
        break;
      }
      case "$lte": {
        const cmp = compareValues(value, normOp);
        if (Number.isNaN(cmp) || cmp > 0) {
          return false;
        }
        break;
      }
      case "$in": {
        if (!Array.isArray(operand)) {
          return false;
        }
        const inValues = operand.map(normalize);
        if (!inValues.some((v) => v === value || String(v) === String(value))) {
          return false;
        }
        break;
      }
      case "$nin": {
        if (!Array.isArray(operand)) {
          return false;
        }
        const ninValues = operand.map(normalize);
        if (ninValues.some((v) => v === value || String(v) === String(value))) {
          return false;
        }
        break;
      }
      case "$exists":
        if (operand && rawValue === undefined) {
          return false;
        }
        if (!operand && rawValue !== undefined) {
          return false;
        }
        break;
      case "$not":
        if (matchesCondition(rawValue, operand)) {
          return false;
        }
        break;
      default:
        // Unknown operator — fail closed to avoid leaking data
        return false;
    }
  }

  return true;
};

const isPlainQuery = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const evaluateQuery = (doc: Record<string, unknown>, query: Record<string, unknown>): boolean => {
  for (const [key, condition] of Object.entries(query)) {
    if (key === "$and") {
      if (!Array.isArray(condition)) {
        return false;
      }
      for (const subQuery of condition) {
        if (!isPlainQuery(subQuery) || !evaluateQuery(doc, subQuery)) {
          return false;
        }
      }
      continue;
    }

    if (key === "$or") {
      if (!Array.isArray(condition)) {
        return false;
      }
      let matched = false;
      for (const subQuery of condition) {
        if (isPlainQuery(subQuery) && evaluateQuery(doc, subQuery)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return false;
      }
      continue;
    }

    const value = getNestedValue(doc, key);
    if (!matchesCondition(value, condition)) {
      return false;
    }
  }

  return true;
};

/**
 * Check if a document matches a MongoDB-style query in memory.
 *
 * Fails closed: malformed clauses, and operands that cannot be compared (for example an
 * object whose `toString` is not a function), count as a non-match instead of throwing.
 *
 * @param doc - The document to test (plain object or Mongoose document)
 * @param query - MongoDB-style query object
 * @returns true if the document matches all query conditions
 */
export const matchesQuery = (
  doc: Record<string, unknown>,
  query: Record<string, unknown>
): boolean => {
  if (!isPlainQuery(query)) {
    return false;
  }
  try {
    return evaluateQuery(doc, query);
  } catch {
    return false;
  }
};
