import {afterEach, describe, expect, it} from "bun:test";

import {observabilityAdminScreens} from "./adminScreens";
import {ObservabilityApp, resetObservabilityApp} from "./observabilityApp";
import type {ObservabilityPlugin} from "./types";

const LOCAL_CAPABILITIES = new Set([
  "datasets",
  "experiments",
  "prompts",
  "reviewQueue",
  "scores",
  "traces",
] as const);

const createLocalPlugin = (): ObservabilityPlugin => {
  return {
    capabilities: LOCAL_CAPABILITIES,
    datasetStore: {},
    experimentRunner: {},
    id: "local",
    promptRegistry: {get: async () => undefined},
    reviewQueue: {},
    scoreSink: {export: async () => {}},
    traceSink: {export: async () => {}},
  };
};

const createLangfusePlugin = (): ObservabilityPlugin => {
  return {
    capabilities: new Set(["datasets", "experiments", "prompts", "scores", "traces"]),
    datasetStore: {},
    experimentRunner: {},
    id: "langfuse",
    promptRegistry: {get: async () => undefined},
    scoreSink: {export: async () => {}},
    traceSink: {export: async () => {}},
  };
};

describe("ObservabilityApp config", () => {
  afterEach(() => {
    resetObservabilityApp();
  });
  it("accepts a local-only plugin with default primaries", () => {
    const app = new ObservabilityApp({plugins: [createLocalPlugin()]});
    expect(app.control).toEqual({
      datasets: "local",
      experiments: "local",
      prompts: "local",
      reviewQueue: "local",
    });
  });

  it("rejects experiments.primary that does not equal datasets.primary", () => {
    expect(() => {
      new ObservabilityApp({
        control: {datasets: "local", experiments: "langfuse"},
        plugins: [createLocalPlugin(), createLangfusePlugin()],
      });
    }).toThrow(/experiments\.primary must equal datasets\.primary/);
  });

  it("rejects reviewQueue.primary langfuse", () => {
    expect(() => {
      new ObservabilityApp({
        control: {reviewQueue: "langfuse"},
        plugins: [createLocalPlugin()],
      });
    }).toThrow(/reviewQueue\.primary must be local/);
  });

  it("contributes an AI Observability screen group including review when local is on", () => {
    const app = new ObservabilityApp({plugins: [createLocalPlugin()]});
    expect(app.adminContribution()).toEqual({
      customScreens: observabilityAdminScreens({localOn: true}),
    });
  });

  it("rejects a primary whose plugin is missing", () => {
    expect(() => {
      new ObservabilityApp({
        control: {
          datasets: "langfuse",
          experiments: "langfuse",
          prompts: "langfuse",
        },
        plugins: [createLocalPlugin()],
      });
    }).toThrow(/prompts primary "langfuse" has no plugin/);
  });
});
