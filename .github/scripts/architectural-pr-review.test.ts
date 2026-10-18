import {describe, it} from "bun:test";
import {assert} from "chai";

import {
  buildFileDiffContext,
  buildFindingFingerprint,
  buildPreviousReviewContextSection,
  collectExistingFindingFingerprints,
  extractLastReviewedSha,
  filterNewFindings,
  getFirstDiffPosition,
  isBotUser,
  isStalePullRequestHead,
  parseEvidenceLineRange,
  mergeIncrementalSummaryReview,
  parseFindingTitleFromComment,
  parseStickySummarySections,
  renderFindingComment,
  renderLastReviewedShaMarker,
  renderOverallSummaryComment,
  resolveCommentPosition,
  selectImplementationPlanPaths,
  summarizeChangedAreas,
  parseCirclePullRequestUrl,
  pullRequestEventFromApi,
} from "./architectural-pr-review";

describe("isStalePullRequestHead", () => {
  it("returns true when the live PR head differs from the reviewed SHA", (): void => {
    assert.isTrue(
      isStalePullRequestHead({
        expectedHeadSha: "abc123",
        liveHeadSha: "def456",
      })
    );
  });

  it("returns false when the live PR head matches the reviewed SHA", (): void => {
    assert.isFalse(
      isStalePullRequestHead({
        expectedHeadSha: "abc123",
        liveHeadSha: "abc123",
      })
    );
  });
});

describe("extractLastReviewedSha", () => {
  it("extracts the last reviewed head SHA marker from a sticky comment", (): void => {
    const sha = extractLastReviewedSha(
      [
        "<!-- architectural-pr-review -->",
        renderLastReviewedShaMarker("abc123def456"),
        "### Architectural review",
      ].join("\n")
    );

    assert.equal(sha, "abc123def456");
  });

  it("returns null when no marker is present", (): void => {
    assert.isNull(extractLastReviewedSha("### Architectural review"));
  });
});

describe("parseFindingTitleFromComment", () => {
  it("parses the finding title from an inline review comment", (): void => {
    const title = parseFindingTitleFromComment(
      [
        "<!-- architectural-pr-review-finding -->",
        "**High — Plan backfill step missing** `plan`",
        "",
        "Summary text.",
      ].join("\n")
    );

    assert.equal(title, "Plan backfill step missing");
  });
});

describe("buildFindingFingerprint", () => {
  it("builds a stable fingerprint from title and evidence location", (): void => {
    const fingerprint = buildFindingFingerprint({
      evidenceFile: "backend/src/api/example.ts",
      evidenceLines: "10-12",
      title: "Missing follow-through",
    });

    assert.equal(fingerprint, "missing follow-through|backend/src/api/example.ts|10-12");
  });
});

describe("filterNewFindings", () => {
  it("filters out findings that match an existing fingerprint", (): void => {
    const findings = filterNewFindings({
      existingFingerprints: ["missing follow-through|backend/src/api/example.ts|10-12"],
      findings: [
        {
          category: "architecture",
          recommendation: "Fix it.",
          severity: "high",
          summary: "Already reported.",
          title: "Missing follow-through",
          evidence: [{detail: "Details.", file: "backend/src/api/example.ts", lines: "10-12"}],
        },
        {
          category: "plan",
          recommendation: "Add migration.",
          severity: "medium",
          summary: "New issue.",
          title: "Plan step missing",
          evidence: [{detail: "Details.", file: "docs/plan.md", lines: "5"}],
        },
      ],
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.title, "Plan step missing");
  });
});

describe("collectExistingFindingFingerprints", () => {
  it("collects fingerprints from prior inline finding comments", (): void => {
    const fingerprints = collectExistingFindingFingerprints([
      {
        body: [
          "<!-- architectural-pr-review-finding -->",
          "**High — Plan backfill step missing** `plan`",
          "",
          "**References:**",
          "- [`docs/implementationPlans/Forgot-Password.md:68-90`](https://example.com) — detail",
        ].join("\n"),
        id: 1,
      },
    ]);

    assert.deepEqual(fingerprints, ["plan backfill step missing|docs/implementationplans/forgot-password.md|68-90"]);
  });
});

describe("buildPreviousReviewContextSection", () => {
  it("includes resolved thread status and prior finding comments", (): void => {
    const section = buildPreviousReviewContextSection({
      existingFindingFingerprints: [],
      incrementalFromSha: "abc123",
      previousFindingComments: [
        {
          body: "<!-- architectural-pr-review-finding -->\n**High — Existing finding** `architecture`",
          id: 1,
        },
      ],
      previousSummaryComment: {
        body: "<!-- architectural-pr-review -->\nPrevious summary.",
        id: 2,
      },
      reviewThreads: [
        {
          comments: [
            {
              authorLogin: "reviewer",
              body: "<!-- architectural-pr-review-finding -->\n**High — Existing finding** `architecture`",
            },
            {
              authorLogin: "author",
              body: "This is intentional for rollout reasons.",
            },
          ],
          isResolved: true,
        },
      ],
    });

    assert.include(section, "Previous summary comment");
    assert.include(section, "Previous inline findings");
    assert.include(section, "Thread 1 (resolved)");
    assert.include(section, "This is intentional for rollout reasons.");
  });
});

describe("selectImplementationPlanPaths", () => {
  it("collects changed and explicitly referenced implementation plans", (): void => {
    const planPaths = selectImplementationPlanPaths({
      changedFiles: [
        {
          additions: 10,
          deletions: 2,
          filename: "backend/src/lib/example.ts",
          status: "modified",
        },
        {
          additions: 40,
          deletions: 0,
          filename: "docs/implementationPlans/Forgot-Password.md",
          status: "added",
        },
      ],
      prBody: [
        "Implements docs/implementationPlans/Forgot-Password.md.",
        "Follow-up work for docs/implementationPlans/Tablet-Management-System.md.",
      ].join("\n"),
    });

    assert.deepEqual(planPaths, [
      "docs/implementationPlans/Forgot-Password.md",
      "docs/implementationPlans/Tablet-Management-System.md",
    ]);
  });
});

describe("summarizeChangedAreas", () => {
  it("groups changed files by top-level area", (): void => {
    const summary = summarizeChangedAreas([
      {
        additions: 12,
        deletions: 1,
        filename: "backend/src/lib/example.ts",
        status: "modified",
      },
      {
        additions: 4,
        deletions: 0,
        filename: "backend/src/api/example.ts",
        status: "modified",
      },
      {
        additions: 8,
        deletions: 2,
        filename: "app/components/Card.tsx",
        status: "modified",
      },
    ]);

    assert.equal(summary, "backend (2), app (1)");
  });
});

describe("buildFileDiffContext", () => {
  it("notes omitted files when the diff budget is exhausted", (): void => {
    const diffContext = buildFileDiffContext(
      [
        {
          additions: 50,
          deletions: 10,
          filename: "backend/src/lib/large.ts",
          patch: `${"+x".repeat(2_500)}\n`,
          status: "modified",
        },
        {
          additions: 3,
          deletions: 1,
          filename: "app/components/Card.tsx",
          patch: "@@ -1,1 +1,1 @@\n-old\n+new\n",
          status: "modified",
        },
      ],
      {maxCharacters: 2_200}
    );

    assert.include(diffContext, "backend/src/lib/large.ts");
    assert.include(diffContext, "... [patch truncated for context budget]");
    assert.include(diffContext, "### Omitted files");
    assert.include(diffContext, "app/components/Card.tsx");
  });
});

describe("isBotUser", () => {
  it("returns true for logins containing [bot]", (): void => {
    assert.isTrue(isBotUser("dependabot[bot]"));
    assert.isTrue(isBotUser("renovate[bot]"));
  });

  it("returns true for logins matching known bot patterns", (): void => {
    assert.isTrue(isBotUser("devin-ai-integration[bot]"));
    assert.isTrue(isBotUser("Devin"));
    assert.isTrue(isBotUser("cursor-ci"));
    assert.isTrue(isBotUser("Cursor"));
  });

  it("returns false for regular user logins", (): void => {
    assert.isFalse(isBotUser("jgachnang"));
    assert.isFalse(isBotUser("octocat"));
    assert.isFalse(isBotUser("some-developer"));
  });
});

describe("getFirstDiffPosition", () => {
  it("returns the first hunk position from the first file with a patch", (): void => {
    const position = getFirstDiffPosition([
      {
        additions: 0,
        deletions: 0,
        filename: "binary-file.png",
        status: "modified",
      },
      {
        additions: 3,
        deletions: 1,
        filename: "backend/src/lib/example.ts",
        patch: "@@ -10,7 +12,9 @@ function foo() {\n context\n-old\n+new\n",
        status: "modified",
      },
    ]);

    assert.deepEqual(position, {line: 12, path: "backend/src/lib/example.ts"});
  });

  it("returns null when no files have patches", (): void => {
    const position = getFirstDiffPosition([
      {
        additions: 0,
        deletions: 0,
        filename: "binary-file.png",
        status: "modified",
      },
    ]);

    assert.isNull(position);
  });
});

describe("parseEvidenceLineRange", () => {
  it("parses a line range", (): void => {
    assert.deepEqual(parseEvidenceLineRange("10-42"), {end: 42, start: 10});
  });

  it("parses a single line", (): void => {
    assert.deepEqual(parseEvidenceLineRange("10"), {start: 10});
  });

  it("returns null for unrecognized formats", (): void => {
    assert.isNull(parseEvidenceLineRange("abc"));
    assert.isNull(parseEvidenceLineRange(""));
  });
});

describe("resolveCommentPosition", () => {
  it("uses the evidence line when it falls within the diff", (): void => {
    const position = resolveCommentPosition({
      changedFiles: [
        {
          additions: 5,
          deletions: 2,
          filename: "backend/src/api/example.ts",
          patch: "@@ -8,7 +8,10 @@ function foo() {\n context\n context\n-old\n+new line 10\n+new line 11\n+new line 12\n context\n context\n",
          status: "modified",
        },
      ],
      finding: {
        category: "architecture",
        recommendation: "Fix it.",
        severity: "high",
        summary: "Issue found.",
        title: "Test finding",
        evidence: [{detail: "Details.", file: "backend/src/api/example.ts", lines: "10-12"}],
      },
    });

    assert.deepEqual(position, {line: 10, path: "backend/src/api/example.ts"});
  });

  it("falls back to first hunk line when evidence line is outside diff", (): void => {
    const position = resolveCommentPosition({
      changedFiles: [
        {
          additions: 1,
          deletions: 1,
          filename: "backend/src/api/example.ts",
          patch: "@@ -20,3 +20,3 @@ function bar() {\n context\n-old\n+new\n",
          status: "modified",
        },
      ],
      finding: {
        category: "architecture",
        recommendation: "Fix it.",
        severity: "high",
        summary: "Issue found.",
        title: "Test finding",
        evidence: [{detail: "Details.", file: "backend/src/api/example.ts", lines: "5"}],
      },
    });

    assert.deepEqual(position, {line: 20, path: "backend/src/api/example.ts"});
  });

  it("returns null when the evidence file is not in changed files", (): void => {
    const position = resolveCommentPosition({
      changedFiles: [
        {
          additions: 1,
          deletions: 0,
          filename: "app/components/Card.tsx",
          patch: "@@ -1,1 +1,2 @@\n line\n+added\n",
          status: "modified",
        },
      ],
      finding: {
        category: "architecture",
        recommendation: "Fix it.",
        severity: "high",
        summary: "Issue found.",
        title: "Test finding",
        evidence: [{detail: "Details.", file: "backend/src/api/other.ts", lines: "10"}],
      },
    });

    assert.isNull(position);
  });
});

describe("parseStickySummarySections", () => {
  it("extracts prior summary, plan comparison, and refactor sections", (): void => {
    const sections = parseStickySummarySections(
      [
        "<!-- architectural-pr-review -->",
        renderLastReviewedShaMarker("abc123"),
        "### Architectural review",
        "",
        "**Assessment:** Needs attention",
        "",
        "The PR largely follows the intended direction.",
        "",
        "<details>",
        "<summary>Plan comparison</summary>",
        "",
        "**Status:** Discrepancies found",
        "",
        "</details>",
        "",
        "<details>",
        "<summary>Suggested refactors (1)</summary>",
        "",
        "- Consider centralizing the new request parsing.",
        "",
        "</details>",
      ].join("\n")
    );

    assert.equal(sections.priorSummaryText, "The PR largely follows the intended direction.");
    assert.include(sections.planComparisonContent ?? "", "**Status:** Discrepancies found");
    assert.deepEqual(sections.suggestedRefactorItems, ["Consider centralizing the new request parsing."]);
  });
});

describe("mergeIncrementalSummaryReview", () => {
  it("carries forward prior plan comparison and refactors when the latest review is sparse", (): void => {
    const merged = mergeIncrementalSummaryReview({
      parsedPreviousSections: {
        planComparisonContent: "**Status:** Discrepancies found",
        priorSummaryText: "Earlier review summary.",
        suggestedRefactorItems: ["Consider centralizing the new request parsing."],
      },
      review: {
        findings: [],
        overallAssessment: "clear",
        planComparison: {
          comparedPlanPaths: [],
          discrepancies: [],
          notes: [],
          status: "not_applicable",
        },
        suggestedRefactors: [],
        summary: "No new concerns in the latest changes.",
      },
    });

    assert.equal(merged.priorSummaryText, "Earlier review summary.");
    assert.equal(merged.reusedPlanComparisonContent, "**Status:** Discrepancies found");
    assert.deepEqual(merged.mergedReview.suggestedRefactors, [
      "Consider centralizing the new request parsing.",
    ]);
  });
});

describe("renderOverallSummaryComment", () => {
  it("preserves prior summary metadata on incremental reruns", (): void => {
    const comment = renderOverallSummaryComment({
      findingsCount: 0,
      headSha: "newhead123456",
      incrementalFromSha: "oldhead123456",
      previousStickyBody: [
        "<!-- architectural-pr-review -->",
        renderLastReviewedShaMarker("oldhead123456"),
        "### Architectural review",
        "",
        "**Assessment:** Needs attention",
        "",
        "Earlier review summary.",
        "",
        "<details>",
        "<summary>Plan comparison</summary>",
        "",
        "**Status:** Discrepancies found",
        "",
        "</details>",
        "",
        "<details>",
        "<summary>Suggested refactors (1)</summary>",
        "",
        "- Consider centralizing the new request parsing.",
        "",
        "</details>",
      ].join("\n"),
      review: {
        findings: [],
        overallAssessment: "clear",
        planComparison: {
          comparedPlanPaths: [],
          discrepancies: [],
          notes: [],
          status: "not_applicable",
        },
        suggestedRefactors: [],
        summary: "No new concerns in the latest changes.",
      },
    });

    assert.include(comment, "<summary>Prior review summary</summary>");
    assert.include(comment, "Earlier review summary.");
    assert.include(comment, "<summary>Plan comparison</summary>");
    assert.include(comment, "**Status:** Discrepancies found");
    assert.include(comment, "Consider centralizing the new request parsing.");
  });

  it("renders a summary with collapsible plan comparison and refactors", (): void => {
    const comment = renderOverallSummaryComment({
      existingFindingsCount: 1,
      findingsCount: 2,
      headSha: "abc123def456",
      review: {
        findings: [],
        overallAssessment: "watch",
        planComparison: {
          comparedPlanPaths: ["docs/implementationPlans/Forgot-Password.md"],
          discrepancies: ["Backfill work described in the plan is not represented in the changed files."],
          notes: ["The frontend and backend route changes appear aligned with the plan."],
          status: "discrepancies_found",
        },
        suggestedRefactors: ["Consider centralizing the new request parsing so app and backend stay in sync."],
        summary: "The PR largely follows the intended direction.",
      },
    });

    assert.include(comment, "<!-- architectural-pr-review -->");
    assert.include(comment, renderLastReviewedShaMarker("abc123def456"));
    assert.include(comment, "2 new finding(s) posted as inline comments");
    assert.include(comment, "1 prior finding comment(s) preserved");
    assert.include(comment, "<details>");
    assert.include(comment, "<summary>Plan comparison</summary>");
    assert.include(comment, "**Discrepancies:**");
    assert.include(comment, "<summary>Suggested refactors (1)</summary>");
  });

  it("shows incremental no-findings message when count is zero", (): void => {
    const comment = renderOverallSummaryComment({
      findingsCount: 0,
      headSha: "abc123def456",
      incrementalFromSha: "deadbeef0000",
      review: {
        findings: [],
        overallAssessment: "clear",
        planComparison: {comparedPlanPaths: [], discrepancies: [], notes: [], status: "not_applicable"},
        suggestedRefactors: [],
        summary: "Looks good.",
      },
    });

    assert.include(comment, "No new material architectural concerns identified in the latest changes.");
    assert.include(comment, "Incremental review of changes since `deadbee`.");
    assert.notInclude(comment, "inline comments");
  });

  it("shows no-findings message on first review when count is zero", (): void => {
    const comment = renderOverallSummaryComment({
      findingsCount: 0,
      headSha: "abc123def456",
      review: {
        findings: [],
        overallAssessment: "clear",
        planComparison: {comparedPlanPaths: [], discrepancies: [], notes: [], status: "not_applicable"},
        suggestedRefactors: [],
        summary: "Looks good.",
      },
    });

    assert.include(comment, "No material architectural concerns identified.");
    assert.notInclude(comment, "inline comments");
  });

  it("includes unanchorable findings in a collapsible section", (): void => {
    const comment = renderOverallSummaryComment({
      findingsCount: 1,
      headSha: "abc123def456",
      review: {
        findings: [],
        overallAssessment: "watch",
        planComparison: {comparedPlanPaths: [], discrepancies: [], notes: [], status: "not_applicable"},
        suggestedRefactors: [],
        summary: "Mixed results.",
      },
      unanchorableFindings: [
        {
          category: "plan",
          evidence: [{detail: "Missing step.", file: "docs/plan.md", lines: "10"}],
          recommendation: "Add the migration.",
          severity: "high",
          summary: "Plan step not implemented.",
          title: "Missing migration",
        },
      ],
    });

    assert.include(comment, "Additional findings not anchored to diff lines (1)");
    assert.include(comment, "Missing migration");
    assert.include(comment, "Plan step not implemented.");
    assert.notInclude(comment, "No material architectural concerns identified.");
  });
});

describe("renderFindingComment", () => {
  it("renders a finding with linked evidence references", (): void => {
    const comment = renderFindingComment({
      finding: {
        category: "plan",
        recommendation: "Either implement the missing migration or update the plan.",
        severity: "high",
        summary: "The referenced implementation plan calls for a backfill that is absent from the diff.",
        title: "Plan backfill step missing",
        evidence: [
          {
            detail: "The plan includes a data migration step.",
            file: "docs/implementationPlans/Forgot-Password.md",
            lines: "68-90",
          },
        ],
      },
      linkContext: {headSha: "abc123", owner: "TerrenoLabs", repo: "terreno"},
    });

    assert.include(comment, "<!-- architectural-pr-review-finding -->");
    assert.include(comment, "**High");
    assert.include(comment, "Plan backfill step missing");
    assert.include(comment, "`plan`");
    assert.include(comment, "**Recommendation:**");
    assert.include(comment, "https://github.com/TerrenoLabs/terreno/blob/abc123/docs/implementationPlans/Forgot-Password.md#L68-L90");
  });
});

describe("parseCirclePullRequestUrl", () => {
  it("parses a GitHub pull request URL from CircleCI", (): void => {
    assert.deepEqual(parseCirclePullRequestUrl("https://github.com/TerrenoLabs/terreno/pull/1199"), {
      owner: "TerrenoLabs",
      pullRequestNumber: 1199,
      repo: "terreno",
    });
  });

  it("rejects a non-GitHub pull request URL", (): void => {
    assert.throws(
      () => parseCirclePullRequestUrl("https://app.circleci.com/pipelines/github/TerrenoLabs/terreno/1"),
      /not a GitHub pull request URL/
    );
  });
});

describe("pullRequestEventFromApi", () => {
  it("maps GitHub pull request JSON into the Actions event shape", (): void => {
    const event = pullRequestEventFromApi({
      base: {
        ref: "master",
        repo: {
          default_branch: "master",
          full_name: "TerrenoLabs/terreno",
          name: "terreno",
          owner: {login: "FlourishHealth"},
        },
        sha: "base-sha",
      },
      body: "PR body",
      draft: false,
      head: {ref: "feature", sha: "head-sha"},
      html_url: "https://github.com/TerrenoLabs/terreno/pull/1199",
      number: 1199,
      title: "Move architectural review",
      user: {login: "alice"},
    });

    assert.equal(event.action, "synchronize");
    assert.equal(event.pull_request.number, 1199);
    assert.equal(event.pull_request.head.sha, "head-sha");
    assert.equal(event.pull_request.base.sha, "base-sha");
    assert.equal(event.repository.owner.login, "FlourishHealth");
    assert.equal(event.repository.name, "terreno");
    assert.equal(event.pull_request.user.login, "alice");
    assert.equal(event.pull_request.body, "PR body");
  });
});
