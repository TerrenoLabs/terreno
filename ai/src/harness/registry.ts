import type {
  HarnessAgentDefinition,
  HarnessExtensionDefinition,
  HarnessTaskDefinition,
} from "../types/harness";
import {HARNESS_TERMINAL_STATUSES} from "../types/harness";
import type {HarnessModels} from "./commit";
import {taskDefinitionKey} from "./defineTask";
import {harnessError} from "./errors";

/** Any task definition, whatever its input, state, and output types. */
export type AnyHarnessTaskDefinition = HarnessTaskDefinition<never, unknown, unknown>;

/** Anything `Harness.open({registry})` accepts. */
export type HarnessRegistryEntry =
  | AnyHarnessTaskDefinition
  | HarnessAgentDefinition
  | HarnessExtensionDefinition;

/**
 * Separate agents and extensions (each by unique name) from task definitions, and check
 * that every extension an agent uses is registered.
 */
export const splitRegistry = (
  registry: ReadonlyArray<HarnessRegistryEntry>
): {
  agents: Map<string, HarnessAgentDefinition>;
  extensions: Map<string, HarnessExtensionDefinition>;
  tasks: AnyHarnessTaskDefinition[];
} => {
  const agents = new Map<string, HarnessAgentDefinition>();
  const extensions = new Map<string, HarnessExtensionDefinition>();
  const tasks: AnyHarnessTaskDefinition[] = [];
  for (const entry of registry) {
    if (entry.kind === "extension") {
      if (extensions.has(entry.name)) {
        throw harnessError({
          detail: `Harness registry lists extension "${entry.name}" more than once`,
          kind: "configInvalid",
        });
      }
      extensions.set(entry.name, entry);
      continue;
    }
    if (entry.kind !== "agent") {
      tasks.push(entry);
      continue;
    }
    if (agents.has(entry.name)) {
      throw harnessError({
        detail: `Harness registry lists agent "${entry.name}" more than once`,
        kind: "configInvalid",
      });
    }
    agents.set(entry.name, entry);
  }
  for (const agent of agents.values()) {
    const missing = agent.extensions.find((name) => !extensions.has(name));
    if (missing !== undefined) {
      throw harnessError({
        detail: `Agent "${agent.name}" uses extension "${missing}", which is not in this harness registry`,
        kind: "configInvalid",
      });
    }
  }
  return {agents, extensions, tasks};
};

/**
 * Index definitions by exact `name@version`. Several versions of one name may sit side by
 * side so in-flight runs keep the handler they started on; one version listed twice throws.
 */
export const buildTaskRegistry = (
  registry: ReadonlyArray<AnyHarnessTaskDefinition>
): Map<string, HarnessTaskDefinition> => {
  const definitions = new Map<string, HarnessTaskDefinition>();
  for (const definition of registry) {
    if (definitions.has(definition.key)) {
      throw harnessError({
        detail: `Harness registry lists ${definition.key} more than once`,
        kind: "configInvalid",
      });
    }
    definitions.set(definition.key, definition as unknown as HarnessTaskDefinition);
  }
  return definitions;
};

interface VersionCount {
  _id: {name: string; version: number};
  count: number;
}

/**
 * Throw before any claim when a non-terminal task (pending, running, waiting, interrupted,
 * or being aborted) is pinned to a `name@version` this registry lacks, listing each one
 * with its task count. Running such a process would strand those tasks silently.
 */
export const assertInFlightVersionsRegistered = async ({
  definitions,
  models,
}: {
  definitions: Map<string, HarnessTaskDefinition>;
  models: HarnessModels;
}): Promise<void> => {
  const counts = await models.task.aggregate<VersionCount>([
    {$match: {status: {$nin: [...HARNESS_TERMINAL_STATUSES]}}},
    {$group: {_id: {name: "$name", version: "$version"}, count: {$sum: 1}}},
  ]);
  const missing = counts
    .map(({_id, count}) => ({count, key: taskDefinitionKey(_id)}))
    .filter(({key}) => !definitions.has(key))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (missing.length === 0) {
    return;
  }
  const listed = missing
    .map(({count, key}) => `${key} (${count} task${count === 1 ? "" : "s"})`)
    .join(", ");
  throw harnessError({
    detail: `Harness.start: in-flight tasks use task versions this registry does not register: ${listed}. Register those definitions (keep old versions until their tasks finish) or resolve the tasks first.`,
    kind: "configInvalid",
  });
};
