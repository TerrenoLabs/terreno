import {describe, expect, it} from "bun:test";
import {z} from "@terreno/api";
import {harnessErrorMatching} from "../tests/harnessErrors";
import {defineAgent} from "./defineAgent";
import {defineTask} from "./defineTask";
import {defineTool} from "./defineTool";

const model = {modelId: "claude-sonnet-5-5", provider: "anthropic"};

const echo = defineTool({
  description: "Echo the text back",
  execute: async ({text}: {text: string}) => text,
  name: "echo",
  parameters: z.object({text: z.string()}),
});

describe("defineTool", () => {
  it("defaults replay to never and freezes the definition", () => {
    expect(echo.kind).toBe("tool");
    expect(echo.replay).toBe("never");
    expect(Object.isFrozen(echo)).toBe(true);
    expect(defineTool({...echo, replay: "safe"}).replay).toBe("safe");
  });

  it.each([
    [{name: "has space"}, 'name must be 1-64 letters, digits, "_" or "-"'],
    [{name: "x".repeat(65)}, 'name must be 1-64 letters, digits, "_" or "-"'],
    [{description: " "}, "description is required"],
    [{parameters: {}}, "parameters must be a zod schema"],
    [{execute: "nope"}, "execute must be a function"],
    [{replay: "sometimes"}, 'replay must be "safe" or "never"'],
  ])("rejects %p", (override, message) => {
    expect(() => defineTool({...echo, ...(override as object)} as never)).toThrow(
      harnessErrorMatching("definitionInvalid", message)
    );
  });
});

describe("defineAgent", () => {
  it("fills defaults", () => {
    const agent = defineAgent({instructions: "Help.", model, name: "test.helper"});
    expect(agent.kind).toBe("agent");
    expect(agent.maxSteps).toBe(10);
    expect(agent.tools).toEqual([]);
  });

  it.each([
    [{name: ""}, "defineAgent: name is required"],
    [{model: {modelId: "", provider: "anthropic"}}, "model needs a provider and a modelId"],
    [{fallbackModels: [{modelId: "x"}]}, "each fallback model needs a provider and a modelId"],
    [{instructions: 3}, "instructions must be a string"],
    [{maxSteps: 0}, "maxSteps must be a positive integer"],
    [{maxSteps: 1.5}, "maxSteps must be a positive integer"],
    [{modelRetry: {maxAttempts: 0}}, "modelRetry.maxAttempts must be a positive integer"],
    [{tools: [{name: "raw"}]}, "every tool must come from defineTool"],
    [{tools: [echo, echo]}, 'tool "echo" is listed more than once'],
    [{output: {}}, "output must be a zod schema"],
  ])("rejects %p", (override, message) => {
    expect(() =>
      defineAgent({instructions: "Help.", model, name: "test.helper", ...(override as object)})
    ).toThrow(harnessErrorMatching("definitionInvalid", message));
  });
});

describe("defineTask agent-related options", () => {
  const base = {
    initial: () => ({phase: "run"}),
    name: "test.options",
    phases: {run: {run: async () => {}}},
    version: 1,
  };

  it.each([
    [{onInterrupt: "explode"}, 'onInterrupt must be "park" or "fail"'],
    [{spanKind: "LLM"}, "spanKind must be AGENT, CHAIN, or TOOL"],
    [{spanName: "fixed"}, "spanName must be a function"],
  ])("rejects %p", (override, message) => {
    expect(() => defineTask({...base, ...(override as object)} as never)).toThrow(
      harnessErrorMatching("definitionInvalid", message)
    );
  });

  it("accepts the valid values", () => {
    const task = defineTask({
      ...base,
      onInterrupt: "fail",
      spanKind: "TOOL",
      spanName: () => "named",
    });
    expect(task.onInterrupt).toBe("fail");
  });
});
