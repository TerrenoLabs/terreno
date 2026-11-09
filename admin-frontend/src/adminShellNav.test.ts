import {describe, it} from "bun:test";
import {assert} from "chai";

import {buildAdminSidebarGroups, groupAdminModelsByGroup} from "./adminShellNav";
import type {AdminModelConfig} from "./types";

const stubModel = (name: string, displayName: string, group?: string): AdminModelConfig =>
  ({
    defaultSort: "-created",
    displayName,
    fields: {},
    group,
    listFields: ["_id"],
    name,
    routePath: `/${name}`,
  }) as unknown as AdminModelConfig;

describe("groupAdminModelsByGroup", () => {
  it("groups by model.group and places General last", () => {
    const groups = groupAdminModelsByGroup([
      stubModel("A", "A", "Zebra"),
      stubModel("B", "B"),
      stubModel("C", "C", "Alpha"),
    ]);
    assert.deepEqual(
      groups.map((g) => g.group),
      ["Alpha", "Zebra", "General"]
    );
    assert.deepEqual(
      groups[0]?.models.map((m) => m.name),
      ["C"]
    );
    assert.deepEqual(
      groups[1]?.models.map((m) => m.name),
      ["A"]
    );
    assert.deepEqual(
      groups[2]?.models.map((m) => m.name),
      ["B"]
    );
  });

  it("returns no groups when models is missing", () => {
    assert.deepEqual(groupAdminModelsByGroup(undefined as unknown as AdminModelConfig[]), []);
  });
});

describe("buildAdminSidebarGroups", () => {
  it("places grouped custom screens in matching model groups before models", () => {
    const {groups, ungroupedScreens} = buildAdminSidebarGroups({
      customScreens: [
        {displayName: "Overview", group: "Announcements", name: "announcements"},
        {displayName: "Reports", name: "reports"},
      ],
      models: [
        stubModel("Announcement", "All announcements", "Announcements"),
        stubModel("User", "Users", "Accounts"),
      ],
    });

    assert.deepEqual(
      ungroupedScreens.map((screen) => screen.name),
      ["reports"]
    );
    assert.deepEqual(
      groups.map((entry) => entry.group),
      ["Accounts", "Announcements"]
    );
    const announcements = groups.find((entry) => entry.group === "Announcements");
    assert.deepEqual(
      announcements?.customScreens.map((screen) => screen.name),
      ["announcements"]
    );
    assert.deepEqual(
      announcements?.models.map((model) => model.name),
      ["Announcement"]
    );
  });

  it("creates a sidebar group for grouped screens without matching models", () => {
    const {groups, ungroupedScreens} = buildAdminSidebarGroups({
      customScreens: [{displayName: "Insights", group: "Analytics", name: "insights"}],
      models: [],
    });

    assert.deepEqual(ungroupedScreens, []);
    assert.deepEqual(groups, [
      {
        customScreens: [{displayName: "Insights", group: "Analytics", name: "insights"}],
        group: "Analytics",
        models: [],
      },
    ]);
  });

  it("keeps AI Observability screens in their own sidebar group", () => {
    const {groups, ungroupedScreens} = buildAdminSidebarGroups({
      customScreens: [
        {displayName: "AI Requests", name: "ai-requests"},
        {displayName: "Prompts", group: "AI Observability", name: "ai-prompts"},
        {displayName: "Review queue", group: "AI Observability", name: "ai-review"},
      ],
      models: [],
    });

    assert.deepEqual(
      ungroupedScreens.map((screen) => screen.name),
      ["ai-requests"]
    );
    assert.deepEqual(groups, [
      {
        customScreens: [
          {displayName: "Prompts", group: "AI Observability", name: "ai-prompts"},
          {displayName: "Review queue", group: "AI Observability", name: "ai-review"},
        ],
        group: "AI Observability",
        models: [],
      },
    ]);
  });
});
