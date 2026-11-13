/**
 * Bulletproof-ish extraction of JSON from LLM output.
 *
 * Handles common "return only JSON" violations:
 * - markdown code fences (full ```json … ``` wrappers or partial ``` lines)
 * - preamble / trailing prose around a JSON value
 * - JSON buried mid-string (first balanced `{`/`[` … `}`/`]` slice)
 * - trailing commas before `}` or `]`
 * - smart quotes outside string literals (conservative repair)
 *
 * Strategy: try the cheapest parse first, escalate only when it fails.
 */

export interface ParseSuccess<T> {
  data: T;
  repaired: boolean;
  success: true;
}

export interface ParseFailure {
  error: string;
  raw: string;
  success: false;
}

export type ParseResult<T> = ParseFailure | ParseSuccess<T>;

const FENCE_LANGUAGE = /^(?:json|javascript|js|typescript|ts)/i;

/**
 * Strip leading/trailing markdown code fences when the whole payload is fenced,
 * otherwise strip a common opening ```lang line and trailing ``` block.
 */
const stripFences = (input: string): string => {
  const trimmed = input.trim();
  // String ops instead of one fenced regex: `\s*` and a lazy body made that regex quadratic.
  if (trimmed.length >= 6 && trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const inner = trimmed.slice(3, -3);
    return inner.replace(FENCE_LANGUAGE, "").trim();
  }

  let t = trimmed;
  t = t.replace(/^```[a-zA-Z0-9_-]*\s*:?\s*\n?/, "");
  t = t.replace(/\n?```\s*$/m, "").trim();
  return t;
};

/**
 * Returns the first balanced JSON object or array substring, respecting string literals
 * and escapes. Uses a bracket stack so nested `{}` / `[]` mix correctly.
 */
const extractBalancedJson = (input: string): string | null => {
  const start = input.search(/[{[]/);
  if (start === -1) {
    return null;
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }

    if (char === "{") {
      stack.push("}");
      continue;
    }
    if (char === "[") {
      stack.push("]");
      continue;
    }
    if (char === "}" || char === "]") {
      const expected = stack.pop();
      if (expected !== char) {
        return null;
      }
      if (stack.length === 0) {
        return input.slice(start, i + 1);
      }
    }
  }

  return null;
};

/**
 * Light-touch repairs for common malformations. Only changes characters outside
 * string literals so legitimate string content is preserved.
 */
const repairJsonishOutsideStrings = (input: string): string => {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (!inString) {
      if (char === "\u201C" || char === "\u201D") {
        result += '"';
        continue;
      }
      if (char === ",") {
        const rest = input.slice(i + 1);
        const next = rest.match(/^\s*([}\]])/);
        if (next) {
          continue;
        }
      }
    }

    result += char;
  }

  return result;
};

const tryParse = <T>(candidate: string): T | undefined => {
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return undefined;
  }
};

/**
 * Extract and parse JSON from arbitrary LLM output.
 */
export const parseAiJson = <T = unknown>(input: string): ParseResult<T> => {
  if (typeof input !== "string" || input.trim().length === 0) {
    return {error: "Empty or non-string input", raw: input, success: false};
  }

  const cleaned = stripFences(input);

  const direct = tryParse<T>(cleaned);
  if (direct !== undefined) {
    return {data: direct, repaired: false, success: true};
  }

  const balanced = extractBalancedJson(cleaned);
  if (balanced !== null) {
    const extracted = tryParse<T>(balanced);
    if (extracted !== undefined) {
      return {data: extracted, repaired: true, success: true};
    }

    const repairedSlice = tryParse<T>(repairJsonishOutsideStrings(balanced));
    if (repairedSlice !== undefined) {
      return {data: repairedSlice, repaired: true, success: true};
    }
  }

  const repairedWhole = tryParse<T>(repairJsonishOutsideStrings(cleaned));
  if (repairedWhole !== undefined) {
    return {data: repairedWhole, repaired: true, success: true};
  }

  const aggressiveQuotes = tryParse<T>(cleaned.replace(/[\u201C\u201D]/g, '"'));
  if (aggressiveQuotes !== undefined) {
    return {data: aggressiveQuotes, repaired: true, success: true};
  }

  return {
    error: "No valid JSON could be extracted",
    raw: input,
    success: false,
  };
};

/**
 * Normalizes raw LLM text into a single JSON text payload for Vercel `Output.*` parsers.
 * On success returns `JSON.stringify` of the parsed value; on failure returns `cleaned`
 * (fence-stripped) text so the SDK can still attempt its own error path.
 */
export const normalizeLlmJsonTextForStructuredOutput = (raw: string): string => {
  const parsed = parseAiJson<unknown>(raw);
  if (parsed.success) {
    return JSON.stringify(parsed.data);
  }
  return stripFences(raw);
};
