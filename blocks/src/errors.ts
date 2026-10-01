/** Structural error codes for whole-reply documents. Semantic codes land with task B1.2. */
export const BLOCK_ERROR_CODES = {
  DEPTH_EXCEEDED: "A columns or card block is nested inside another columns or card block.",
  INVALID_ENUM: "A value is not one of the allowed values.",
  INVALID_FORMAT: "A string does not match its required format.",
  INVALID_TYPE: "A value has the wrong type.",
  KEY_ORDER: "Top-level keys are not in the order v, datasets, blocks.",
  MISSING_REQUIRED: "A required field is missing.",
  NOT_A_DOCUMENT: "The reply is not one YAML or JSON mapping with a v field.",
  TOO_FEW: "A list has fewer items than allowed.",
  TOO_LONG: "A string is longer than allowed.",
  TOO_MANY: "A list has more items than allowed.",
  TOO_MANY_BLOCKS: "The document has more than the maximum number of blocks.",
  TOO_SHORT: "A string is empty or only whitespace.",
  UNKNOWN_KEY: "An object has a field that its schema does not define.",
  UNSUPPORTED_VERSION: "The document version is not 1.",
  YAML_FEATURE_DISALLOWED: "The document uses a YAML anchor, alias, or custom tag.",
} as const;

export type BlockErrorCode = keyof typeof BLOCK_ERROR_CODES;

export interface BlockError {
  /** A key of `BLOCK_ERROR_CODES`. */
  code: BlockErrorCode;
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
export const blockPathSegments = (path: string): readonly (string | number)[] => {
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

export const compareBlockPaths = (left: string, right: string): number => {
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
