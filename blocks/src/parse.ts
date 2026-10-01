import {type Document, parseAllDocuments, visit} from "yaml";

import {BLOCK_ERROR_CODES, type BlockError} from "./errors";

const FENCE = /^```(?:yaml|yml|json)?[^\n]*\n([\s\S]*?)\n?```$/i;

const notADocument = (): BlockError => ({
  code: "NOT_A_DOCUMENT",
  fix: "Reply with one document: v, then optional datasets, then blocks.",
  message: BLOCK_ERROR_CODES.NOT_A_DOCUMENT,
  path: "",
});

const yamlFeatureDisallowed = (): BlockError => ({
  code: "YAML_FEATURE_DISALLOWED",
  fix: "Remove YAML anchors, aliases, and custom tags. Use plain mappings and sequences.",
  message: BLOCK_ERROR_CODES.YAML_FEATURE_DISALLOWED,
  path: "",
});

const stripFence = (text: string): string => {
  const trimmed = text.trim();
  const match = FENCE.exec(trimmed);
  if (match?.[1] !== undefined) {
    return match[1];
  }
  return trimmed;
};

const hasExplicitTag = (tag: string | null | undefined): boolean =>
  typeof tag === "string" && tag.length > 0;

const usesDisallowedYaml = (doc: Document): boolean => {
  const hasTagError = doc.errors.some(
    (error) => error.code === "TAG_RESOLVE_FAILED" || error.code === "BAD_ALIAS"
  );
  if (hasTagError) {
    return true;
  }
  let disallowed = false;
  visit(doc, {
    Alias() {
      disallowed = true;
    },
    Map(_key, node) {
      if (node.anchor || hasExplicitTag(node.tag)) {
        disallowed = true;
      }
    },
    Scalar(_key, node) {
      if (node.anchor || hasExplicitTag(node.tag)) {
        disallowed = true;
      }
    },
    Seq(_key, node) {
      if (node.anchor || hasExplicitTag(node.tag)) {
        disallowed = true;
      }
    },
  });
  return disallowed;
};

const isPlainMapping = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
};

export type ParseBlocksResult = {errors: BlockError[]; ok: false} | {ok: true; value: unknown};

/**
 * Parses one assistant reply into a plain value.
 * A surrounding markdown fence is ignored. Anchors, aliases, and custom tags are rejected.
 * Anything that is not a mapping with `v` is `NOT_A_DOCUMENT`.
 */
export const parseBlocks = (text: string): ParseBlocksResult => {
  const stripped = stripFence(text);
  if (stripped.trim() === "") {
    return {errors: [notADocument()], ok: false};
  }
  const docs = parseAllDocuments(stripped, {
    schema: "core",
    strict: true,
    uniqueKeys: true,
  });
  const doc = docs[0];
  if (docs.length !== 1 || doc === undefined) {
    return {errors: [notADocument()], ok: false};
  }
  if (usesDisallowedYaml(doc)) {
    return {errors: [yamlFeatureDisallowed()], ok: false};
  }
  if (doc.errors.length > 0) {
    return {errors: [notADocument()], ok: false};
  }
  const value: unknown = doc.toJS();
  if (!isPlainMapping(value) || !Object.hasOwn(value, "v")) {
    return {errors: [notADocument()], ok: false};
  }
  return {ok: true, value};
};
