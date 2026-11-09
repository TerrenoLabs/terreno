import {APIError} from "@terreno/api";

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

const pathSegments = (path: string): string[] => {
  return path.split(".").filter((segment) => {
    return segment.length > 0;
  });
};

const assertSafePath = (segments: string[]): void => {
  const unsafe = segments.find((segment) => UNSAFE_PATH_SEGMENTS.has(segment));
  if (unsafe) {
    throw new APIError({
      status: 400,
      title: `Unsafe JSON path segment "${unsafe}"`,
    });
  }
};

export const getValueAtPath = (value: unknown, path: string): unknown => {
  if (!path || path === ".") {
    return value;
  }
  const segments = pathSegments(path);
  assertSafePath(segments);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

export const setValueAtPath = (
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void => {
  const segments = pathSegments(path);
  assertSafePath(segments);
  if (segments.length === 0) {
    return;
  }
  let current: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = current[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
    } else {
      current = next as Record<string, unknown>;
    }
  }
  current[segments[segments.length - 1]] = value;
};
