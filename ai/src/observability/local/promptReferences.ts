import {APIError} from "@terreno/api";

import type {ObsPromptRef} from "../../types/observability";

/**
 * A reference to another registry prompt, written like a template partial:
 * `{{> base-rules}}`, `{{> base-rules label=staging}}`, or `{{> base-rules version=3}}`.
 */
const PROMPT_REFERENCE = /\{\{>([^}]*)\}\}/g;

const MAX_PROMPT_REFERENCE_DEPTH = 5;

const DEFAULT_PROMPT_REFERENCE_LABEL = "production";

export interface PromptReference {
  label?: string;
  name: string;
  tag: string;
  version?: number;
}

export interface ResolvedPromptReference {
  body: string;
  label?: string;
  version: number;
}

/** Loads the referenced prompt's raw body; undefined when the name, label, or version is unknown. */
export type PromptReferenceLookup = (
  reference: Omit<PromptReference, "tag">
) => Promise<ResolvedPromptReference | undefined>;

export interface ResolvedPromptText {
  /** Every prompt version pulled in, depth-first, once each, tagged with the prompt that included it. */
  includes: ObsPromptRef[];
  text: string;
}

/** Identity of one recorded include, for deduping. */
export const promptIncludeKey = (ref: ObsPromptRef): string => {
  return [ref.includedBy ?? "", ref.name, ref.version].join("\u0000");
};

const invalidReference = (tag: string, detail: string): APIError => {
  return new APIError({
    detail: `${tag}: ${detail}`,
    status: 400,
    title: "Invalid prompt reference",
  });
};

const parseReference = (tag: string, body: string): PromptReference => {
  const [name, ...options] = body.trim().split(/\s+/);
  if (!name || name.includes("=")) {
    throw invalidReference(tag, "a prompt name must follow {{>");
  }
  const fields = new Map<string, string>();
  for (const option of options) {
    const separator = option.indexOf("=");
    const key = option.slice(0, separator);
    if (separator < 1 || (key !== "label" && key !== "version") || fields.has(key)) {
      throw invalidReference(tag, `expected one label=<label> or version=<n>, got "${option}"`);
    }
    fields.set(key, option.slice(separator + 1));
  }
  const label = fields.get("label");
  const versionText = fields.get("version");
  if (label !== undefined && versionText !== undefined) {
    throw invalidReference(tag, "use label or version, not both");
  }
  if (label === "") {
    throw invalidReference(tag, "label= needs a label name");
  }
  if (versionText === undefined) {
    return {label: label ?? DEFAULT_PROMPT_REFERENCE_LABEL, name, tag};
  }
  const version = Number(versionText);
  if (!Number.isInteger(version) || version < 1) {
    throw invalidReference(tag, "version must be a positive integer");
  }
  return {name, tag, version};
};

/** The references in `text`, in order of appearance. Throws 400 on a malformed tag. */
const parsePromptReferences = (text: string): PromptReference[] => {
  return [...text.matchAll(PROMPT_REFERENCE)].map((match) => {
    return parseReference(match[0], match[1]);
  });
};

/**
 * Replaces every reference in `text` with the referenced prompt's body, recursively. `ancestors`
 * is the chain of prompt names already being resolved (start with the including prompt's own
 * name), so a cycle or a chain deeper than MAX_PROMPT_REFERENCE_DEPTH fails with 400.
 */
export const resolvePromptReferences = async (params: {
  ancestors: string[];
  lookup: PromptReferenceLookup;
  text: string;
}): Promise<ResolvedPromptText> => {
  const includes = new Map<string, ObsPromptRef>();

  const resolve = async (text: string, ancestors: string[]): Promise<string> => {
    const references = parsePromptReferences(text);
    if (references.length === 0) {
      return text;
    }
    const includedBy = ancestors[ancestors.length - 1];
    const replacements = new Map<string, string>();
    for (const reference of references) {
      if (ancestors.includes(reference.name)) {
        throw new APIError({
          detail: [...ancestors, reference.name].join(" → "),
          status: 400,
          title: "Prompt reference cycle",
        });
      }
      if (ancestors.length > MAX_PROMPT_REFERENCE_DEPTH) {
        throw new APIError({
          detail: `${ancestors.join(" → ")} exceeds ${MAX_PROMPT_REFERENCE_DEPTH} levels`,
          status: 400,
          title: "Prompt references nested too deeply",
        });
      }
      const found = await params.lookup({
        label: reference.label,
        name: reference.name,
        version: reference.version,
      });
      if (!found) {
        throw invalidReference(reference.tag, "no prompt matches this name and label or version");
      }
      const ref: ObsPromptRef = {
        includedBy,
        ...(found.label !== undefined ? {label: found.label} : {}),
        name: reference.name,
        version: found.version,
      };
      includes.set(promptIncludeKey(ref), ref);
      replacements.set(reference.tag, await resolve(found.body, [...ancestors, reference.name]));
    }
    return text.replace(PROMPT_REFERENCE, (tag) => {
      return replacements.get(tag) ?? tag;
    });
  };

  const text = await resolve(params.text, params.ancestors);
  return {includes: [...includes.values()], text};
};
