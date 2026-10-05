/**
 * Sort specs shared by server list requests and local views.
 *
 * Accepts the same forms as `modelRouter`'s `sort` option: `"-created"`,
 * `"-created name"`, or `{created: "descending", name: "ascending"}`.
 */

export type SortDirection = "ascending" | "descending" | 1 | -1;

export type SortSpec = string | Record<string, SortDirection>;

interface SortKey {
  path: string;
  direction: 1 | -1;
}

const parseSortSpec = (spec: SortSpec): SortKey[] => {
  if (typeof spec === "string") {
    return spec
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .map((part) =>
        part.startsWith("-") ? {direction: -1, path: part.slice(1)} : {direction: 1, path: part}
      );
  }
  return Object.entries(spec).map(([path, direction]) => ({
    direction: direction === "descending" || direction === -1 ? -1 : 1,
    path,
  }));
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

/** Mongo ordering for the value types synced documents carry: missing < numbers < strings < booleans. */
const typeRank = (value: unknown): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return 1;
  }
  if (typeof value === "string") {
    return 2;
  }
  if (typeof value === "boolean") {
    return 3;
  }
  return 4;
};

const compareField = (a: unknown, b: unknown): number => {
  const rankA = typeRank(a);
  const rankB = typeRank(b);
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  if (rankA === 0) {
    return 0;
  }
  const strA = typeof a === "string" ? a : JSON.stringify(a);
  const strB = typeof b === "string" ? b : JSON.stringify(b);
  if (strA === strB) {
    return 0;
  }
  return strA < strB ? -1 : 1;
};

/** Compile a sort spec into a comparator over decoded entity data. */
export const compileSort = <TData>(spec: SortSpec): ((a: TData, b: TData) => number) => {
  const keys = parseSortSpec(spec);
  return (a: TData, b: TData): number => {
    for (const key of keys) {
      const result = compareField(getPath(a, key.path), getPath(b, key.path));
      if (result !== 0) {
        return result * key.direction;
      }
    }
    return 0;
  };
};

/** Serialize a sort spec for the `sort` query param `modelRouter` accepts. */
export const sortSpecToParam = (spec: SortSpec): string =>
  parseSortSpec(spec)
    .map((key) => (key.direction === -1 ? `-${key.path}` : key.path))
    .join(" ");
