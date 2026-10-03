import {createHash} from "node:crypto";

import type {
  AnyHarnessToolDefinition,
  HarnessAgentDefinition,
  HarnessApprovalPolicy,
  HarnessApprovalRequest,
  HarnessBeforeToolResult,
  HarnessExtensionDefinition,
  HarnessExtensionDefinitionInput,
  HarnessHook,
  HarnessHookApi,
  HarnessHookHandlers,
  HarnessHookKind,
  HarnessModelRequest,
  HarnessSection,
  HarnessSectionInput,
  HarnessSystemPromptPart,
  HarnessToolCall,
  HarnessToolWrap,
} from "../types/harness";
import {HARNESS_HOOK_KINDS} from "../types/harness";
import {assertValidApprovalPolicies} from "./approvalPolicy";
import {isHarnessSuspendSignal} from "./suspend";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A hook that parked its task (an approval wait) must stop the phase, not fail it. */
const rethrowSuspend = (error: unknown): void => {
  if (isHarnessSuspendSignal(error)) {
    throw error;
  }
};

/**
 * A hook, a section, or a wrap threw. The step it ran in fails with this message: the
 * turn for sections and `beforeModelRequest`, the tool call (reported to the model) for
 * tool hooks and wraps.
 */
export class HarnessExtensionError extends Error {
  readonly extension: string;

  constructor(extension: string, what: string, cause: unknown) {
    super(`Extension "${extension}" ${what} failed: ${errorMessage(cause)}`);
    this.name = "HarnessExtensionError";
    this.extension = extension;
  }
}

/** A named piece of the system prompt, rebuilt before every model request. */
export const section = (name: string, build: HarnessSection["build"]): HarnessSection => {
  if (!name?.trim()) {
    throw new Error("section: name is required");
  }
  if (typeof build !== "function") {
    throw new Error(`section(${name}): build must be a function`);
  }
  return Object.freeze({build, kind: "section" as const, name});
};

/** A hook of `kind` (`beforeModelRequest`, `beforeTool`, `afterTool`). */
export const hook = <K extends HarnessHookKind>(
  kind: K,
  run: HarnessHookHandlers[K]
): HarnessHook => {
  if (!Object.values(HARNESS_HOOK_KINDS).includes(kind)) {
    throw new Error(
      `hook: kind must be one of ${Object.values(HARNESS_HOOK_KINDS).join(", ")}, not "${kind}"`
    );
  }
  if (typeof run !== "function") {
    throw new Error(`hook(${kind}): handler must be a function`);
  }
  return Object.freeze({hook: kind, kind: "hook" as const, run}) as HarnessHook;
};

/**
 * Decorate whichever tool named `toolOrName` wins (agent or extension). `wrap` receives
 * the tool and returns the tool to use instead, with the same name.
 */
export const wrapTool = (
  toolOrName: AnyHarnessToolDefinition | string,
  wrap: HarnessToolWrap["wrap"]
): HarnessToolWrap => {
  const toolName = typeof toolOrName === "string" ? toolOrName : toolOrName?.name;
  if (!toolName?.trim()) {
    throw new Error("wrapTool: a tool or tool name is required");
  }
  if (typeof wrap !== "function") {
    throw new Error(`wrapTool(${toolName}): wrap must be a function`);
  }
  return Object.freeze({kind: "wrap" as const, toolName, wrap});
};

/**
 * Declare an extension: prompt sections, tools, hooks, and tool wraps that agents and
 * conversations use by name. List it in `Harness.open({registry})`.
 */
export const defineExtension = (
  definition: HarnessExtensionDefinitionInput
): HarnessExtensionDefinition => {
  const {name} = definition;
  if (!name?.trim()) {
    throw new Error("defineExtension: name is required");
  }
  const sections = definition.sections ?? [];
  const sectionNames = new Set<string>();
  for (const entry of sections) {
    if (entry?.kind !== "section") {
      throw new Error(`defineExtension(${name}): every section must come from section()`);
    }
    if (sectionNames.has(entry.name)) {
      throw new Error(`defineExtension(${name}): section "${entry.name}" is listed more than once`);
    }
    sectionNames.add(entry.name);
  }
  const tools = definition.tools ?? [];
  const toolNames = new Set<string>();
  for (const tool of tools) {
    if (tool?.kind !== "tool") {
      throw new Error(`defineExtension(${name}): every tool must come from defineTool`);
    }
    if (toolNames.has(tool.name)) {
      throw new Error(`defineExtension(${name}): tool "${tool.name}" is listed more than once`);
    }
    toolNames.add(tool.name);
  }
  const hooks = definition.hooks ?? [];
  if (hooks.some((entry) => entry?.kind !== "hook")) {
    throw new Error(`defineExtension(${name}): every hook must come from hook()`);
  }
  const wraps = definition.wraps ?? [];
  if (wraps.some((entry) => entry?.kind !== "wrap")) {
    throw new Error(`defineExtension(${name}): every wrap must come from wrapTool()`);
  }
  const approvals: Readonly<Record<string, HarnessApprovalPolicy>> = Object.freeze({
    ...(definition.approvals ?? {}),
  });
  assertValidApprovalPolicies(`defineExtension(${name})`, definition.approvals);
  return Object.freeze({
    approvals,
    hooks,
    kind: "extension" as const,
    name,
    sections,
    tools,
    wraps,
  });
};

/** The extensions named by `names`, in order. Throws for a name the registry lacks. */
export const resolveExtensions = (
  extensions: Map<string, HarnessExtensionDefinition>,
  names: ReadonlyArray<string>
): HarnessExtensionDefinition[] =>
  names.map((name) => {
    const extension = extensions.get(name);
    if (!extension) {
      throw new Error(`Extension "${name}" is not in this harness registry`);
    }
    return extension;
  });

/**
 * The tools a conversation can call, by name: the agent's tools, then each extension's
 * in order (a later tool with the same name replaces an earlier one), then every wrap in
 * extension order applied to the winning tool (the first extension's wrap is innermost).
 */
export const resolveTools = (
  agent: HarnessAgentDefinition,
  extensions: ReadonlyArray<HarnessExtensionDefinition>
): Map<string, AnyHarnessToolDefinition> => {
  const tools = new Map<string, AnyHarnessToolDefinition>();
  for (const tool of agent.tools) {
    tools.set(tool.name, tool);
  }
  for (const extension of extensions) {
    for (const tool of extension.tools) {
      tools.set(tool.name, tool);
    }
  }
  for (const extension of extensions) {
    for (const {toolName, wrap} of extension.wraps) {
      const winner = tools.get(toolName);
      if (!winner) {
        continue;
      }
      let wrapped: AnyHarnessToolDefinition;
      try {
        wrapped = wrap(winner);
      } catch (error: unknown) {
        throw new HarnessExtensionError(extension.name, `wrap of tool "${toolName}"`, error);
      }
      if (wrapped?.kind !== "tool" || wrapped.name !== toolName) {
        throw new Error(
          `Extension "${extension.name}" wrap of tool "${toolName}" must return a defineTool tool named "${toolName}"`
        );
      }
      tools.set(toolName, wrapped);
    }
  }
  return tools;
};

/** The effective system prompt, and what it was built from. */
export interface SystemPrompt {
  hash: string;
  sections: HarnessSystemPromptPart["sections"];
  text: string;
}

export const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Agent instructions, then each non-empty section in extension and section order. */
export const buildSystemPrompt = async ({
  api,
  extensions,
  input,
  instructions,
}: {
  api: HarnessHookApi;
  extensions: ReadonlyArray<HarnessExtensionDefinition>;
  input: HarnessSectionInput;
  instructions: string;
}): Promise<SystemPrompt> => {
  const pieces: string[] = instructions ? [instructions] : [];
  const sections: SystemPrompt["sections"] = [];
  for (const extension of extensions) {
    for (const entry of extension.sections) {
      let text: string | undefined;
      try {
        text = await entry.build(input, api);
      } catch (error: unknown) {
        rethrowSuspend(error);
        throw new HarnessExtensionError(extension.name, `section "${entry.name}"`, error);
      }
      if (text === undefined || text === null || !String(text).trim()) {
        continue;
      }
      pieces.push(String(text));
      sections.push({extension: extension.name, name: entry.name});
    }
  }
  const text = pieces.join("\n\n");
  return {hash: hashText(text), sections, text};
};

/** Hooks of `kind`, in extension order, each with the extension that declared it. */
const hooksOf = <K extends HarnessHookKind>(
  extensions: ReadonlyArray<HarnessExtensionDefinition>,
  kind: K
): Array<{extension: string; run: HarnessHookHandlers[K]}> =>
  extensions.flatMap((extension) =>
    extension.hooks
      .filter((entry) => entry.hook === kind)
      .map((entry) => ({extension: extension.name, run: entry.run as HarnessHookHandlers[K]}))
  );

/** Hooks a model request went through, with the extensions whose hooks rewrote it. */
export interface RewrittenRequest {
  request: HarnessModelRequest;
  rewrittenBy: string[];
}

/** Run every `beforeModelRequest` hook in order; each sees the previous one's result. */
export const runBeforeModelRequest = async ({
  api,
  extensions,
  request,
}: {
  api: HarnessHookApi;
  extensions: ReadonlyArray<HarnessExtensionDefinition>;
  request: HarnessModelRequest;
}): Promise<RewrittenRequest> => {
  let current = request;
  const rewrittenBy: string[] = [];
  for (const {extension, run} of hooksOf(extensions, HARNESS_HOOK_KINDS.beforeModelRequest)) {
    let next: HarnessModelRequest | undefined;
    try {
      next = await run(current, api);
    } catch (error: unknown) {
      rethrowSuspend(error);
      throw new HarnessExtensionError(extension, "beforeModelRequest hook", error);
    }
    if (next === undefined) {
      continue;
    }
    if (typeof next?.system !== "string" || !Array.isArray(next.messages)) {
      throw new Error(
        `Extension "${extension}" beforeModelRequest hook must return {system, messages} or undefined`
      );
    }
    current = next;
    rewrittenBy.push(extension);
  }
  return {request: current, rewrittenBy};
};

/** Result of the `beforeTool` hooks: the call is blocked, or runs with these args. */
export type BeforeToolOutcome = {args: unknown; blocked?: undefined} | {blocked: string};

/**
 * Run every `beforeTool` hook in order. The first `{block}` stops the rest. Each hook's
 * `api.approval` resolves approvers from that hook's own extension. A hook waiting on an
 * approval suspends the tool call (the suspend signal passes through untouched).
 */
export const runBeforeTool = async ({
  api,
  approvalFor,
  call,
  extensions,
}: {
  api: HarnessHookApi;
  approvalFor: (extension: string) => HarnessApprovalRequest;
  call: HarnessToolCall;
  extensions: ReadonlyArray<HarnessExtensionDefinition>;
}): Promise<BeforeToolOutcome> => {
  let {args} = call;
  for (const {extension, run} of hooksOf(extensions, HARNESS_HOOK_KINDS.beforeTool)) {
    let decision: HarnessBeforeToolResult;
    try {
      decision = await run({...call, args}, {...api, approval: approvalFor(extension)});
    } catch (error: unknown) {
      rethrowSuspend(error);
      throw new HarnessExtensionError(extension, "beforeTool hook", error);
    }
    if (decision === undefined) {
      continue;
    }
    if ("block" in decision) {
      return {blocked: String(decision.block)};
    }
    if ("args" in decision) {
      args = decision.args;
      continue;
    }
    throw new Error(
      `Extension "${extension}" beforeTool hook must return undefined, {block}, or {args}`
    );
  }
  return {args};
};

/** Run every `afterTool` hook in order; each sees the previous one's result. */
export const runAfterTool = async ({
  api,
  call,
  extensions,
  result,
}: {
  api: HarnessHookApi;
  call: HarnessToolCall;
  extensions: ReadonlyArray<HarnessExtensionDefinition>;
  result: unknown;
}): Promise<unknown> => {
  let current = result;
  for (const {extension, run} of hooksOf(extensions, HARNESS_HOOK_KINDS.afterTool)) {
    let next: unknown;
    try {
      next = await run(call, current, api);
    } catch (error: unknown) {
      throw new HarnessExtensionError(extension, "afterTool hook", error);
    }
    if (next !== undefined) {
      current = next;
    }
  }
  return current;
};
