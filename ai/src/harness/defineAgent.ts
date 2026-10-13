import type {
  HarnessAgentDefinition,
  HarnessAgentDefinitionInput,
  HarnessExtensionDefinition,
  HarnessModelRef,
} from "../types/harness";
import {HARNESS_AGENT_DEFAULT_MAX_STEPS} from "../types/harness";
import {HarnessDefinitionError} from "./definitionError";
import {assertValidRetryPolicy} from "./retryBackoff";

const assertModelRef = (agent: string, label: string, ref: HarnessModelRef | undefined): void => {
  if (!ref?.provider?.trim() || !ref.modelId?.trim()) {
    throw new HarnessDefinitionError(
      `defineAgent(${agent}): ${label} needs a provider and a modelId`
    );
  }
};

/** An extension reference (definition or name) as its name. */
export const extensionName = (
  owner: string,
  entry: HarnessExtensionDefinition | string
): string => {
  const name = typeof entry === "string" ? entry : entry?.kind === "extension" ? entry.name : "";
  if (!name?.trim()) {
    throw new HarnessDefinitionError(
      `${owner}: every extension must be a defineExtension result or its name`
    );
  }
  return name;
};

/**
 * Declare an agent: a model, instructions, and tools. Running it runs the built-in
 * `terreno.agent.turn` task on a conversation, one durable phase per model request and
 * per batch of tool calls.
 */
export const defineAgent = (definition: HarnessAgentDefinitionInput): HarnessAgentDefinition => {
  const {name} = definition;
  if (!name?.trim()) {
    throw new HarnessDefinitionError("defineAgent: name is required");
  }
  assertModelRef(name, "model", definition.model);
  for (const fallback of definition.fallbackModels ?? []) {
    assertModelRef(name, "each fallback model", fallback);
  }
  if (typeof definition.instructions !== "string") {
    throw new HarnessDefinitionError(`defineAgent(${name}): instructions must be a string`);
  }
  const maxSteps = definition.maxSteps ?? HARNESS_AGENT_DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new HarnessDefinitionError(`defineAgent(${name}): maxSteps must be a positive integer`);
  }
  if (definition.modelRetry !== undefined) {
    assertValidRetryPolicy(`defineAgent(${name})`, definition.modelRetry, "modelRetry");
  }
  const tools = definition.tools ?? [];
  const toolNames = new Set<string>();
  for (const tool of tools) {
    if (tool?.kind !== "tool") {
      throw new HarnessDefinitionError(
        `defineAgent(${name}): every tool must come from defineTool`
      );
    }
    if (toolNames.has(tool.name)) {
      throw new HarnessDefinitionError(
        `defineAgent(${name}): tool "${tool.name}" is listed more than once`
      );
    }
    toolNames.add(tool.name);
  }
  if (definition.output !== undefined && typeof definition.output.safeParse !== "function") {
    throw new HarnessDefinitionError(`defineAgent(${name}): output must be a zod schema`);
  }
  const extensions = (definition.extensions ?? []).map((entry) =>
    extensionName(`defineAgent(${name})`, entry)
  );
  if (new Set(extensions).size !== extensions.length) {
    throw new HarnessDefinitionError(`defineAgent(${name}): an extension is listed more than once`);
  }
  return Object.freeze({...definition, extensions, kind: "agent" as const, maxSteps, tools});
};
