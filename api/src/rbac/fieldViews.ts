import cloneDeep from "lodash/cloneDeep";

import type {FieldMask} from "./types";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getNestedValue = (doc: Record<string, unknown>, path: string): unknown => {
  const parts = path.split(".");
  let current: unknown = doc;
  for (const part of parts) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    if (part === "__proto__" || part === "constructor" || part === "prototype") {
      return undefined;
    }
    current = current[part];
  }
  return current;
};

const setNestedValue = (doc: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split(".");
  let current: Record<string, unknown> = doc;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    // A mask path must never reach a prototype.
    if (part === "__proto__" || part === "constructor" || part === "prototype") {
      return;
    }
    const next = current[part];
    if (!isPlainObject(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1];
  if (lastPart === "__proto__" || lastPart === "constructor" || lastPart === "prototype") {
    return;
  }
  current[lastPart] = value;
};

const pickPaths = (doc: Record<string, unknown>, paths: string[]): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    const value = getNestedValue(doc, path);
    if (value !== undefined) {
      setNestedValue(result, path, cloneDeep(value));
    }
  }
  return result;
};

const omitPath = (doc: Record<string, unknown>, omitPathName: string): void => {
  const parts = omitPathName.split(".");
  const lastPart = parts[parts.length - 1];
  if (lastPart === "__proto__" || lastPart === "constructor" || lastPart === "prototype") {
    return;
  }
  if (parts.length === 1) {
    delete doc[lastPart];
    return;
  }
  const parent = getNestedValue(doc, parts.slice(0, -1).join("."));
  if (isPlainObject(parent)) {
    delete parent[lastPart];
  }
};

export const applyReadMask = (value: unknown, mask: FieldMask): unknown => {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyReadMask(item, mask));
  }

  const doc = value as Record<string, unknown>;
  let result: Record<string, unknown>;
  if (mask.read === "*") {
    result = cloneDeep(doc);
  } else {
    result = pickPaths(doc, mask.read);
  }

  for (const pathToOmit of mask.omit ?? []) {
    omitPath(result, pathToOmit);
  }

  return result;
};

const isWritePathAllowed = (path: string, write: string[]): boolean => {
  for (const allowed of write) {
    if (path === allowed || path.startsWith(`${allowed}.`)) {
      return true;
    }
  }
  return false;
};

const pathHasNestedWriteAllow = (path: string, write: string[]): boolean => {
  return write.some((allowed) => allowed.startsWith(`${path}.`));
};

const collectDisallowedWriteKeys = (
  body: Record<string, unknown>,
  write: string[],
  prefix = ""
): string[] => {
  const disallowed: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && pathHasNestedWriteAllow(path, write)) {
      disallowed.push(...collectDisallowedWriteKeys(value, write, path));
      continue;
    }
    if (!isWritePathAllowed(path, write)) {
      disallowed.push(path);
    }
  }
  return disallowed;
};

export const getDisallowedWriteKeys = (
  body: Record<string, unknown>,
  mask: FieldMask
): string[] => {
  if (mask.write === "*") {
    return [];
  }

  return collectDisallowedWriteKeys(body, mask.write);
};
