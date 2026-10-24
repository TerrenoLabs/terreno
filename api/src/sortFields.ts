/**
 * Sort-key allowlisting for modelRouter list endpoints and the MCP list tool.
 *
 * Sorting by a field reveals its order (and, combined with a second key, its exact value
 * for booleans and enums) even when the field is hidden from the response. List sorts are
 * therefore limited to fields the router declares sortable, the same way filters are limited
 * to `queryFields`.
 */

interface SortFieldOptions {
  /** Fields the router allows filtering on. */
  queryFields?: string[];
  /** The router's default sort; the fields it names stay sortable. */
  sort?: string | {[key: string]: unknown};
  /** Extra fields clients may sort by without being able to filter on them. */
  sortFields?: string[];
}

type ParsedSortFields = {fields: string[]} | {error: "invalid-sort"};

/**
 * Field names named by a Mongoose-style sort: a space-separated string with optional
 * `-`/`+` prefixes, or an object keyed by field. Anything else is invalid.
 */
const parseSortFields = (sort: unknown): ParsedSortFields => {
  if (typeof sort === "string") {
    return {
      fields: sort
        .split(/\s+/)
        .filter((token) => token.length > 0)
        .map((token) => token.replace(/^[-+]/, "")),
    };
  }
  if (sort !== null && typeof sort === "object" && !Array.isArray(sort)) {
    return {fields: Object.keys(sort)};
  }
  return {error: "invalid-sort"};
};

/** Fields a list request may sort by: queryFields, the default sort's fields, and sortFields. */
export const getAllowedSortFields = (options: SortFieldOptions): string[] => {
  const defaultSort = options.sort === undefined ? undefined : parseSortFields(options.sort);
  const defaultSortFields = defaultSort && "fields" in defaultSort ? defaultSort.fields : [];
  return [
    ...new Set([
      ...(options.queryFields ?? []),
      ...defaultSortFields,
      ...(options.sortFields ?? []),
    ]),
  ];
};

type SortCheckResult =
  | {allowed: true}
  | {allowed: false; error: "invalid-sort"}
  | {allowed: false; error: "sort-field-not-allowed"; field: string};

/** Checks every field in a client sort against an allowlist. */
export const checkSortFields = (sort: unknown, allowedFields: string[]): SortCheckResult => {
  const parsed = parseSortFields(sort);
  if ("error" in parsed) {
    return {allowed: false, error: parsed.error};
  }
  const field = parsed.fields.find((name) => !allowedFields.includes(name));
  if (field !== undefined) {
    return {allowed: false, error: "sort-field-not-allowed", field};
  }
  return {allowed: true};
};
