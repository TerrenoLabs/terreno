import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {AI_HARNESS_GROUP, HARNESS_APPROVALS_SCREEN, harnessAdminScreens} from "./adminScreens";
import {Harness, HarnessApp} from "./harness";

describe("harnessAdminScreens", () => {
  it("lists the approvals inbox in the AI Harness group", () => {
    expect(harnessAdminScreens()).toEqual([
      {displayName: "Approvals", group: AI_HARNESS_GROUP, name: HARNESS_APPROVALS_SCREEN},
    ]);
    expect(HARNESS_APPROVALS_SCREEN).toBe("harness-approvals");
    expect(AI_HARNESS_GROUP).toBe("AI Harness");
  });
});

describe("HarnessApp.adminContribution", () => {
  let harness: Harness;

  beforeAll(async () => {
    createLocalObservabilityPlugin();
    harness = await Harness.open({registry: []});
  });

  afterAll(async () => {
    await harness.stop();
  });

  it("contributes the harness admin screens so AdminApp lists them", () => {
    expect(new HarnessApp({harness}).adminContribution()).toEqual({
      customScreens: harnessAdminScreens(),
    });
  });
});
