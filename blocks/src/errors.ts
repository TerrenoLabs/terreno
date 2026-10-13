/** Error codes for whole-reply documents. Warnings never block rendering. */
export const BLOCK_ERROR_CODES = {
  COLUMN_NOT_FOUND: "A chart or table names a column the dataset does not have.",
  COLUMN_TYPE_MISMATCH: "A column value does not match the column type.",
  COPY_TARGET_INVALID:
    "A copy action names a block that is not a stepper, checklist, list, table, or text block.",
  DATASET_NOT_FOUND: "A chart or table names a dataset the document does not define.",
  DATASET_TOO_LARGE: "A dataset has more rows or columns than allowed.",
  DEPTH_EXCEEDED: "A columns or card block is nested inside another columns or card block.",
  DUPLICATE_ID: "An id or a column name is used more than once.",
  HTML_DISABLED: "An html block is present and this host has not turned HTML on.",
  HTML_TOO_LARGE: "An html block is larger than 100,000 bytes.",
  IMAGE_HOST_NOT_ALLOWED:
    "An image URL is not a data:image URL, a file: ref, or an https URL on an allowed host.",
  INVALID_ENUM: "A value is not one of the allowed values.",
  INVALID_FORMAT: "A string does not match its required format.",
  INVALID_TYPE: "A value has the wrong type.",
  KEY_ORDER: "Top-level keys are not in the order v, datasets, blocks.",
  MISSING_REQUIRED: "A required field is missing.",
  NOT_A_DOCUMENT: "The reply is not one YAML or JSON mapping with a v field.",
  OUT_OF_RANGE:
    "A number is outside its allowed range, such as a stepper value outside min and max.",
  ROW_ARITY_MISMATCH: "A dataset row does not have one value per column.",
  SELECT_TARGET_INVALID: "A select action names a block that is not a chart or table.",
  TABLE_TOO_WIDE: "A table lists more columns than allowed.",
  TOO_FEW: "A list has fewer items than allowed.",
  TOO_LONG: "A string is longer than allowed.",
  TOO_MANY: "A list has more items than allowed.",
  TOO_MANY_BLOCKS: "The document has more than the maximum number of blocks.",
  TOO_MANY_POINTS: "A ref dataset asks for more rendered rows than allowed.",
  TOO_SHORT: "A string is empty or only whitespace.",
  UNKNOWN_HOST_ACTION: "A callback names a host action that is not registered.",
  UNKNOWN_KEY: "An object has a field that its schema does not define.",
  UNSUPPORTED_VERSION: "The document version is not 1.",
  YAML_FEATURE_DISALLOWED: "The document uses a YAML anchor, alias, or custom tag.",
} as const;

/** Chart heuristics. They ride along on a valid document and do not block rendering. */
export const BLOCK_WARNING_CODES = {
  BAR_TOO_MANY_CATEGORIES: "A bar chart has more categories than fit comfortably.",
  DONUT_TOO_MANY_SLICES: "A donut chart has more slices than fit comfortably.",
  LINE_SINGLE_POINT: "A line chart has only one point.",
} as const;

export type BlockWarningCode = keyof typeof BLOCK_WARNING_CODES;

export type BlockErrorCode = keyof typeof BLOCK_ERROR_CODES;

export interface BlockError {
  /** A key of `BLOCK_ERROR_CODES` or `BLOCK_WARNING_CODES`. */
  code: BlockErrorCode | BlockWarningCode;
  /** One instruction that fixes the error. */
  fix: string;
  /** What is wrong, in one sentence. */
  message: string;
  /** Where the error is, such as `blocks[0].text`. The root is an empty string. */
  path: string;
}

export const formatBlockPath = (segments: readonly PropertyKey[]): string =>
  segments.reduce<string>((path, segment) => {
    if (typeof segment === "number") {
      return `${path}[${segment}]`;
    }
    const key = String(segment);
    if (path === "") {
      return key;
    }
    return `${path}.${key}`;
  }, "");

const pathIndex = (segment: string): number | string => {
  const index = Number(segment);
  if (segment !== "" && String(index) === segment) {
    return index;
  }
  return segment;
};

/** Splits `blocks[0].text` into comparable pieces so indexes sort numerically. */
const blockPathSegments = (path: string): readonly (string | number)[] => {
  const parts: (string | number)[] = [];
  const pattern = /([^[\].]+)|\[(\d+)\]/g;
  for (const match of path.matchAll(pattern)) {
    const index = match[2];
    if (index !== undefined) {
      parts.push(pathIndex(index));
      continue;
    }
    const key = match[1];
    if (key !== undefined) {
      parts.push(key);
    }
  }
  return parts;
};

const compareBlockPaths = (left: string, right: string): number => {
  const leftParts = blockPathSegments(left);
  const rightParts = blockPathSegments(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    if (typeof leftPart === "number" && typeof rightPart === "number") {
      return leftPart - rightPart;
    }
    return String(leftPart) < String(rightPart) ? -1 : 1;
  }
  return 0;
};

export const sortBlockErrors = (errors: readonly BlockError[]): BlockError[] =>
  [...errors].sort((left, right) => {
    const byPath = compareBlockPaths(left.path, right.path);
    if (byPath !== 0) {
      return byPath;
    }
    return left.code < right.code ? -1 : 1;
  });
