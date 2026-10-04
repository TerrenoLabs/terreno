import type {HarnessToolDefinition, HarnessToolDefinitionInput} from "../types/harness";
import {HarnessDefinitionError} from "./definitionError";

/** Provider-safe tool names (the strictest common limit across providers). */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Declare a tool an agent may call. Each call runs as its own child task of the turn;
 * `replay` (default `"never"`) decides whether an interrupted call is re-run or reported
 * to the model as "interrupted, not retried".
 */
export const defineTool = <Args, Result>(
  definition: HarnessToolDefinitionInput<Args, Result>
): HarnessToolDefinition<Args, Result> => {
  if (!TOOL_NAME_PATTERN.test(definition.name ?? "")) {
    throw new HarnessDefinitionError(
      `defineTool(${definition.name}): name must be 1-64 letters, digits, "_" or "-"`
    );
  }
  if (!definition.description?.trim()) {
    throw new HarnessDefinitionError(`defineTool(${definition.name}): description is required`);
  }
  if (typeof definition.parameters?.safeParse !== "function") {
    throw new HarnessDefinitionError(
      `defineTool(${definition.name}): parameters must be a zod schema`
    );
  }
  if (typeof definition.execute !== "function") {
    throw new HarnessDefinitionError(`defineTool(${definition.name}): execute must be a function`);
  }
  if (
    definition.replay !== undefined &&
    definition.replay !== "safe" &&
    definition.replay !== "never"
  ) {
    throw new HarnessDefinitionError(
      `defineTool(${definition.name}): replay must be "safe" or "never"`
    );
  }
  return Object.freeze({
    ...definition,
    kind: "tool" as const,
    replay: definition.replay ?? "never",
  });
};
