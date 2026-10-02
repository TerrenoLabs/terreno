import {describe, it} from "bun:test";
import assert from "node:assert/strict";

import {parseFieldOptions, parseLabelNames} from "./checkRoadmapItem.ts";
import {parseBackfillTable, parseProjectFields, parseSeedIssues} from "./seedIssues.ts";
import {
  attachIssuesByIp,
  buildDesiredFields,
  COMMUNITY_FIELD_NAME,
  collectPagedNodes,
  IP_FIELD_NAME,
  planFields,
  planItemSync,
  planLabelWork,
  resolveSeedItems,
  shouldWriteBoardStatus,
  validateItems,
} from "./syncProject.ts";

const SEED_DOC = `# Roadmap seed issues

---

## alpha-ip

**Title:** \`Alpha thing\`

**Labels:** \`area:api\`, \`type:feature\`
**Project fields:** Area=\`api\`, Target=\`Next\`, Impact=\`Feature\`, IP=\`alpha-ip\`, Status=\`Planned\`

Alpha body line one.

- **Implementation plan:** somewhere.md

---

## no-ip-yet

**Title:** \`Not designed yet\`

**Labels:** \`area:ui\`, \`type:feature\`
**Project fields:** Area=\`ui\`, Target=\`Future\`, Impact=\`Feature\`, IP=*(not yet written)*, Status=\`Planned\`

Body for the undesigned item.

---

# Shipped, umbrella, and declined IPs

| IP slug | GitHub issue | Status | Area | Target | Impact | Type |
|---------|--------------|--------|------|--------|--------|------|
| \`alpha-ip\` | https://github.com/TerrenoLabs/terreno/issues/42 | \`Planned\` | \`api\` | \`Next\` | \`Feature\` | \`type:feature\` |
| \`shipped-thing\` | https://github.com/TerrenoLabs/terreno/issues/43 | \`Shipped\` | \`dx\` | \`Released\` | \`Improvement\` | \`type:chore\` |
`;

describe("collectPagedNodes", () => {
  it("walks every page and finds a title past the first 50 nodes", async () => {
    const pages: {id: string; number: number; title: string; url: string}[][] = [
      Array.from({length: 50}, (_, index) => ({
        id: `p${index}`,
        number: index + 1,
        title: `Other ${index}`,
        url: `https://example.test/${index}`,
      })),
      [
        {
          id: "target",
          number: 51,
          title: "Terreno Roadmap",
          url: "https://example.test/roadmap",
        },
      ],
    ];

    const nodes = await collectPagedNodes({
      fetchPage: async (after) => {
        const pageIndex = after === null ? 0 : Number(after);
        return {
          nodes: pages[pageIndex] ?? [],
          pageInfo: {
            endCursor: pageIndex === 0 ? "1" : null,
            hasNextPage: pageIndex === 0,
          },
        };
      },
    });

    assert.equal(nodes.length, 51);
    assert.equal(nodes.find((node) => node.title === "Terreno Roadmap")?.id, "target");
  });
});

describe("parseProjectFields", () => {
  it("reads backticked values", () => {
    const fields = parseProjectFields(
      "**Project fields:** Area=`api`, Target=`Next`, Status=`Planned`"
    );
    assert.equal(fields.Area, "api");
    assert.equal(fields.Target, "Next");
    assert.equal(fields.Status, "Planned");
  });

  it("treats an unwritten IP as empty", () => {
    const fields = parseProjectFields(
      "**Project fields:** IP=*(not yet written)*, Status=`Planned`"
    );
    assert.equal(fields.IP, "");
    assert.equal(fields.Status, "Planned");
  });
});

describe("parseBackfillTable", () => {
  it("reads every field column and the issue number", () => {
    const rows = parseBackfillTable(SEED_DOC);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], {
      area: "dx",
      body: null,
      impact: "Improvement",
      ip: "shipped-thing",
      issueNumber: 43,
      labels: ["area:dx", "type:chore", "roadmap"],
      slug: "shipped-thing",
      status: "Shipped",
      target: "Released",
      title: "",
    });
  });
});

describe("parseSeedIssues", () => {
  it("parses sections and table rows together", () => {
    const seeds = parseSeedIssues(SEED_DOC);
    assert.equal(seeds.filter((seed) => seed.body !== null).length, 2);
    assert.equal(seeds.filter((seed) => seed.body === null).length, 2);

    const alpha = seeds.find((seed) => seed.slug === "alpha-ip" && seed.body !== null);
    assert.equal(alpha?.title, "Alpha thing");
    assert.deepEqual(alpha?.labels, ["area:api", "type:feature", "roadmap"]);
    assert.ok(alpha?.body?.includes("Alpha body line one."));
    assert.ok(!alpha?.body?.includes("**Project fields:**"));

    const lastSection = seeds.find((seed) => seed.slug === "no-ip-yet" && seed.body !== null);
    assert.ok(lastSection?.body?.includes("Body for the undesigned item."));
    assert.ok(!lastSection?.body?.includes("Shipped, umbrella, and declined IPs"));
    assert.ok(!lastSection?.body?.includes("shipped-thing"));
  });
});

describe("resolveSeedItems", () => {
  const seeds = parseSeedIssues(SEED_DOC);

  it("merges a section with its table row instead of duplicating the slug", () => {
    const {items} = resolveSeedItems({issueNumbersByTitle: new Map(), seeds});
    const alpha = items.filter((item) => item.slug === "alpha-ip");
    assert.equal(alpha.length, 1);
    // The section supplies the body; the table supplies the issue number.
    assert.equal(alpha[0]?.issueNumber, 42);
    assert.ok(alpha[0]?.body?.includes("Alpha body line one."));
  });

  it("skips entries with no IP and no issue rather than opening speculative work", () => {
    const {items, skipped} = resolveSeedItems({issueNumbersByTitle: new Map(), seeds});
    assert.ok(!items.some((item) => item.slug === "no-ip-yet"));
    assert.deepEqual(
      skipped.map((entry) => entry.slug),
      ["no-ip-yet"]
    );
  });

  it("falls back to matching an existing issue by title", () => {
    const {items} = resolveSeedItems({
      issueNumbersByTitle: new Map([["Not designed yet", 99]]),
      seeds,
    });
    assert.equal(items.find((item) => item.slug === "no-ip-yet")?.issueNumber, 99);
  });

  it("matches a legacy [Roadmap]-prefixed entry against an unprefixed issue title", () => {
    const legacySeeds = parseSeedIssues(
      SEED_DOC.replace("**Title:** `Not designed yet`", "**Title:** `[Roadmap] Not designed yet`")
    );
    const {items} = resolveSeedItems({
      issueNumbersByTitle: new Map([["Not designed yet", 99]]),
      seeds: legacySeeds,
    });
    assert.equal(items.find((item) => item.slug === "no-ip-yet")?.issueNumber, 99);
  });
});

describe("buildDesiredFields", () => {
  it("declares the six board fields from the taxonomy files", () => {
    const fields = buildDesiredFields({
      options: {areas: ["api", "ui"], impact: ["Feature"], status: ["Planned"], target: ["Next"]},
    });
    assert.deepEqual(
      fields.map((field) => field.name),
      ["Status", "Area", "Target", "Impact", IP_FIELD_NAME, COMMUNITY_FIELD_NAME]
    );
    assert.deepEqual(fields.find((field) => field.name === "Area")?.options, ["api", "ui"]);
    assert.equal(fields.find((field) => field.name === IP_FIELD_NAME)?.dataType, "TEXT");
    assert.equal(fields.find((field) => field.name === COMMUNITY_FIELD_NAME)?.dataType, "NUMBER");
  });
});

describe("planFields", () => {
  const desired = buildDesiredFields({
    options: {
      areas: ["api"],
      impact: ["Feature"],
      status: ["Planned", "Shipped"],
      target: ["Next"],
    },
  });

  it("plans creation for every field on an empty board", () => {
    const plan = planFields({desired, existing: []});
    assert.equal(plan.create.length, 6);
    assert.equal(plan.rewriteOptions.length, 0);
    assert.equal(plan.conflicts.length, 0);
  });

  it("keeps existing options when adding a missing one", () => {
    const plan = planFields({
      desired,
      existing: [
        {
          dataType: "SINGLE_SELECT",
          id: "F1",
          name: "Status",
          options: [{id: "o1", name: "Planned"}],
        },
      ],
    });
    const rewrite = plan.rewriteOptions.find((entry) => entry.field.name === "Status");
    assert.deepEqual(rewrite?.missing, ["Shipped"]);
    // Existing option names must survive the rewrite or cards lose their value.
    assert.deepEqual(rewrite?.desired, ["Planned", "Shipped"]);
  });

  it("reports nothing to do when the board already matches", () => {
    const plan = planFields({
      desired: [{dataType: "SINGLE_SELECT", name: "Status", options: ["Planned"]}],
      existing: [
        {
          dataType: "SINGLE_SELECT",
          id: "F1",
          name: "Status",
          options: [{id: "o1", name: "Planned"}],
        },
      ],
    });
    assert.equal(plan.create.length, 0);
    assert.equal(plan.rewriteOptions.length, 0);
  });

  it("flags a data type mismatch instead of silently rewriting it", () => {
    const plan = planFields({
      desired: [{dataType: "TEXT", name: IP_FIELD_NAME, options: []}],
      existing: [{dataType: "SINGLE_SELECT", id: "F9", name: IP_FIELD_NAME, options: []}],
    });
    assert.equal(plan.create.length, 0);
    assert.equal(plan.conflicts.length, 1);
    assert.ok(plan.conflicts[0]?.includes(IP_FIELD_NAME));
  });
});

describe("validateItems", () => {
  it("catches a board Area that disagrees with the issue label", async () => {
    const knownLabels = parseLabelNames(await Bun.file(".github/labels.yml").text());
    const options = parseFieldOptions({
      fieldsContents: await Bun.file(".github/roadmap-fields.yml").text(),
      labelNames: knownLabels,
    });

    const problems = validateItems({
      items: [
        {
          area: "ui",
          body: null,
          impact: "Feature",
          ip: "x",
          issueNumber: 1,
          labels: ["area:api", "type:feature", "roadmap"],
          slug: "mismatched",
          status: "Planned",
          target: "Next",
          title: "t",
        },
      ],
      knownLabels,
      options,
    });

    assert.equal(problems.length, 1);
    assert.ok(problems[0]?.startsWith("mismatched:"));
  });

  it("requires the roadmap label on every board item", async () => {
    const knownLabels = parseLabelNames(await Bun.file(".github/labels.yml").text());
    const options = parseFieldOptions({
      fieldsContents: await Bun.file(".github/roadmap-fields.yml").text(),
      labelNames: knownLabels,
    });

    const problems = validateItems({
      items: [
        {
          area: "api",
          body: null,
          impact: "Feature",
          ip: "x",
          issueNumber: 1,
          labels: ["area:api", "type:feature"],
          slug: "unlabelled",
          status: "Planned",
          target: "Next",
          title: "t",
        },
      ],
      knownLabels,
      options,
    });

    assert.deepEqual(problems, [
      'unlabelled: Needs the "roadmap" label so board items can be filtered in the issue list',
    ]);
  });
});

describe("shouldWriteBoardStatus", () => {
  it("writes Status onto a new or empty card", () => {
    assert.equal(shouldWriteBoardStatus({boardStatus: "", seedStatus: "Planned"}), true);
  });

  it("writes when the seed is strictly ahead", () => {
    assert.equal(shouldWriteBoardStatus({boardStatus: "Planned", seedStatus: "Shipped"}), true);
  });

  it("does not reset a dragged Status that is ahead of the seed", () => {
    assert.equal(
      shouldWriteBoardStatus({boardStatus: "In progress", seedStatus: "Planned"}),
      false
    );
  });

  it("does not revive a Declined card from a later seed Status", () => {
    assert.equal(shouldWriteBoardStatus({boardStatus: "Declined", seedStatus: "Planned"}), false);
  });

  it("writes Declined from the seed onto a live card", () => {
    assert.equal(shouldWriteBoardStatus({boardStatus: "Planned", seedStatus: "Declined"}), true);
  });
});

describe("planItemSync", () => {
  const seedItem = {
    area: "api",
    impact: "Feature",
    ip: "alpha-ip",
    issueNumber: 42,
    status: "Planned",
    target: "Next",
    title: "[Roadmap] Alpha",
  };

  it("reports a hand-added card without planning to delete it", () => {
    const plan = planItemSync({
      boardItems: [
        {fields: {Status: "Inbox"}, id: "extra", issueNumber: 99},
        {
          fields: {
            Area: "api",
            Impact: "Feature",
            IP: "alpha-ip",
            Status: "Planned",
            Target: "Next",
          },
          id: "keep",
          issueNumber: 42,
        },
      ],
      items: [seedItem],
    });
    assert.ok(plan.reports.some((report) => report.includes("EXTRA #99")));
    assert.equal(
      plan.fieldValuePlan.some((entry) => entry.itemIssue === 99),
      false
    );
  });

  it("reports a dragged Status instead of writing the seed value", () => {
    const plan = planItemSync({
      boardItems: [
        {
          fields: {
            Area: "api",
            Impact: "Feature",
            IP: "alpha-ip",
            Status: "In progress",
            Target: "Next",
          },
          id: "dragged",
          issueNumber: 42,
        },
      ],
      items: [seedItem],
    });
    assert.deepEqual(plan.fieldValuePlan, []);
    assert.ok(plan.reports.some((report) => report.includes("Status is In progress")));
  });

  it("writes Status when the seed is ahead of the board", () => {
    const plan = planItemSync({
      boardItems: [
        {
          fields: {
            Area: "api",
            Impact: "Feature",
            IP: "alpha-ip",
            Status: "Planned",
            Target: "Next",
          },
          id: "behind",
          issueNumber: 42,
        },
      ],
      items: [{...seedItem, status: "Shipped"}],
    });
    assert.deepEqual(plan.fieldValuePlan, [{field: "Status", itemIssue: 42, value: "Shipped"}]);
    assert.deepEqual(plan.reports, []);
  });
});

describe("the real seed document", () => {
  it("declares only valid labels and field values for every board item", async () => {
    const knownLabels = parseLabelNames(await Bun.file(".github/labels.yml").text());
    const options = parseFieldOptions({
      fieldsContents: await Bun.file(".github/roadmap-fields.yml").text(),
      labelNames: knownLabels,
    });
    const seeds = parseSeedIssues(await Bun.file("docs/explanation/roadmap-seed-issues.md").text());
    const {items} = resolveSeedItems({issueNumbersByTitle: new Map(), seeds});

    assert.ok(items.length > 0, "expected the seed document to yield board items");
    assert.deepEqual(validateItems({items, knownLabels, options}), []);
  });

  it("maps each IP slug to exactly one board item", async () => {
    const seeds = parseSeedIssues(await Bun.file("docs/explanation/roadmap-seed-issues.md").text());
    const {items} = resolveSeedItems({issueNumbersByTitle: new Map(), seeds});
    const slugs = items.map((item) => item.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it("pairs every Shipped item with Target=Released", async () => {
    const seeds = parseSeedIssues(await Bun.file("docs/explanation/roadmap-seed-issues.md").text());
    const {items} = resolveSeedItems({issueNumbersByTitle: new Map(), seeds});
    const mismatches = items
      .filter((item) => item.status === "Shipped" && item.target !== "Released")
      .map((item) => `${item.slug} Target=${item.target}`);
    assert.deepEqual(mismatches, []);
  });

  it("does not paste the shipped table into the last section body", async () => {
    const seeds = parseSeedIssues(await Bun.file("docs/explanation/roadmap-seed-issues.md").text());
    const lastSection = seeds.find(
      (seed) => seed.slug === "pluggable-database-sqlite" && seed.body !== null
    );
    assert.ok(lastSection, "expected a section body for pluggable-database-sqlite");
    assert.ok(!lastSection?.body?.includes("Shipped, umbrella, and declined IPs"));
    assert.ok(!lastSection?.body?.includes("admin-improvements"));
  });
});

describe("resolveSeedItems with includeWithoutIp", () => {
  const seeds = parseSeedIssues(SEED_DOC);

  it("includes an IP-less entry when a maintainer explicitly asks for issues", () => {
    const {items, skipped} = resolveSeedItems({
      includeWithoutIp: true,
      issueNumbersByTitle: new Map(),
      seeds,
    });
    assert.ok(items.some((item) => item.slug === "no-ip-yet"));
    assert.deepEqual(skipped, []);
  });
});

describe("attachIssuesByIp", () => {
  it("finds a renamed issue through the board's IP field", () => {
    const items = [
      {ip: "renamed-plan", issueNumber: null as number | null},
      {ip: "", issueNumber: null as number | null},
      {ip: "matched-plan", issueNumber: 7 as number | null},
    ];
    attachIssuesByIp({
      boardItems: [
        {fields: {IP: "renamed-plan"}, id: "a", issueNumber: 42},
        {fields: {IP: "matched-plan"}, id: "b", issueNumber: 99},
      ],
      items,
    });
    assert.equal(items[0]?.issueNumber, 42);
    assert.equal(items[1]?.issueNumber, null);
    assert.equal(items[2]?.issueNumber, 7);
  });

  it("returns only the items it attached, so their labels can be planned", () => {
    const items = [
      {ip: "renamed-plan", issueNumber: null as number | null, labels: ["area:ai", "roadmap"]},
      {ip: "matched-plan", issueNumber: 7 as number | null, labels: ["area:api"]},
    ];
    const attached = attachIssuesByIp({
      boardItems: [{fields: {IP: "renamed-plan"}, id: "a", issueNumber: 42}],
      items,
    });
    assert.deepEqual(
      attached.map((item) => item.issueNumber),
      [42]
    );
    assert.deepEqual(
      planLabelWork({issueLabelsByNumber: new Map([[42, ["roadmap"]]]), items: attached}),
      [{labels: ["area:ai"], number: 42}]
    );
  });
});

describe("planLabelWork", () => {
  it("adds only missing labels and skips unknown or absent issues", () => {
    const work = planLabelWork({
      issueLabelsByNumber: new Map([
        [1, ["area:api", "roadmap"]],
        [2, ["roadmap"]],
      ]),
      items: [
        {issueNumber: 1, labels: ["area:api", "roadmap"]},
        {issueNumber: 2, labels: ["area:ui", "roadmap"]},
        {issueNumber: 3, labels: ["area:ui"]},
        {issueNumber: null, labels: ["area:ui"]},
      ],
    });
    assert.deepEqual(work, [{labels: ["area:ui"], number: 2}]);
  });
});
