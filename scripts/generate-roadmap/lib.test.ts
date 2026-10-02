import {describe, it} from "bun:test";
import {assert} from "chai";

import {displayTitle, filterRoadmapItems, type RoadmapItem, renderRoadmapMarkdown} from "./lib";

const sampleItems: RoadmapItem[] = [
  {
    area: "dx",
    impact: "Improvement",
    ipSlug: "oss-governance-baseline",
    status: "Shipped",
    target: "Next",
    title: "OSS governance baseline",
    url: "https://github.com/TerrenoLabs/terreno/issues/1",
  },
  {
    area: "docs",
    impact: "Feature",
    ipSlug: "docs-tutorials-ai-first",
    status: "Planned",
    target: "Future",
    title: "AI-first tutorials",
    url: "https://github.com/TerrenoLabs/terreno/issues/2",
  },
  {
    area: "deploy",
    impact: "Improvement",
    ipSlug: null,
    status: "Declined",
    target: "Next",
    title: "Declined item",
    url: "https://github.com/TerrenoLabs/terreno/issues/3",
  },
];

describe("filterRoadmapItems", () => {
  it("excludes declined items", (): void => {
    const filtered = filterRoadmapItems(sampleItems);
    assert.equal(filtered.length, 2);
    assert.isFalse(filtered.some((item) => item.title === "Declined item"));
  });
});

describe("renderRoadmapMarkdown", () => {
  it("groups by target then area", (): void => {
    const markdown = renderRoadmapMarkdown({
      generatedAtIso: "2026-08-08T00:00:00.000Z",
      items: sampleItems,
      projectUrl: "https://github.com/orgs/FlourishHealth/projects/1",
    });

    assert.include(markdown, "## Target: Next");
    assert.include(markdown, "### dx");
    assert.include(markdown, "oss-governance-baseline");
    assert.include(markdown, "## Target: Future");
    assert.notInclude(markdown, "Declined item");
  });

  it("links the task list only when one exists", (): void => {
    const markdown = renderRoadmapMarkdown({
      generatedAtIso: "2026-08-08T00:00:00.000Z",
      items: sampleItems,
      projectUrl: "https://github.com/orgs/FlourishHealth/projects/1",
      taskSlugs: new Set(["oss-governance-baseline"]),
    });

    assert.include(
      markdown,
      "Tasks: [oss-governance-baseline](docs/tasks/oss-governance-baseline.md)"
    );
    assert.notInclude(markdown, "docs/tasks/docs-tutorials-ai-first.md");
  });
});

describe("displayTitle", (): void => {
  it("drops the legacy [Roadmap] tracking prefix", (): void => {
    assert.equal(displayTitle("[Roadmap] Deploy to GCP"), "Deploy to GCP");
  });

  it("leaves an untagged title alone", (): void => {
    assert.equal(displayTitle("Deploy to GCP"), "Deploy to GCP");
  });

  it("keeps the original when the prefix is the whole title", (): void => {
    assert.equal(displayTitle("[Roadmap]"), "[Roadmap]");
  });
});
