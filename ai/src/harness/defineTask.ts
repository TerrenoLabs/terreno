import type {HarnessTaskDefinition, HarnessTaskDefinitionInput} from "../types/harness";
import {assertValidApprovalPolicies} from "./approvalPolicy";
import {assertValidRetryPolicy} from "./retryBackoff";

/** Registry key that pins a run to one definition version. */
export const taskDefinitionKey = ({name, version}: {name: string; version: number}): string =>
  `${name}@${version}`;

/**
 * Declare a durable, multi-phase task. Each phase does work and calls `rt.commit()`
 * with the next phase or a terminal outcome; a committed phase is the resume point.
 */
export const defineTask = <In, State, Out>(
  definition: HarnessTaskDefinitionInput<In, State, Out>
): HarnessTaskDefinition<In, State, Out> => {
  if (!definition.name?.trim()) {
    throw new Error("defineTask: name is required");
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`defineTask(${definition.name}): version must be a positive integer`);
  }
  const phaseNames = Object.keys(definition.phases ?? {});
  if (phaseNames.length === 0) {
    throw new Error(`defineTask(${definition.name}): at least one phase is required`);
  }
  for (const phaseName of phaseNames) {
    const phase = definition.phases[phaseName];
    if (typeof phase?.run !== "function") {
      throw new Error(`defineTask(${definition.name}): phase "${phaseName}" needs a run function`);
    }
    if (phase.replay !== undefined && phase.replay !== "safe" && phase.replay !== "never") {
      throw new Error(
        `defineTask(${definition.name}): phase "${phaseName}" replay must be "safe" or "never"`
      );
    }
  }
  if (definition.retry !== undefined) {
    assertValidRetryPolicy(`defineTask(${definition.name})`, definition.retry);
  }
  if (
    definition.onInterrupt !== undefined &&
    definition.onInterrupt !== "park" &&
    definition.onInterrupt !== "fail"
  ) {
    throw new Error(`defineTask(${definition.name}): onInterrupt must be "park" or "fail"`);
  }
  if (
    definition.spanKind !== undefined &&
    !["AGENT", "CHAIN", "TOOL"].includes(definition.spanKind)
  ) {
    throw new Error(`defineTask(${definition.name}): spanKind must be AGENT, CHAIN, or TOOL`);
  }
  if (definition.spanName !== undefined && typeof definition.spanName !== "function") {
    throw new Error(`defineTask(${definition.name}): spanName must be a function`);
  }
  if (definition.abort !== undefined && typeof definition.abort !== "function") {
    throw new Error(`defineTask(${definition.name}): abort must be a function`);
  }
  assertValidApprovalPolicies(`defineTask(${definition.name})`, definition.approvals);
  return Object.freeze({
    ...definition,
    key: taskDefinitionKey(definition),
    kind: "task" as const,
  });
};
