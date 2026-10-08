import type {z} from "zod";

import {
  BLOCK_ERROR_CODES,
  type BlockError,
  type BlockErrorCode,
  formatBlockPath,
  sortBlockErrors,
} from "./errors";
import {BLOCK_LIMITS} from "./limits";
import {type LintBlocksOptions, lintDocument} from "./lint";
import {type BlocksDocument, blocksSchema, LAYOUT_BLOCK_TYPES} from "./schema";

const TOP_LEVEL_ORDER = ["v", "datasets", "blocks"] as const;

const layoutTypes: ReadonlySet<string> = new Set(LAYOUT_BLOCK_TYPES);

export type ValidateBlocksResult =
  | {doc: BlocksDocument; ok: true; warnings: BlockError[]}
  | {errors: BlockError[]; ok: false; warnings: BlockError[]};

const error = ({
  code,
  fix,
  message,
  path,
}: {
  code: BlockErrorCode;
  fix: string;
  message: string;
  path: string;
}): BlockError => ({code, fix, message, path});

const isPlainMapping = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
};

const keyOrderError = (value: Record<string, unknown>): BlockError | undefined => {
  const present = Object.keys(value).filter((key) =>
    TOP_LEVEL_ORDER.some((ordered) => ordered === key)
  );
  const expected = TOP_LEVEL_ORDER.filter((key) => present.includes(key));
  for (let index = 0; index < present.length; index += 1) {
    if (present[index] !== expected[index]) {
      return error({
        code: "KEY_ORDER",
        fix: "Put the keys in this order: v, datasets, blocks.",
        message: BLOCK_ERROR_CODES.KEY_ORDER,
        path: present[index] ?? "",
      });
    }
  }
  return undefined;
};

const versionError = (value: Record<string, unknown>): BlockError | undefined => {
  if (!Object.hasOwn(value, "v")) {
    return undefined;
  }
  if (value.v === 1) {
    return undefined;
  }
  return error({
    code: "UNSUPPORTED_VERSION",
    fix: "Set v to 1.",
    message: BLOCK_ERROR_CODES.UNSUPPORTED_VERSION,
    path: "v",
  });
};

const countBlocks = (value: unknown): number => {
  if (!isPlainMapping(value) || typeof value.type !== "string") {
    return 0;
  }
  let count = 1;
  if (Array.isArray(value.children)) {
    for (const child of value.children) {
      count += countBlocks(child);
    }
  }
  return count;
};

const blockCountError = (value: Record<string, unknown>): BlockError | undefined => {
  if (!Array.isArray(value.blocks)) {
    return undefined;
  }
  let count = 0;
  for (const block of value.blocks) {
    count += countBlocks(block);
  }
  if (count <= BLOCK_LIMITS.maxBlocks) {
    return undefined;
  }
  return error({
    code: "TOO_MANY_BLOCKS",
    fix: `Use ${BLOCK_LIMITS.maxBlocks} blocks or fewer.`,
    message: BLOCK_ERROR_CODES.TOO_MANY_BLOCKS,
    path: "blocks",
  });
};

const depthPath = (value: unknown, depth: number, path: string): string | undefined => {
  if (!isPlainMapping(value)) {
    return undefined;
  }
  const type = value.type;
  const isLayout = typeof type === "string" && layoutTypes.has(type);
  if (isLayout && depth >= BLOCK_LIMITS.maxDepth) {
    return path;
  }
  if (!Array.isArray(value.children)) {
    return undefined;
  }
  const childDepth = isLayout ? depth + 1 : depth;
  for (let index = 0; index < value.children.length; index += 1) {
    const found = depthPath(value.children[index], childDepth, `${path}.children[${index}]`);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

const depthError = (value: Record<string, unknown>): BlockError | undefined => {
  if (!Array.isArray(value.blocks)) {
    return undefined;
  }
  for (let index = 0; index < value.blocks.length; index += 1) {
    const path = depthPath(value.blocks[index], 1, `blocks[${index}]`);
    if (path === undefined) {
      continue;
    }
    return error({
      code: "DEPTH_EXCEEDED",
      fix: "Keep columns and card at the top level. Their children must be leaf blocks.",
      message: BLOCK_ERROR_CODES.DEPTH_EXCEEDED,
      path,
    });
  }
  return undefined;
};

const lookup = (root: unknown, path: readonly PropertyKey[]): unknown => {
  let current = root;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
      continue;
    }
    if (isPlainMapping(current) && (typeof segment === "string" || typeof segment === "number")) {
      current = current[String(segment)];
      continue;
    }
    return undefined;
  }
  return current;
};

const subject = (path: string): string => (path === "" ? "The value" : path);

const mapIssue = (issue: z.core.$ZodIssue, root: unknown): BlockError[] => {
  const path = formatBlockPath(issue.path);
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) =>
      error({
        code: "UNKNOWN_KEY",
        fix: `Remove "${key}".`,
        message: `"${key}" is not a field of ${path === "" ? "this object" : path}.`,
        path: path === "" ? key : `${path}.${key}`,
      })
    );
  }
  if (issue.code === "invalid_value") {
    const received = lookup(root, issue.path);
    return [
      error({
        code: "INVALID_ENUM",
        fix: `Use one of: ${issue.values.map((value) => JSON.stringify(value)).join(", ")}.`,
        message: `${subject(path)} must be one of the allowed values, not ${JSON.stringify(received)}.`,
        path,
      }),
    ];
  }
  if (issue.code === "invalid_type") {
    const received = lookup(root, issue.path);
    if (received === undefined) {
      return [
        error({
          code: "MISSING_REQUIRED",
          fix: `Add ${path === "" ? "the missing field" : path}.`,
          message: BLOCK_ERROR_CODES.MISSING_REQUIRED,
          path,
        }),
      ];
    }
    return [
      error({
        code: "INVALID_TYPE",
        fix: `Make ${subject(path)} a ${issue.expected}.`,
        message: `${subject(path)} has the wrong type.`,
        path,
      }),
    ];
  }
  if (issue.code === "too_big") {
    const maximum = String(issue.maximum);
    if (issue.origin === "array" && path === "blocks") {
      return [
        error({
          code: "TOO_MANY_BLOCKS",
          fix: `Use ${maximum} blocks or fewer.`,
          message: BLOCK_ERROR_CODES.TOO_MANY_BLOCKS,
          path,
        }),
      ];
    }
    if (issue.origin === "number" || issue.origin === "int") {
      return [
        error({
          code: "OUT_OF_RANGE",
          fix: `Set ${subject(path)} to ${maximum} or less.`,
          message: `${subject(path)} is above ${maximum}.`,
          path,
        }),
      ];
    }
    if (issue.origin === "array") {
      return [
        error({
          code: "TOO_MANY",
          fix: `Remove items from ${subject(path)} until it has ${maximum} or fewer.`,
          message: `${subject(path)} has more than ${maximum} items.`,
          path,
        }),
      ];
    }
    return [
      error({
        code: "TOO_LONG",
        fix: `Shorten ${subject(path)} to ${maximum} characters or fewer.`,
        message: `${subject(path)} is longer than ${maximum} characters.`,
        path,
      }),
    ];
  }
  if (issue.code === "too_small") {
    if (issue.origin === "number" || issue.origin === "int") {
      return [
        error({
          code: "INVALID_TYPE",
          fix: `Set ${subject(path)} to an integer of at least ${String(issue.minimum)}.`,
          message: `${subject(path)} must be an integer of at least ${String(issue.minimum)}.`,
          path,
        }),
      ];
    }
    if (issue.origin === "array") {
      return [
        error({
          code: "TOO_FEW",
          fix: `Add items to ${subject(path)} until it has at least ${String(issue.minimum)}.`,
          message: `${subject(path)} has fewer items than allowed.`,
          path,
        }),
      ];
    }
    return [
      error({
        code: "TOO_SHORT",
        fix: `Write visible text for ${subject(path)}.`,
        message: BLOCK_ERROR_CODES.TOO_SHORT,
        path,
      }),
    ];
  }
  if (issue.code === "invalid_format") {
    const isRefId = /^datasets\.[^.]+\.id$/.test(path);
    return [
      error({
        code: "INVALID_FORMAT",
        fix: isRefId
          ? "Use 1 to 80 letters, digits, underscores, or hyphens."
          : "Use a lowercase id starting with a letter, then letters, digits, or underscores.",
        message: `${subject(path)} does not match the required format.`,
        path,
      }),
    ];
  }
  if (issue.code === "custom" && issue.params?.blockCode === "TOO_SHORT") {
    return [
      error({
        code: "TOO_SHORT",
        fix: `Write visible text for ${subject(path)}.`,
        message: BLOCK_ERROR_CODES.TOO_SHORT,
        path,
      }),
    ];
  }
  if (issue.code === "invalid_union") {
    const nested = "errors" in issue && Array.isArray(issue.errors) ? issue.errors.flat() : [];
    if (nested.length > 0) {
      return nested.flatMap((nestedIssue) => mapIssue(nestedIssue, root));
    }
    return [
      error({
        code: "INVALID_ENUM",
        fix: "Set type to heading, text, metric, badge, divider, context, chart, table, actions, columns, card, callout, image, details, stepper, checklist, gallery, or html.",
        message: `${subject(path)} is not a supported block.`,
        path: path === "" ? "type" : `${path}.type`,
      }),
    ];
  }
  return [
    error({
      code: "INVALID_TYPE",
      fix: `Check ${subject(path)}.`,
      message: issue.message,
      path,
    }),
  ];
};

const dropVersionIssues = (issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] =>
  issues.filter((issue) => !(issue.path.length === 1 && issue.path[0] === "v"));

/**
 * Checks structure, then dataset, chart, and table lint.
 * Returns every error at once. Warnings do not block a valid document.
 */
export const validateBlocks = (doc: unknown, options?: LintBlocksOptions): ValidateBlocksResult => {
  const structural: BlockError[] = [];
  if (isPlainMapping(doc)) {
    const order = keyOrderError(doc);
    if (order) {
      structural.push(order);
    }
    const version = versionError(doc);
    if (version) {
      structural.push(version);
    }
    const depth = depthError(doc);
    if (depth) {
      structural.push(depth);
    }
    const count = blockCountError(doc);
    if (count) {
      structural.push(count);
    }
  }
  const parsed = blocksSchema.safeParse(doc);
  if (!parsed.success) {
    const issues = structural.some((item) => item.code === "UNSUPPORTED_VERSION")
      ? dropVersionIssues(parsed.error.issues)
      : parsed.error.issues;
    const skipBlockCount = structural.some((item) => item.code === "TOO_MANY_BLOCKS");
    for (const issue of issues) {
      if (skipBlockCount && issue.code === "too_big" && formatBlockPath(issue.path) === "blocks") {
        continue;
      }
      structural.push(...mapIssue(issue, doc));
    }
  }
  if (structural.length > 0 || !parsed.success) {
    return {errors: sortBlockErrors(structural), ok: false, warnings: []};
  }
  const linted = lintDocument(parsed.data, options);
  if (linted.errors.length > 0) {
    return {
      errors: sortBlockErrors(linted.errors),
      ok: false,
      warnings: sortBlockErrors(linted.warnings),
    };
  }
  return {doc: parsed.data, ok: true, warnings: sortBlockErrors(linted.warnings)};
};
