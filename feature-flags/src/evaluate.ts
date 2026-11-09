import {logger} from "@terreno/api";
import get from "lodash/get";
import type {
  EvaluationResult,
  FeatureFlagDocument,
  FeatureFlagRule,
  SegmentFunction,
} from "./types";

// Evaluation diagnostics are opt-in and never include the user's attribute values.
const isDebugEnabled = (): boolean => process.env.FEATURE_FLAGS_DEBUG === "true";

/**
 * Deterministic hash of a string to a number between 0 and 99.
 * Uses a simple but effective hash (djb2) to ensure the same user+flag
 * combination always produces the same result.
 */
export const deterministicHash = (input: string): number => {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(hash) % 100;
};

const matchesFieldRule = (user: unknown, rule: FeatureFlagRule): boolean => {
  if (!rule.field || !rule.operator) {
    return false;
  }

  const fieldValue = get(user, rule.field);
  const ruleValue = rule.value;
  let result = false;

  switch (rule.operator) {
    case "eq":
      result = ruleValue !== undefined && fieldValue === ruleValue;
      break;
    case "neq":
      result = ruleValue !== undefined && fieldValue !== ruleValue;
      break;
    case "in":
      result = Array.isArray(ruleValue) && ruleValue.includes(fieldValue);
      break;
    case "nin":
      result = Array.isArray(ruleValue) && !ruleValue.includes(fieldValue);
      break;
    case "gt":
      result =
        typeof fieldValue === "number" && typeof ruleValue === "number" && fieldValue > ruleValue;
      break;
    case "lt":
      result =
        typeof fieldValue === "number" && typeof ruleValue === "number" && fieldValue < ruleValue;
      break;
    case "contains":
      result =
        typeof fieldValue === "string" &&
        typeof ruleValue === "string" &&
        fieldValue.includes(ruleValue);
      break;
    default:
      break;
  }

  if (isDebugEnabled()) {
    logger.debug(`[feature-flags] field rule: user.${rule.field} ${rule.operator} → ${result}`);
  }

  return result;
};

const matchesRule = (
  user: unknown,
  rule: FeatureFlagRule,
  segments: Record<string, SegmentFunction>
): boolean => {
  if (rule.segment) {
    const segmentFn = segments[rule.segment];
    if (!segmentFn) {
      logger.warn(`Segment function not found: ${rule.segment}`);
      return false;
    }
    try {
      const result = segmentFn(user);
      if (isDebugEnabled()) {
        logger.debug(`[feature-flags] segment rule: "${rule.segment}" → ${result}`);
      }
      return result;
    } catch (err) {
      logger.warn(`Segment function "${rule.segment}" threw: ${err}`);
      return false;
    }
  }

  return matchesFieldRule(user, rule);
};

/**
 * Evaluate a single feature flag for a user.
 * Returns boolean for boolean flags, string key for variant flags, or null for disabled variant flags.
 */
export const evaluateFlag = (
  flag: FeatureFlagDocument,
  userId: string,
  user: unknown,
  segments: Record<string, SegmentFunction>
): boolean | string | null => {
  const debug = isDebugEnabled();

  if (!flag.enabled) {
    if (debug) {
      logger.debug(
        `[feature-flags] "${flag.key}" is disabled → ${flag.type === "variant" ? "null" : "false"}`
      );
    }
    return flag.type === "variant" ? null : false;
  }

  // Check rules in order — first match wins
  for (let i = 0; i < flag.rules.length; i++) {
    const rule = flag.rules[i];
    const matched = matchesRule(user, rule, segments);
    if (matched) {
      const result = flag.type === "variant" ? (rule.variant ?? null) : (rule.enabled ?? false);
      if (debug) {
        logger.debug(`[feature-flags] "${flag.key}" matched rule ${i} → ${JSON.stringify(result)}`);
      }
      return result;
    }
  }

  // No rules matched — use deterministic hashing
  const hash = deterministicHash(`${userId}:${flag.key}`);

  if (flag.type === "boolean") {
    const result = hash < flag.rolloutPercentage;
    if (debug) {
      logger.debug(
        `[feature-flags] "${flag.key}" no rules matched, hash=${hash} rollout=${flag.rolloutPercentage}% → ${result}`
      );
    }
    return result;
  }

  // Variant assignment based on cumulative weights
  let cumulativeWeight = 0;
  for (const variant of flag.variants) {
    cumulativeWeight += variant.weight;
    if (hash < cumulativeWeight) {
      if (debug) {
        logger.debug(
          `[feature-flags] "${flag.key}" no rules matched, hash=${hash} → variant "${variant.key}"`
        );
      }
      return variant.key;
    }
  }

  // Fallback (shouldn't happen if weights sum to 100)
  const fallback = flag.variants.length > 0 ? flag.variants[flag.variants.length - 1].key : null;
  if (debug) {
    logger.debug(`[feature-flags] "${flag.key}" variant fallback → ${JSON.stringify(fallback)}`);
  }
  return fallback;
};

/**
 * Evaluate all enabled, non-archived feature flags for a user.
 * Returns a map of flag key to evaluation result.
 */
export const evaluateAllFlags = async (
  flagModel: typeof import("./featureFlagModel").FeatureFlag,
  userId: string,
  user: unknown,
  segments: Record<string, SegmentFunction>
): Promise<EvaluationResult> => {
  const flags = await flagModel.find({archived: {$ne: true}, enabled: true});
  const results: EvaluationResult = {};

  if (isDebugEnabled()) {
    logger.debug(`[feature-flags] evaluating ${flags.length} flags for user ${userId}`);
  }

  for (const flag of flags) {
    results[flag.key] = evaluateFlag(flag, userId, user, segments);
  }

  if (isDebugEnabled()) {
    logger.debug(`[feature-flags] results: ${JSON.stringify(results)}`);
  }

  return results;
};
