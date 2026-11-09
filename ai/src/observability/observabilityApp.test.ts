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

// Only "local" is a typed primary; these cases check runtime validation of other ids.
const REMOTE = "remote" as never;

const createRemotePlugin = (): ObservabilityPlugin => {
  return {
    capabilities: new Set(["datasets", "experiments", "prompts", "scores", "traces"]),
    datasetStore: {},
    experimentRunner: {},
    id: "remote",
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
        control: {datasets: "local", experiments: REMOTE},
        plugins: [createLocalPlugin(), createRemotePlugin()],
      });
    }).toThrow(/experiments\.primary must equal datasets\.primary/);
  });

  it("rejects a reviewQueue.primary other than local", () => {
    expect(() => {
      new ObservabilityApp({
        control: {reviewQueue: REMOTE},
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
          datasets: REMOTE,
          experiments: REMOTE,
          prompts: REMOTE,
        },
        plugins: [createLocalPlugin()],
      });
    }).toThrow(/prompts primary "remote" has no plugin/);
  });
});
