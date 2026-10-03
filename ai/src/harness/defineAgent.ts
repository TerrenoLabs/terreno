import type {
  HarnessAgentDefinition,
  HarnessAgentDefinitionInput,
  HarnessModelRef,
} from "../types/harness";
import {HARNESS_AGENT_DEFAULT_MAX_STEPS} from "../types/harness";
import {assertValidRetryPolicy} from "./retryBackoff";

const assertModelRef = (agent: string, label: string, ref: HarnessModelRef | undefined): void => {
  if (!ref?.provider?.trim() || !ref.modelId?.trim()) {
    throw new Error(`defineAgent(${agent}): ${label} needs a provider and a modelId`);
  }
};

/**
 * Declare an agent: a model, instructions, and tools. Running it runs the built-in
 * `terreno.agent.turn` task on a conversation, one durable phase per model request and
 * per batch of tool calls.
 */
export const defineAgent = (definition: HarnessAgentDefinitionInput): HarnessAgentDefinition => {
  const {name} = definition;
  if (!name?.trim()) {
    throw new Error("defineAgent: name is required");
  }
  assertModelRef(name, "model", definition.model);
  for (const fallback of definition.fallbackModels ?? []) {
    assertModelRef(name, "each fallback model", fallback);
  }
  if (typeof definition.instructions !== "string") {
    throw new Error(`defineAgent(${name}): instructions must be a string`);
  }
  const maxSteps = definition.maxSteps ?? HARNESS_AGENT_DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error(`defineAgent(${name}): maxSteps must be a positive integer`);
  }
  if (definition.modelRetry !== undefined) {
    assertValidRetryPolicy(`defineAgent(${name})`, definition.modelRetry, "modelRetry");
  }
  const tools = definition.tools ?? [];
  const toolNames = new Set<string>();
  for (const tool of tools) {
    if (tool?.kind !== "tool") {
      throw new Error(`defineAgent(${name}): every tool must come from defineTool`);
    }
    if (toolNames.has(tool.name)) {
      throw new Error(`defineAgent(${name}): tool "${tool.name}" is listed more than once`);
    }
    toolNames.add(tool.name);
  }
  if (definition.output !== undefined && typeof definition.output.safeParse !== "function") {
    throw new Error(`defineAgent(${name}): output must be a zod schema`);
  }
  return Object.freeze({...definition, kind: "agent" as const, maxSteps, tools});
};
