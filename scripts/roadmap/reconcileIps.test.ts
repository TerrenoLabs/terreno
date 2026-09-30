import {describe, it} from "bun:test";
import assert from "node:assert/strict";
import {
  applyStatusFixes,
  buildSeedSection,
  collectFindings,
  type IpRecord,
  inferArea,
  insertSeedSections,
  isSubDocument,
  parseIpRecord,
  parseTaskProgress,
  type TaskProgress,
  toBoardStatus,
} from "./reconcileIps.ts";
import {parseSeedIssues} from "./seedIssues.ts";

const ip = (overrides: Partial<IpRecord> & {slug: string}): IpRecord => ({
  boardStatus: null,
  parentIp: null,
  rawStatus: null,
  roadmapIssue: null,
  supersededBy: null,
  ...overrides,
});

const tasks = (overrides: {done: number; isClosed?: boolean; total: number}): TaskProgress => ({
  isClosed: false,
  ...overrides,
});

describe("toBoardStatus", () => {
  it("maps the canonical vocabulary", () => {
    assert.equal(toBoardStatus("Draft"), "Shaping");
    assert.equal(toBoardStatus("Approved"), "Planned");
    assert.equal(toBoardStatus("In progress"), "In progress");
    assert.equal(toBoardStatus("Complete"), "Shipped");
    assert.equal(toBoardStatus("Deferred"), "Declined");
  });

  it("ignores the trailing prose real plans carry", () => {
    assert.equal(toBoardStatus("Approved — decisions recorded (2026-07-29)"), "Planned");
    assert.equal(toBoardStatus("Draft — blocked on PR #869"), "Shaping");
    assert.equal(toBoardStatus("Complete — phases 1–6 shipped in PR #932"), "Shipped");
    assert.equal(toBoardStatus("Shaped, ready for review"), "Shaping");
  });

  it("is case insensitive", () => {
    assert.equal(toBoardStatus("In Progress"), "In progress");
  });

  it("prefers the longer key so research complete does not read as complete", () => {
    assert.equal(toBoardStatus("Research complete — decisions recorded"), "Shipped");
  });

  it("returns null for prose it cannot map", () => {
    assert.equal(toBoardStatus("Percolating"), null);
    assert.equal(toBoardStatus(null), null);
  });
});

describe("parseIpRecord", () => {
  it("reads the header block", () => {
    const record = parseIpRecord({
      contents: [
        "# Implementation Plan: Thing",
        "",
        "**Status:** Approved — decisions 2026-08-20",
        "**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1018",
        "**Superseded by:** [other](other.md)",
      ].join("\n"),
      slug: "thing",
    });

    assert.equal(record.boardStatus, "Planned");
    assert.equal(record.roadmapIssue, 1018);
    assert.equal(record.supersededBy, "[other](other.md)");
    assert.equal(record.parentIp, null);
  });

  it("reads an explicit parent IP", () => {
    const record = parseIpRecord({
      contents: "**Status:** Complete\n**Parent IP:** [syncdb-local-first](syncdb-local-first.md)",
      slug: "terreno-syncdb-2",
    });
    assert.equal(record.parentIp, "[syncdb-local-first](syncdb-local-first.md)");
  });

  it("ignores an italic Parent IP placeholder copied from the template", () => {
    const record = parseIpRecord({
      contents:
        "**Status:** Draft\n**Parent IP:** *(optional — only when this plan rides on another plan's roadmap entry instead of getting its own)*",
      slug: "copied-from-template",
    });
    assert.equal(record.parentIp, null);
  });

  it("tolerates a plan with no header block", () => {
    const record = parseIpRecord({contents: "# Just a title\n\nProse.", slug: "bare"});
    assert.equal(record.rawStatus, null);
    assert.equal(record.boardStatus, null);
    assert.equal(record.roadmapIssue, null);
  });
});

describe("parseTaskProgress", () => {
  it("counts checked and total boxes, including nested ones", () => {
    const progress = parseTaskProgress(
      ["- [x] one", "- [ ] two", "  - [X] nested", "- not a task", "* [x] wrong bullet"].join("\n")
    );
    assert.deepEqual(progress, {done: 2, isClosed: false, total: 3});
  });

  it("reports zero for a file with no checkboxes", () => {
    assert.deepEqual(parseTaskProgress("# Tasks\n\nProse only."), {
      done: 0,
      isClosed: false,
      total: 0,
    });
  });

  it("marks a closed task list, whose unchecked boxes are history", () => {
    const progress = parseTaskProgress(
      ["# Tasks", "", "**Status:** Closed (2026-08-20) — IP complete.", "", "- [ ] one"].join("\n")
    );
    assert.equal(progress.isClosed, true);
  });
});

describe("isSubDocument", () => {
  it("recognizes research and design sub-documents", () => {
    assert.equal(isSubDocument({slug: "infra-mcp-research"}), true);
    assert.equal(isSubDocument({slug: "syncdb-phase-c-design"}), true);
    assert.equal(isSubDocument({slug: "infra-mcp"}), false);
  });

  it("recognizes a plan that names a parent IP", () => {
    assert.equal(isSubDocument({parentIp: "[a](a.md)", slug: "terreno-syncdb-2"}), true);
  });

  it("does not treat a missing parent IP as a sub-document", () => {
    assert.equal(isSubDocument({parentIp: null, slug: "copied-from-template"}), false);
  });
});

describe("collectFindings", () => {
  const noTasks = new Map();

  it("advances status when the IP is ahead of the roadmap", () => {
    const findings = collectFindings({
      ips: [ip({boardStatus: "Shipped", rawStatus: "Complete", slug: "a"})],
      seedStatuses: new Map([["a", "Planned"]]),
      taskProgress: noTasks,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.kind, "fix");
    assert.equal(findings[0]?.type, "status-advanced");
    assert.equal(findings[0]?.expected, "Shipped");
  });

  it("never walks status backwards — a stale IP header is reported, not applied", () => {
    const findings = collectFindings({
      ips: [ip({boardStatus: "Shaping", rawStatus: "Draft", slug: "a"})],
      seedStatuses: new Map([["a", "Shipped"]]),
      taskProgress: noTasks,
    });
    assert.equal(findings[0]?.kind, "review");
    assert.equal(findings[0]?.type, "stale-ip-header");
  });

  it("declines a superseded plan regardless of its Status line", () => {
    const findings = collectFindings({
      ips: [
        ip({boardStatus: "Planned", rawStatus: "Approved", slug: "a", supersededBy: "[b](b.md)"}),
      ],
      seedStatuses: new Map([["a", "Planned"]]),
      taskProgress: noTasks,
    });
    assert.equal(findings[0]?.kind, "fix");
    assert.equal(findings[0]?.type, "superseded");
    assert.equal(findings[0]?.expected, "Declined");
  });

  it("refuses to revive declined work automatically", () => {
    const findings = collectFindings({
      ips: [ip({boardStatus: "Planned", rawStatus: "Approved", slug: "a"})],
      seedStatuses: new Map([["a", "Declined"]]),
      taskProgress: noTasks,
    });
    assert.equal(findings[0]?.kind, "review");
    assert.equal(findings[0]?.type, "declined-but-ip-open");
  });

  it("scaffolds an entry for an approved plan that has none", () => {
    const findings = collectFindings({
      ips: [ip({boardStatus: "Planned", rawStatus: "Approved", slug: "a"})],
      seedStatuses: new Map(),
      taskProgress: noTasks,
    });
    assert.equal(findings[0]?.type, "missing-roadmap-entry");
    assert.equal(findings[0]?.kind, "fix");
    assert.equal(findings[0]?.expected, "Planned");
  });

  it("puts a draft plan on the roadmap as Shaping", () => {
    const findings = collectFindings({
      ips: [ip({boardStatus: "Shaping", rawStatus: "Draft", slug: "a"})],
      seedStatuses: new Map(),
      taskProgress: noTasks,
    });
    assert.equal(findings[0]?.type, "missing-roadmap-entry");
    assert.equal(findings[0]?.expected, "Shaping");
  });

  it("flags a roadmap entry whose plan was deleted", () => {
    const findings = collectFindings({
      ips: [],
      seedStatuses: new Map([["ghost", "Planned"]]),
      taskProgress: noTasks,
    });
    assert.equal(findings[0]?.type, "orphan-roadmap-entry");
  });

  it("flags fully checked tasks on an open plan", () => {
    const findings = collectFindings({
      ips: [ip({boardStatus: "In progress", rawStatus: "In progress", slug: "a"})],
      seedStatuses: new Map([["a", "In progress"]]),
      taskProgress: new Map([["a", tasks({done: 5, total: 5})]]),
    });
    assert.equal(findings[0]?.type, "tasks-done-ip-open");
  });

  it("stays quiet when a closed task list has open boxes", () => {
    const findings = collectFindings({
      ips: [ip({boardStatus: "Shipped", rawStatus: "Complete", slug: "a"})],
      seedStatuses: new Map([["a", "Shipped"]]),
      taskProgress: new Map([["a", tasks({done: 0, isClosed: true, total: 11})]]),
    });
    assert.deepEqual(findings, []);
  });

  it("flags a shipped plan with unfinished tasks", () => {
    const findings = collectFindings({
      ips: [ip({boardStatus: "Shipped", rawStatus: "Complete", slug: "a"})],
      seedStatuses: new Map([["a", "Shipped"]]),
      taskProgress: new Map([["a", tasks({done: 2, total: 5})]]),
    });
    assert.equal(findings[0]?.type, "ip-shipped-tasks-open");
  });

  it("skips a plan that names a parent IP", () => {
    const findings = collectFindings({
      ips: [
        ip({boardStatus: "Shipped", parentIp: "[a](a.md)", rawStatus: "Complete", slug: "a-2"}),
      ],
      seedStatuses: new Map(),
      taskProgress: noTasks,
    });
    assert.deepEqual(findings, []);
  });

  it("skips research sub-documents, which share the parent's entry", () => {
    const findings = collectFindings({
      ips: [ip({boardStatus: "Shipped", rawStatus: "Research complete", slug: "a-research"})],
      seedStatuses: new Map(),
      taskProgress: noTasks,
    });
    assert.deepEqual(findings, []);
  });

  it("reports an unmappable status instead of guessing", () => {
    const findings = collectFindings({
      ips: [ip({rawStatus: "Percolating", slug: "a"})],
      seedStatuses: new Map([["a", "Planned"]]),
      taskProgress: noTasks,
    });
    assert.equal(findings[0]?.type, "unmappable-status");
  });
});

describe("applyStatusFixes", () => {
  it("moves shipped work to the Released target", () => {
    const section =
      "**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`a`, Status=`Planned`";
    const row =
      "| `a` | https://github.com/o/r/issues/1 | `Planned` | `api` | `Next` | `Feature` | `type:feature` |";
    const updated = applyStatusFixes({
      contents: `${section}\n\n${row}\n`,
      fixes: [{slug: "a", status: "Shipped"}],
    });
    assert.match(updated, /Target=`Released`, Impact=`Feature`, IP=`a`, Status=`Shipped`/);
    assert.match(updated, /\| `Shipped` \| `api` \| `Released` \|/);
  });

  it("rewrites the Status of a section without touching its other fields", () => {
    const before =
      "**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`alpha`, Status=`Planned`";
    const after = applyStatusFixes({
      contents: before,
      fixes: [{slug: "alpha", status: "In review"}],
    });
    assert.equal(
      after,
      "**Project fields:** Area=`api`, Target=`Next`, Impact=`Feature`, IP=`alpha`, Status=`In review`"
    );
  });

  it("rewrites the Status column of a table row", () => {
    const before =
      "| `alpha` | https://github.com/o/r/issues/1 | `Planned` | `api` | `Next` | `Feature` | `type:feature` |";
    const after = applyStatusFixes({contents: before, fixes: [{slug: "alpha", status: "Shipped"}]});
    assert.ok(after.includes("| `Shipped` | `api` |"));
    assert.ok(after.includes("`type:feature`"));
  });

  it("leaves a slug that is a prefix of another alone", () => {
    const before = [
      "**Project fields:** IP=`comms-abstraction`, Status=`Planned`",
      "**Project fields:** IP=`comms-abstraction-research`, Status=`Planned`",
    ].join("\n");
    const after = applyStatusFixes({
      contents: before,
      fixes: [{slug: "comms-abstraction", status: "Shipped"}],
    });
    assert.ok(after.includes("IP=`comms-abstraction`, Status=`Shipped`"));
    assert.ok(after.includes("IP=`comms-abstraction-research`, Status=`Planned`"));
  });

  it("returns the input unchanged when no slug matches", () => {
    const before = "**Project fields:** IP=`alpha`, Status=`Planned`";
    assert.equal(
      applyStatusFixes({contents: before, fixes: [{slug: "beta", status: "Shipped"}]}),
      before
    );
  });
});

describe("buildSeedSection", () => {
  const plan = [
    "# Implementation Plan: Widget exports",
    "",
    "**Status:** Approved  ",
    "**Primary packages:** `@terreno/ui`",
    "",
    "## Goal",
    "",
    "Let apps export widgets",
    "as CSV.",
    "",
    "More detail.",
  ].join("\n");

  it("produces a section the seed parser reads back with IP and task links", () => {
    const section = buildSeedSection({
      contents: plan,
      hasTasks: true,
      slug: "widget-exports",
      status: "Planned",
    });
    const [seed] = parseSeedIssues(`# Roadmap seed issues\n\n---\n\n${section}`);
    assert.equal(seed?.title, "Widget exports");
    assert.equal(seed?.area, "ui");
    assert.equal(seed?.target, "Next");
    assert.equal(seed?.impact, "Feature");
    assert.equal(seed?.ip, "widget-exports");
    assert.equal(seed?.status, "Planned");
    assert.match(seed?.body ?? "", /Let apps export widgets as CSV\./);
    assert.match(seed?.body ?? "", /docs\/implementationPlans\/widget-exports\.md/);
    assert.match(seed?.body ?? "", /docs\/tasks\/widget-exports\.md/);
  });

  it("omits the task link when no task list exists", () => {
    const section = buildSeedSection({
      contents: plan,
      hasTasks: false,
      slug: "widget-exports",
      status: "Planned",
    });
    assert.doesNotMatch(section, /docs\/tasks\//);
  });

  it("prefers the Roadmap header over inference", () => {
    const declared = plan.replace(
      "**Primary packages:**",
      "**Roadmap:** Area=`dx`, Target=`58`, Impact=`Breaking`  \n**Primary packages:**"
    );
    const [seed] = parseSeedIssues(
      buildSeedSection({contents: declared, hasTasks: false, slug: "w", status: "Planned"}).replace(
        /^/,
        "# x\n\n"
      )
    );
    assert.equal(seed?.area, "dx");
    assert.equal(seed?.target, "58");
    assert.equal(seed?.impact, "Breaking");
  });

  it("puts shipped work under Released even when the header declares a target", () => {
    const declared = plan.replace(
      "**Primary packages:**",
      "**Roadmap:** Area=`api`, Target=`Next`, Impact=`Feature`  \n**Primary packages:**"
    );
    assert.match(
      buildSeedSection({contents: declared, hasTasks: false, slug: "w", status: "Shipped"}),
      /Target=`Released`/
    );
  });

  it("keeps the list a goal paragraph introduces", () => {
    const listPlan = plan.replace(
      "Let apps export widgets\nas CSV.\n\nMore detail.",
      "Apps can:\n\n- export widgets\n- import widgets\n\nMore detail."
    );
    const section = buildSeedSection({
      contents: listPlan,
      hasTasks: false,
      slug: "w",
      status: "Planned",
    });
    assert.match(section, /Apps can:\n\n- export widgets\n- import widgets\n/);
    assert.doesNotMatch(section, /More detail/);
  });

  it("targets Released for shipped work and Future for drafts", () => {
    assert.match(
      buildSeedSection({contents: plan, hasTasks: false, slug: "w", status: "Shipped"}),
      /Target=`Released`/
    );
    assert.match(
      buildSeedSection({contents: plan, hasTasks: false, slug: "w", status: "Shaping"}),
      /Target=`Future`/
    );
  });
});

describe("inferArea", () => {
  it("falls back to dx when the header names no package", () => {
    assert.equal(
      inferArea("# Plan\n\n**Status:** Draft\n\n## Goal\n\n@terreno/ui everywhere"),
      "dx"
    );
  });
});

describe("insertSeedSections", () => {
  it("inserts above the backfill table", () => {
    const updated = insertSeedSections({
      contents: "# Seed\n\n## a\n\n---\n\n# Shipped, umbrella, and declined IPs\n\n| table |\n",
      sections: ["## b\n\nbody\n\n---\n"],
    });
    assert.ok(updated.indexOf("## b") < updated.indexOf("# Shipped, umbrella"));
    assert.ok(updated.indexOf("## a") < updated.indexOf("## b"));
  });
});
