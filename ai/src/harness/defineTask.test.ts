import {describe, expect, it} from "bun:test";

import type {HarnessTaskDefinitionInput} from "../types/harness";
import {defineTask, taskDefinitionKey} from "./defineTask";

const validInput = (): HarnessTaskDefinitionInput<unknown, unknown, unknown> => ({
  initial: () => ({phase: "only"}),
  name: "test.define",
  phases: {only: {run: async () => {}}},
  version: 1,
});

describe("defineTask", () => {
  it("returns a frozen task definition keyed by name@version", () => {
    const definition = defineTask({...validInput(), retry: {maxAttempts: 2}, version: 3});
    expect(definition.kind).toBe("task");
    expect(definition.key).toBe("test.define@3");
    expect(definition.retry).toEqual({maxAttempts: 2});
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it("keeps phase replay policies and the abort handler", () => {
    const abort = async (): Promise<void> => {};
    const definition = defineTask({
      ...validInput(),
      abort,
      phases: {
        risky: {run: async () => {}},
        safe: {replay: "safe", run: async () => {}},
      },
    });
    expect(definition.phases.safe.replay).toBe("safe");
    expect(definition.phases.risky.replay).toBeUndefined();
    expect(definition.abort).toBe(abort);
  });

  it("formats registry keys", () => {
    expect(taskDefinitionKey({name: "clinic.intake", version: 2})).toBe("clinic.intake@2");
  });

  it.each([
    [{name: "  "}, "defineTask: name is required"],
    [{version: 0}, "defineTask(test.define): version must be a positive integer"],
    [{version: 1.5}, "defineTask(test.define): version must be a positive integer"],
    [{phases: {}}, "defineTask(test.define): at least one phase is required"],
    [
      {phases: {broken: {} as unknown as {run: () => Promise<void>}}},
      'defineTask(test.define): phase "broken" needs a run function',
    ],
    [
      {phases: {odd: {replay: "sometimes" as "safe", run: async () => {}}}},
      'defineTask(test.define): phase "odd" replay must be "safe" or "never"',
    ],
  ])("rejects an invalid definition %#", (override, message) => {
    expect(() => defineTask({...validInput(), ...override})).toThrow(message);
  });
});
