import {describe, expect, it} from "bun:test";

import {AI_OBSERVABILITY_GROUP, observabilityAdminScreens} from "./adminScreens";

describe("observabilityAdminScreens", () => {
  it("omits the review queue when the local plugin is off", () => {
    const screens = observabilityAdminScreens({localOn: false});
    expect(screens.map((screen) => screen.name)).toEqual([
      "ai-prompts",
      "ai-traces",
      "ai-evaluators",
      "ai-datasets",
      "ai-experiments",
    ]);
    expect(screens.every((screen) => screen.group === AI_OBSERVABILITY_GROUP)).toBe(true);
  });

  it("includes the review queue when the local plugin is on", () => {
    const screens = observabilityAdminScreens({localOn: true});
    expect(screens.map((screen) => screen.name)).toEqual([
      "ai-prompts",
      "ai-traces",
      "ai-evaluators",
      "ai-datasets",
      "ai-experiments",
      "ai-review",
    ]);
  });

  it("declares list permissions per observability resource", () => {
    const screens = observabilityAdminScreens({localOn: true});
    expect(screens).toEqual([
      {
        adminAccess: {action: "list", resource: "aiPrompt"},
        displayName: "Prompts",
        group: AI_OBSERVABILITY_GROUP,
        name: "ai-prompts",
      },
      {
        adminAccess: {action: "list", resource: "aiTrace"},
        displayName: "Traces",
        group: AI_OBSERVABILITY_GROUP,
        name: "ai-traces",
      },
      {
        adminAccess: {action: "list", resource: "aiEvaluator"},
        displayName: "Evaluators",
        group: AI_OBSERVABILITY_GROUP,
        name: "ai-evaluators",
      },
      {
        adminAccess: {action: "list", resource: "aiDataset"},
        displayName: "Datasets",
        group: AI_OBSERVABILITY_GROUP,
        name: "ai-datasets",
      },
      {
        adminAccess: {action: "list", resource: "aiExperiment"},
        displayName: "Experiments",
        group: AI_OBSERVABILITY_GROUP,
        name: "ai-experiments",
      },
      {
        adminAccess: {action: "list", resource: "aiReview"},
        displayName: "Review queue",
        group: AI_OBSERVABILITY_GROUP,
        name: "ai-review",
      },
    ]);
  });
});
