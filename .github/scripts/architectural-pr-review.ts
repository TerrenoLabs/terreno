#!/usr/bin/env bun

import {spawn} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {z} from "zod";

const STICKY_COMMENT_MARKER = "<!-- architectural-pr-review -->";
const FINDING_COMMENT_MARKER = "<!-- architectural-pr-review-finding -->";
const LAST_REVIEWED_SHA_MARKER_PREFIX = "<!-- architectural-pr-review-head-sha:";
const LAST_REVIEWED_SHA_MARKER_SUFFIX = " -->";
const FINDING_TITLE_PATTERN = /\*\*(?:Critical|High|Medium|Low) — (.+?)\*\*/;
const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_USER_AGENT = "terreno-architectural-pr-review";
const MAX_PR_BODY_CHARACTERS = 12_000;
const MAX_PLAN_CONTENT_CHARACTERS = 20_000;
const MAX_DIFF_SECTION_CHARACTERS = 120_000;
const MAX_CHANGED_FILE_LIST_ITEMS = 250;
const MIN_DIFF_SECTION_CHARACTER_BUDGET = 1_500;
const MAX_OMITTED_FILE_NOTES = 20;
const MAX_FETCHED_PLAN_FILES = 5;
const CURSOR_AGENT_BINARY = "cursor-agent";
const CURSOR_AGENT_TRUST_FLAG = "--trust";
const BOT_USER_PATTERNS = ["devin", "cursor"];
const STRUCTURED_OUTPUT_INSTRUCTIONS = `
Do not call any tools, read repository files, or run shell commands. Base the
review solely on the context provided below.

Respond with a single JSON object and nothing else: no prose, no explanation,
and no Markdown code fences. The JSON object must validate against this JSON
Schema:
`.trim();
const REPOSITORY_ARCHITECTURE_CONTEXT = `
Terreno is a monorepo of shared packages for building full-stack React Native + Express/Mongoose applications. The top-level workspaces are:
- api/: @terreno/api — REST API framework on Express/Mongoose (modelRouter, permissions, auth, OpenAPI generation, logging).
- ui/: @terreno/ui — React Native component library (Box, Button, TextField, theming via TerrenoProvider) that must support React Native Web.
- rtk/: @terreno/rtk — Redux Toolkit Query utilities (generateAuthSlice, emptyApi, token storage) for api backends.
- ai/: @terreno/ai — provider-agnostic AI service layer (AIService, GPT routes, request logging).
- admin-backend/ and admin-frontend/: @terreno/admin-backend and @terreno/admin-frontend — admin panel plugin and screens for api backends.
- admin-spa/: @terreno/admin-spa — standalone admin SPA plus an Express plugin to serve it.
- mcp-server/: @terreno/mcp — MCP server exposing Terreno code-generation tools.
- demo/: UI component demo app. example-frontend/ and example-backend/: example apps that double as integration tests and documentation.

Important repo conventions:
- The example-frontend SDK files (example-frontend/store/openApiSdk.ts) are generated from the backend OpenAPI spec via "bun run sdk" and are never edited by hand.
- Backend (api) model or route changes usually require matching interface/OpenAPI/SDK follow-through and updates to the example apps.
- Frontend packages must use functional React (React.FC), import hooks directly, and always support React Native Web.
- Backend code uses logger.info/warn/error/debug (never console.log) and throws APIError with explicit status codes.
- Prefer conservative, explicit patterns over clever abstractions. Flag duplication when it creates maintenance risk, not merely stylistic repetition.
- Focus on architectural boundaries between api/ui/rtk/ai/admin packages, ownership of responsibilities, coupling, rollout risk, missing follow-through (e.g. SDK regeneration, example app updates), and plan drift.
`.trim();
const IMPLEMENTATION_PLAN_CONTEXT = `
Implementation plans live in docs/implementationPlans/.
When a PR appears to implement a plan, compare the changed code against:
- required scope and explicitly excluded scope,
- "changed from original plan" sections,
- acceptance criteria or rollout notes,
- migrations, follow-up docs, and test commitments called out in the plan.

Only report confirmed discrepancies that are grounded in the diff and referenced plan content.
`.trim();
const ARCHITECTURAL_REVIEW_PROMPT = `
You are Terreno's architectural pull request reviewer.

Review this PR holistically, looking for the kinds of issues a narrow bug-finding bot might miss:
- architectural boundary violations between the api/ui/rtk/ai/admin packages and the example apps,
- duplicated logic or schema/config patterns that should be shared,
- responsibilities placed in the wrong module or layer,
- partial implementations that missed required follow-through in adjacent layers,
- refactors that the current diff strongly suggests but does not complete,
- plan-versus-implementation discrepancies when implementation plans are provided,
- missing tests or documentation only when that gap creates material architectural or rollout risk.

Rules:
- Prefer zero findings over weak findings.
- Only report material concerns that are supported by the provided diff, changed files, and referenced plans.
- Do not invent repository facts beyond the supplied context.
- Be conservative about security/privacy claims unless the diff clearly shows them.
- Suggested refactors must be grounded in concrete duplication, coupling, or repeated patterns from this PR.
- If implementation plans are provided, distinguish true discrepancies from mere open questions.
- If no architectural feedback is warranted, set overallAssessment to "no_comment" with an empty findings array. It is perfectly acceptable — and preferred — to return no_comment for straightforward, well-structured changes.
- Be concise: finding summaries should be 1-2 sentences. Recommendations should be a single actionable sentence. Evidence details should be brief and specific.
- Always include specific file paths and line numbers in evidence fields. These are used to place inline code comments and generate linked references.

When this is an incremental re-review (previous review comments are provided below):
- Review only the incremental diff and newly changed files since the last review.
- Do not repeat findings already captured in previous review comments.
- Do not re-raise issues from resolved review threads or threads where participants explained the concern is not an issue, intentional, or already addressed.
- Only report new material concerns introduced by or visible in the incremental changes.
- If incremental changes introduce no new architectural concerns, set overallAssessment to "no_comment" with an empty findings array even when earlier review comments remain open.
`.trim();
const ARCHITECTURAL_REVIEW_TASK_PREFIX = `
Produce a structured architectural review for the PR described below.
`.trim();

const ReviewEvidenceSchema = z.object({
  detail: z.string(),
  file: z.string(),
  lines: z.string().optional(),
});

const ReviewFindingSchema = z.object({
  category: z.enum([
    "architecture",
    "duplication",
    "refactor",
    "plan",
    "testing",
    "documentation",
    "operability",
  ]),
  recommendation: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  summary: z.string(),
  title: z.string(),
  evidence: z.array(ReviewEvidenceSchema).min(1).max(4),
});

const ReviewPlanComparisonSchema = z.object({
  comparedPlanPaths: z.array(z.string()).max(MAX_FETCHED_PLAN_FILES),
  discrepancies: z.array(z.string()).max(10),
  notes: z.array(z.string()).max(10),
  status: z.enum(["not_applicable", "aligned", "discrepancies_found"]),
});

const ArchitecturalReviewSchema = z.object({
  findings: z.array(ReviewFindingSchema).max(8),
  overallAssessment: z.enum(["no_comment", "clear", "watch", "concern"]),
  planComparison: ReviewPlanComparisonSchema,
  suggestedRefactors: z.array(z.string()).max(6),
  summary: z.string(),
});

type ArchitecturalReview = z.infer<typeof ArchitecturalReviewSchema>;
type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

interface PullRequestEventPayload {
  action: string;
  pull_request: {
    base: {
      ref: string;
      sha: string;
    };
    body: string | null;
    draft: boolean;
    head: {
      ref: string;
      sha: string;
    };
    html_url: string;
    number: number;
    title: string;
    user: {
      login: string;
    };
  };
  repository: {
    default_branch?: string;
    full_name: string;
    name: string;
    owner: {
      login: string;
    };
  };
}

interface GitHubPullRequestFile {
  additions: number;
  deletions: number;
  filename: string;
  patch?: string;
  previous_filename?: string;
  status: string;
}

interface GitHubIssueComment {
  body: string;
  id: number;
}

interface GitHubPullRequestReviewComment {
  body: string;
  id: number;
  path?: string;
}

interface GitHubCompareResponse {
  files: GitHubPullRequestFile[];
}

interface ReviewThreadComment {
  authorLogin: string;
  body: string;
}

interface PreviousReviewThread {
  comments: ReviewThreadComment[];
  isResolved: boolean;
}

interface PreviousReviewContext {
  existingFindingFingerprints: string[];
  incrementalFromSha: string | null;
  previousFindingComments: GitHubPullRequestReviewComment[];
  previousSummaryComment: GitHubIssueComment | null;
  reviewThreads: PreviousReviewThread[];
}

interface ImplementationPlanContent {
  content: string | null;
  path: string;
}

interface GitHubRequestOptions {
  accept?: string;
  token: string;
}

interface FileDiffContextOptions {
  maxCharacters?: number;
}

interface LinkContext {
  headSha: string;
  owner: string;
  repo: string;
}

const SEVERITY_ORDER: Record<ReviewFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Reads and validates the GitHub pull_request_target event payload from disk.
 *
 * @param eventPath - Path to the JSON event payload written by GitHub Actions.
 * @returns Parsed pull request event data used for API fetches and comments.
 */
export const parsePullRequestEvent = (eventPath: string): PullRequestEventPayload => {
  if (eventPath === "") {
    throw new Error("GITHUB_EVENT_PATH is required.");
  }

  const rawEvent = JSON.parse(readFileSync(eventPath, "utf8")) as Partial<PullRequestEventPayload>;
  if (rawEvent.pull_request === undefined || rawEvent.repository === undefined) {
    throw new Error("This workflow only supports pull_request_target events.");
  }

  return rawEvent as PullRequestEventPayload;
};

const CIRCLE_PULL_REQUEST_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

export interface CirclePullRequestRef {
  owner: string;
  pullRequestNumber: number;
  repo: string;
}

interface GitHubPullRequestApi {
  base: {
    ref: string;
    repo: {
      default_branch?: string;
      full_name: string;
      name: string;
      owner: {
        login: string;
      };
    };
    sha: string;
  };
  body: string | null;
  draft: boolean;
  head: {
    ref: string;
    sha: string;
  };
  html_url: string;
  number: number;
  title: string;
  user: {
    login: string;
  };
}

/**
 * Parses CircleCI's `CIRCLE_PULL_REQUEST` GitHub URL into owner/repo/number.
 *
 * @param url - Value of `CIRCLE_PULL_REQUEST`.
 * @returns Repository identity and pull request number.
 */
export const parseCirclePullRequestUrl = (url: string): CirclePullRequestRef => {
  const match = url.trim().match(CIRCLE_PULL_REQUEST_URL_PATTERN);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`CIRCLE_PULL_REQUEST is not a GitHub pull request URL: ${url}`);
  }

  return {
    owner: match[1],
    pullRequestNumber: Number.parseInt(match[3], 10),
    repo: match[2],
  };
};

/**
 * Adapts a GitHub pull-request REST payload into the event shape the reviewer
 * already consumes from `GITHUB_EVENT_PATH`.
 *
 * @param pullRequest - GitHub `GET /repos/{owner}/{repo}/pulls/{number}` body.
 * @returns Event payload used by the rest of this script.
 */
export const pullRequestEventFromApi = (pullRequest: GitHubPullRequestApi): PullRequestEventPayload => {
  return {
    action: "synchronize",
    pull_request: {
      base: {
        ref: pullRequest.base.ref,
        sha: pullRequest.base.sha,
      },
      body: pullRequest.body,
      draft: pullRequest.draft,
      head: {
        ref: pullRequest.head.ref,
        sha: pullRequest.head.sha,
      },
      html_url: pullRequest.html_url,
      number: pullRequest.number,
      title: pullRequest.title,
      user: {
        login: pullRequest.user.login,
      },
    },
    repository: {
      default_branch: pullRequest.base.repo.default_branch,
      full_name: pullRequest.base.repo.full_name,
      name: pullRequest.base.repo.name,
      owner: {
        login: pullRequest.base.repo.owner.login,
      },
    },
  };
};

/**
 * Collects implementation plan paths either directly changed in the PR or
 * explicitly referenced in the PR body.
 *
 * @param prBody - Pull request description text.
 * @param changedFiles - Changed file metadata from the GitHub pull request files API.
 * @returns Unique plan paths that should be compared against the implementation.
 */
export const selectImplementationPlanPaths = ({
  changedFiles,
  prBody,
}: {
  changedFiles: GitHubPullRequestFile[];
  prBody: string | null;
}): string[] => {
  const referencedPlanPaths = new Set<string>();

  for (const changedFile of changedFiles) {
    if (changedFile.filename.startsWith("docs/implementationPlans/") && changedFile.filename.endsWith(".md")) {
      referencedPlanPaths.add(changedFile.filename);
    }
  }

  const normalizedPrBody = prBody ?? "";
  const planPathMatches = normalizedPrBody.matchAll(/docs\/implementationPlans\/[A-Za-z0-9._/-]+\.md/g);
  for (const match of planPathMatches) {
    referencedPlanPaths.add(match[0]);
  }

  return [...referencedPlanPaths].sort();
};

/**
 * Summarizes which top-level repository areas a PR touches so the reviewer can
 * reason about cross-layer follow-through.
 *
 * @param changedFiles - Changed file metadata from the pull request.
 * @returns Human-readable summary such as "backend (4), app (2), docs (1)".
 */
export const summarizeChangedAreas = (changedFiles: GitHubPullRequestFile[]): string => {
  const areaCounts = new Map<string, number>();

  for (const changedFile of changedFiles) {
    const [topLevelArea] = changedFile.filename.split("/");
    const areaKey = topLevelArea === undefined || topLevelArea === "" ? "(root)" : topLevelArea;
    areaCounts.set(areaKey, (areaCounts.get(areaKey) ?? 0) + 1);
  }

  return [...areaCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([area, count]) => `${area} (${count})`)
    .join(", ");
};

/**
 * Determines whether a GitHub login belongs to a bot account that should not
 * receive architectural reviews.
 *
 * @param login - GitHub username from the pull request event.
 * @returns True when the login matches a known bot pattern.
 */
export const isBotUser = (login: string): boolean => {
  const normalizedLogin = login.toLowerCase();
  if (normalizedLogin.includes("[bot]")) {
    return true;
  }

  return BOT_USER_PATTERNS.some((pattern) => normalizedLogin.includes(pattern));
};

/**
 * Renders the hidden marker that records which PR head SHA was last reviewed.
 *
 * @param headSha - Commit SHA reviewed in the current workflow run.
 * @returns HTML comment marker embedded in the sticky summary comment.
 */
export const renderLastReviewedShaMarker = (headSha: string): string => {
  return `${LAST_REVIEWED_SHA_MARKER_PREFIX}${headSha}${LAST_REVIEWED_SHA_MARKER_SUFFIX}`;
};

/**
 * Extracts the last reviewed head SHA from a sticky architectural review comment.
 *
 * @param commentBody - Existing sticky issue comment body, if any.
 * @returns Previously reviewed head SHA, or null when no marker is present.
 */
export const extractLastReviewedSha = (commentBody: string | null | undefined): string | null => {
  if (commentBody === null || commentBody === undefined || commentBody === "") {
    return null;
  }

  const markerMatch = commentBody.match(
    new RegExp(`${LAST_REVIEWED_SHA_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([0-9a-f]+)${LAST_REVIEWED_SHA_MARKER_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
  );
  if (markerMatch === null || markerMatch[1] === undefined) {
    return null;
  }

  return markerMatch[1];
};

/**
 * Parses the finding title from an architectural review inline comment body.
 *
 * @param commentBody - Inline review comment body posted by this workflow.
 * @returns Parsed finding title, or null when the body is not a finding comment.
 */
export const parseFindingTitleFromComment = (commentBody: string): string | null => {
  if (!commentBody.includes(FINDING_COMMENT_MARKER)) {
    return null;
  }

  const titleMatch = commentBody.match(FINDING_TITLE_PATTERN);
  if (titleMatch === null || titleMatch[1] === undefined) {
    return null;
  }

  return titleMatch[1].trim();
};

/**
 * Builds a stable fingerprint for deduplicating architectural findings across runs.
 *
 * @param finding - Structured finding or parsed finding metadata.
 * @returns Lowercase fingerprint combining title and primary evidence location.
 */
export const buildFindingFingerprint = ({
  evidenceFile,
  evidenceLines,
  title,
}: {
  evidenceFile?: string;
  evidenceLines?: string;
  title: string;
}): string => {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedFile = (evidenceFile ?? "").trim().toLowerCase();
  const normalizedLines = (evidenceLines ?? "").trim().toLowerCase();
  return `${normalizedTitle}|${normalizedFile}|${normalizedLines}`;
};

/**
 * Filters out findings that duplicate comments already posted on the pull request.
 *
 * @param options - Candidate findings and fingerprints from existing review comments.
 * @returns Findings that should be posted as new inline comments.
 */
export const filterNewFindings = ({
  existingFingerprints,
  findings,
}: {
  existingFingerprints: string[];
  findings: ReviewFinding[];
}): ReviewFinding[] => {
  const existingFingerprintSet = new Set(existingFingerprints);

  return findings.filter((finding) => {
    const primaryEvidence = finding.evidence[0];
    const fingerprint = buildFindingFingerprint({
      evidenceFile: primaryEvidence?.file,
      evidenceLines: primaryEvidence?.lines,
      title: finding.title,
    });
    return !existingFingerprintSet.has(fingerprint);
  });
};

/**
 * Builds fingerprints for architectural findings already posted on the PR.
 *
 * @param reviewComments - Existing inline review comments from prior runs.
 * @returns Fingerprints used to avoid reposting the same finding.
 */
export const collectExistingFindingFingerprints = (
  reviewComments: GitHubPullRequestReviewComment[]
): string[] => {
  const fingerprints = new Set<string>();

  for (const reviewComment of reviewComments) {
    const title = parseFindingTitleFromComment(reviewComment.body);
    if (title === null) {
      continue;
    }

    const fileRefMatch = reviewComment.body.match(/\[`([^`]+)`\]/);
    const fileRef = fileRefMatch?.[1] ?? reviewComment.path ?? "";
    const [evidenceFile, evidenceLines] = fileRef.includes(":")
      ? ((): [string, string | undefined] => {
          const separatorIndex = fileRef.lastIndexOf(":");
          if (separatorIndex === -1) {
            return [fileRef, undefined];
          }

          return [fileRef.slice(0, separatorIndex), fileRef.slice(separatorIndex + 1)];
        })()
      : [fileRef, undefined];

    fingerprints.add(
      buildFindingFingerprint({
        evidenceFile,
        evidenceLines,
        title,
      })
    );
  }

  return [...fingerprints];
};

/**
 * Formats prior architectural review comments and thread status for the model.
 *
 * @param previousReviewContext - Previously posted summary, findings, and thread metadata.
 * @returns Markdown section describing prior review state for incremental reruns.
 */
export const buildPreviousReviewContextSection = (previousReviewContext: PreviousReviewContext): string => {
  const sections: string[] = [];

  if (previousReviewContext.previousSummaryComment !== null) {
    sections.push(
      "### Previous summary comment",
      previousReviewContext.previousSummaryComment.body.replace(STICKY_COMMENT_MARKER, "").trim()
    );
  }

  if (previousReviewContext.previousFindingComments.length > 0) {
    sections.push("", "### Previous inline findings");
    for (const findingComment of previousReviewContext.previousFindingComments) {
      sections.push("", findingComment.body.trim());
    }
  }

  const architecturalThreads = previousReviewContext.reviewThreads.filter((thread) =>
    thread.comments.some(
      (comment) =>
        comment.body.includes(FINDING_COMMENT_MARKER) || comment.body.includes(STICKY_COMMENT_MARKER)
    )
  );

  if (architecturalThreads.length > 0) {
    sections.push("", "### Prior review thread status");
    for (const [index, thread] of architecturalThreads.entries()) {
      sections.push("", `#### Thread ${index + 1}${thread.isResolved ? " (resolved)" : ""}`);
      for (const comment of thread.comments) {
        sections.push(`- @${comment.authorLogin}: ${comment.body.trim()}`);
      }
    }
  }

  if (sections.length === 0) {
    return "No previous architectural review comments were found on this pull request.";
  }

  return sections.join("\n");
};

/**
 * Extracts the file path and line number of the first changed line in the PR
 * diff, used to anchor the review comment so it is resolvable in GitHub.
 *
 * @param changedFiles - Changed file metadata including patches from the pull request files API.
 * @returns File path and line number for the first diff hunk, or null when no usable patch exists.
 */
export const getFirstDiffPosition = (changedFiles: GitHubPullRequestFile[]): {line: number; path: string} | null => {
  for (const changedFile of changedFiles) {
    if (changedFile.patch === undefined) {
      continue;
    }

    const hunkMatch = changedFile.patch.match(/@@ .+? \+(\d+)/);
    if (hunkMatch !== null && hunkMatch[1] !== undefined) {
      return {line: parseInt(hunkMatch[1], 10), path: changedFile.filename};
    }
  }

  return null;
};

/**
 * Builds a bounded diff context from per-file GitHub patches while preserving a
 * note about omitted or patchless files.
 *
 * @param changedFiles - Changed file metadata from the pull request files API.
 * @param options - Optional max character budget for diff excerpts.
 * @returns Diff snippets formatted as Markdown for the review prompt.
 */
export const buildFileDiffContext = (
  changedFiles: GitHubPullRequestFile[],
  options: FileDiffContextOptions = {}
): string => {
  const maxCharacters = options.maxCharacters ?? MAX_DIFF_SECTION_CHARACTERS;
  const prioritizedFiles = [...changedFiles].sort((left, right) => {
    const leftIsPlan = left.filename.startsWith("docs/implementationPlans/") ? 1 : 0;
    const rightIsPlan = right.filename.startsWith("docs/implementationPlans/") ? 1 : 0;
    if (leftIsPlan !== rightIsPlan) {
      return rightIsPlan - leftIsPlan;
    }

    const leftIsCode = isHighSignalFile(left.filename) ? 1 : 0;
    const rightIsCode = isHighSignalFile(right.filename) ? 1 : 0;
    if (leftIsCode !== rightIsCode) {
      return rightIsCode - leftIsCode;
    }

    const leftMagnitude = left.additions + left.deletions;
    const rightMagnitude = right.additions + right.deletions;
    return rightMagnitude - leftMagnitude;
  });

  const renderedSections: string[] = [];
  const omittedFiles: string[] = [];
  let remainingBudget = maxCharacters;

  for (let index = 0; index < prioritizedFiles.length; index += 1) {
    const changedFile = prioritizedFiles[index];
    if (changedFile.patch === undefined) {
      omittedFiles.push(`${changedFile.filename} (patch unavailable from GitHub)`);
      continue;
    }

    if (remainingBudget < MIN_DIFF_SECTION_CHARACTER_BUDGET) {
      omittedFiles.push(changedFile.filename);
      continue;
    }

    const header = `### ${changedFile.filename} (${changedFile.status}, +${changedFile.additions}/-${changedFile.deletions})\n`;
    const codeFencePrefix = "```diff\n";
    const codeFenceSuffix = "\n```\n";
    const fixedOverhead = header.length + codeFencePrefix.length + codeFenceSuffix.length;

    if (remainingBudget <= fixedOverhead + 50) {
      omittedFiles.push(changedFile.filename);
      continue;
    }

    const availablePatchCharacters = remainingBudget - fixedOverhead;
    const patch = changedFile.patch.slice(0, availablePatchCharacters);
    const wasTruncated = patch.length < changedFile.patch.length;
    const truncatedSuffix = wasTruncated ? "\n... [patch truncated for context budget]" : "";
    const section = `${header}${codeFencePrefix}${patch}${truncatedSuffix}${codeFenceSuffix}`;

    renderedSections.push(section);
    remainingBudget -= section.length;

    if (wasTruncated) {
      omittedFiles.push(
        ...prioritizedFiles
          .slice(index + 1)
          .map((remainingFile) => remainingFile.filename)
      );
      break;
    }
  }

  if (omittedFiles.length > 0) {
    const omittedSummary = omittedFiles.slice(0, MAX_OMITTED_FILE_NOTES).map((file) => `- ${file}`);
    if (omittedFiles.length > MAX_OMITTED_FILE_NOTES) {
      omittedSummary.push(`- ... ${omittedFiles.length - MAX_OMITTED_FILE_NOTES} more files omitted from diff excerpts`);
    }
    renderedSections.push(`### Omitted files\n${omittedSummary.join("\n")}\n`);
  }

  return renderedSections.join("\n");
};

/**
 * Parses an evidence line range string into start and optional end line numbers.
 *
 * @param lines - Line range string such as "10", "10-42", or "10-42".
 * @returns Parsed line range, or null when the format is unrecognized.
 */
export const parseEvidenceLineRange = (lines: string): {end?: number; start: number} | null => {
  const rangeMatch = lines.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch !== null && rangeMatch[1] !== undefined && rangeMatch[2] !== undefined) {
    return {end: parseInt(rangeMatch[2], 10), start: parseInt(rangeMatch[1], 10)};
  }

  const singleMatch = lines.match(/^(\d+)$/);
  if (singleMatch !== null && singleMatch[1] !== undefined) {
    return {start: parseInt(singleMatch[1], 10)};
  }

  return null;
};

/**
 * Builds a GitHub permalink for a piece of evidence, rendered as a clickable
 * Markdown link in review comments.
 *
 * @param options - Evidence data and repository link context.
 * @returns Markdown link such as `[\`file.ts:10-42\`](https://github.com/...)`.
 */
const buildEvidenceLink = ({
  evidence,
  linkContext,
}: {
  evidence: z.infer<typeof ReviewEvidenceSchema>;
  linkContext: LinkContext;
}): string => {
  const {headSha, owner, repo} = linkContext;
  const fileRef = evidence.lines !== undefined ? `${evidence.file}:${evidence.lines}` : evidence.file;

  let anchor = "";
  if (evidence.lines !== undefined) {
    const lineRange = parseEvidenceLineRange(evidence.lines);
    if (lineRange !== null) {
      anchor = lineRange.end !== undefined ? `#L${lineRange.start}-L${lineRange.end}` : `#L${lineRange.start}`;
    }
  }

  const url = `https://github.com/${owner}/${repo}/blob/${headSha}/${evidence.file}${anchor}`;
  return `[\`${fileRef}\`](${url})`;
};

/**
 * Extracts the set of new-side line numbers that appear in a unified diff patch,
 * used to validate whether an evidence line can be used for a review comment.
 *
 * @param patch - Unified diff patch string from the GitHub files API.
 * @returns Set of valid right-side line numbers.
 */
const getValidDiffLines = (patch: string): Set<number> => {
  const validLines = new Set<number>();
  let currentNewLine = 0;

  for (const line of patch.split("\n")) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch !== null && hunkMatch[1] !== undefined) {
      currentNewLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (line.startsWith("-")) {
      continue;
    }

    if (line.startsWith("+") || line.startsWith(" ")) {
      validLines.add(currentNewLine);
      currentNewLine += 1;
    }
  }

  return validLines;
};

/**
 * Determines the file and line to place a finding comment on based on the
 * finding's evidence and the available diff hunks.
 *
 * @param options - Finding to place and changed file metadata.
 * @returns File path and line for the review comment, or null when no valid position exists.
 */
export const resolveCommentPosition = ({
  changedFiles,
  finding,
}: {
  changedFiles: GitHubPullRequestFile[];
  finding: ReviewFinding;
}): {line: number; path: string} | null => {
  if (finding.evidence.length === 0) {
    return null;
  }

  const primaryEvidence = finding.evidence[0];
  const targetFile = changedFiles.find((changedFile) => changedFile.filename === primaryEvidence.file);

  if (targetFile === undefined || targetFile.patch === undefined) {
    return null;
  }

  const filePosition = getFirstDiffPosition([targetFile]);
  if (filePosition === null) {
    return null;
  }

  if (primaryEvidence.lines !== undefined) {
    const lineRange = parseEvidenceLineRange(primaryEvidence.lines);
    if (lineRange !== null) {
      const validLines = getValidDiffLines(targetFile.patch);
      if (validLines.has(lineRange.start)) {
        return {line: lineRange.start, path: targetFile.filename};
      }

      if (lineRange.end !== undefined && validLines.has(lineRange.end)) {
        return {line: lineRange.end, path: targetFile.filename};
      }
    }
  }

  return filePosition;
};

interface ParsedStickySummarySections {
  planComparisonContent: string | null;
  priorSummaryText: string | null;
  suggestedRefactorItems: string[];
}

/**
 * Removes machine-readable markers from a sticky architectural review comment.
 *
 * @param commentBody - Raw sticky issue comment body.
 * @returns Comment body without hidden workflow markers.
 */
const stripStickySummaryMarkers = (commentBody: string): string => {
  return commentBody
    .replace(STICKY_COMMENT_MARKER, "")
    .replace(
      new RegExp(
        `${LAST_REVIEWED_SHA_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[0-9a-f]+${LAST_REVIEWED_SHA_MARKER_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "i"
      ),
      ""
    )
    .trim();
};

/**
 * Extracts a collapsible details block from a sticky summary comment by summary label.
 *
 * @param commentBody - Sticky issue comment body.
 * @param summaryLabelPrefix - Start of the `<summary>` label to match.
 * @returns Inner markdown content for the matching details block.
 */
const extractStickyDetailsBlock = (commentBody: string, summaryLabelPrefix: string): string | null => {
  const escapedPrefix = summaryLabelPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<details>\\s*<summary>${escapedPrefix}[^<]*</summary>([\\s\\S]*?)</details>`,
    "i"
  );
  const match = commentBody.match(pattern);
  if (match === null || match[1] === undefined) {
    return null;
  }

  return match[1].trim();
};

/**
 * Parses reusable sections from a prior sticky architectural review comment.
 *
 * @param commentBody - Existing sticky issue comment body, if any.
 * @returns Prior summary text and collapsible sections for incremental merges.
 */
export const parseStickySummarySections = (commentBody: string | null | undefined): ParsedStickySummarySections => {
  if (commentBody === null || commentBody === undefined || commentBody === "") {
    return {
      planComparisonContent: null,
      priorSummaryText: null,
      suggestedRefactorItems: [],
    };
  }

  const normalizedBody = stripStickySummaryMarkers(commentBody);
  const afterHeader = normalizedBody.split("### Architectural review")[1] ?? normalizedBody;
  const contentBeforeDetails = afterHeader.split("<details>")[0] ?? "";
  const summaryLines = contentBeforeDetails
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (line === "") {
        return false;
      }

      if (line.startsWith("**Assessment:**")) {
        return false;
      }

      if (line.startsWith("**Scope:**")) {
        return false;
      }

      if (line.startsWith("No material architectural concerns identified.")) {
        return false;
      }

      if (line.startsWith("No new material architectural concerns identified in the latest changes.")) {
        return false;
      }

      return true;
    });

  const refactorContent = extractStickyDetailsBlock(normalizedBody, "Suggested refactors");
  const suggestedRefactorItems =
    refactorContent === null
      ? []
      : refactorContent
          .split("\n")
          .map((line) => line.replace(/^- /, "").trim())
          .filter((line) => line !== "");

  return {
    planComparisonContent: extractStickyDetailsBlock(normalizedBody, "Plan comparison"),
    priorSummaryText: summaryLines.join("\n").trim() || null,
    suggestedRefactorItems,
  };
};

/**
 * Merges prior sticky summary sections into the current review for incremental reruns.
 *
 * @param options - Current review payload and parsed prior sticky summary sections.
 * @returns Review fields with prior plan/refactor context preserved when the latest run is sparse.
 */
export const mergeIncrementalSummaryReview = ({
  parsedPreviousSections,
  review,
}: {
  parsedPreviousSections: ParsedStickySummarySections;
  review: ArchitecturalReview;
}): {
  mergedReview: ArchitecturalReview;
  priorSummaryText: string | null;
  reusedPlanComparisonContent: string | null;
} => {
  const mergedRefactors = [...review.suggestedRefactors];
  for (const refactor of parsedPreviousSections.suggestedRefactorItems) {
    const normalizedRefactor = refactor.trim().toLowerCase();
    const alreadyPresent = mergedRefactors.some(
      (existingRefactor) => existingRefactor.trim().toLowerCase() === normalizedRefactor
    );
    if (!alreadyPresent) {
      mergedRefactors.push(refactor);
    }
  }

  const hasCurrentPlanComparison = review.planComparison.comparedPlanPaths.length > 0;
  const reusedPlanComparisonContent = hasCurrentPlanComparison
    ? null
    : parsedPreviousSections.planComparisonContent;

  return {
    mergedReview: {
      ...review,
      suggestedRefactors: mergedRefactors.slice(0, 6),
    },
    priorSummaryText: parsedPreviousSections.priorSummaryText,
    reusedPlanComparisonContent,
  };
};

/**
 * Renders the overall summary as an issue comment body with collapsible
 * sections for plan comparison and suggested refactors.
 *
 * @param options - Structured review and count of inline findings posted.
 * @returns Markdown comment body for the sticky issue comment.
 */
export const renderOverallSummaryComment = ({
  existingFindingsCount = 0,
  findingsCount,
  headSha,
  incrementalFromSha = null,
  previousStickyBody = null,
  review,
  unanchorableFindings = [],
}: {
  existingFindingsCount?: number;
  findingsCount: number;
  headSha: string;
  incrementalFromSha?: string | null;
  previousStickyBody?: string | null;
  review: ArchitecturalReview;
  unanchorableFindings?: ReviewFinding[];
}): string => {
  const parsedPreviousSections =
    incrementalFromSha === null ? null : parseStickySummarySections(previousStickyBody);
  const mergedSummary =
    parsedPreviousSections === null
      ? {
          mergedReview: review,
          priorSummaryText: null,
          reusedPlanComparisonContent: null,
        }
      : mergeIncrementalSummaryReview({
          parsedPreviousSections,
          review,
        });
  const effectiveReview = mergedSummary.mergedReview;
  const newFindingsSuffix =
    findingsCount > 0 ? ` | ${findingsCount} new finding(s) posted as inline comments` : "";
  const existingFindingsSuffix =
    existingFindingsCount > 0 ? ` | ${existingFindingsCount} prior finding comment(s) preserved` : "";
  const lines = [
    STICKY_COMMENT_MARKER,
    renderLastReviewedShaMarker(headSha),
    "### Architectural review",
    "",
    `**Assessment:** ${formatOverallAssessment(effectiveReview.overallAssessment)}${newFindingsSuffix}${existingFindingsSuffix}`,
  ];

  if (incrementalFromSha !== null) {
    lines.push("", `**Scope:** Incremental review of changes since \`${incrementalFromSha.slice(0, 7)}\`.`);
  }

  lines.push("", effectiveReview.summary);

  if (
    incrementalFromSha !== null &&
    mergedSummary.priorSummaryText !== null &&
    mergedSummary.priorSummaryText.trim() !== "" &&
    mergedSummary.priorSummaryText.trim() !== effectiveReview.summary.trim()
  ) {
    lines.push(
      "",
      "<details>",
      "<summary>Prior review summary</summary>",
      "",
      mergedSummary.priorSummaryText,
      "",
      "</details>"
    );
  }

  if (mergedSummary.reusedPlanComparisonContent !== null) {
    lines.push(
      "",
      "<details>",
      "<summary>Plan comparison</summary>",
      "",
      mergedSummary.reusedPlanComparisonContent,
      "",
      "</details>"
    );
  } else if (effectiveReview.planComparison.comparedPlanPaths.length > 0) {
    const planDetails: string[] = [
      `**Status:** ${formatPlanComparisonStatus(effectiveReview.planComparison.status)}`,
      `**Compared:** ${effectiveReview.planComparison.comparedPlanPaths.map((planPath) => `\`${planPath}\``).join(", ")}`,
    ];

    if (effectiveReview.planComparison.discrepancies.length > 0) {
      planDetails.push("", "**Discrepancies:**");
      for (const discrepancy of effectiveReview.planComparison.discrepancies) {
        planDetails.push(`- ${discrepancy}`);
      }
    }

    if (effectiveReview.planComparison.notes.length > 0) {
      planDetails.push("", "**Notes:**");
      for (const note of effectiveReview.planComparison.notes) {
        planDetails.push(`- ${note}`);
      }
    }

    lines.push("", "<details>", "<summary>Plan comparison</summary>", "", ...planDetails, "", "</details>");
  }

  if (effectiveReview.suggestedRefactors.length > 0) {
    lines.push(
      "",
      "<details>",
      `<summary>Suggested refactors (${effectiveReview.suggestedRefactors.length})</summary>`,
      "",
      ...effectiveReview.suggestedRefactors.map((suggestion) => `- ${suggestion}`),
      "",
      "</details>"
    );
  }

  if (unanchorableFindings.length > 0) {
    lines.push(
      "",
      "<details>",
      `<summary>Additional findings not anchored to diff lines (${unanchorableFindings.length})</summary>`,
      ""
    );
    const sortedUnanchorable = [...unanchorableFindings].sort(
      (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    );
    for (const finding of sortedUnanchorable) {
      lines.push(
        `- **${formatSeverity(finding.severity)} ${finding.title}** (${finding.category})`,
        `  ${finding.summary}`,
        `  **Recommendation:** ${finding.recommendation}`,
        ""
      );
    }
    lines.push("</details>");
  }

  if (findingsCount === 0 && unanchorableFindings.length === 0) {
    if (incrementalFromSha !== null) {
      lines.push("", "No new material architectural concerns identified in the latest changes.");
    } else {
      lines.push("", "No material architectural concerns identified.");
    }
  }

  return `${lines.join("\n")}\n`;
};

/**
 * Renders a single finding as a concise review comment body with linked
 * evidence references.
 *
 * @param options - Finding data and repository link context.
 * @returns Markdown body for an inline PR review comment.
 */
export const renderFindingComment = ({
  finding,
  linkContext,
}: {
  finding: ReviewFinding;
  linkContext: LinkContext;
}): string => {
  const lines = [
    FINDING_COMMENT_MARKER,
    `**${formatSeverity(finding.severity)} — ${finding.title}** \`${finding.category}\``,
    "",
    finding.summary,
    "",
    `**Recommendation:** ${finding.recommendation}`,
  ];

  if (finding.evidence.length > 0) {
    lines.push("", "**References:**");
    for (const evidence of finding.evidence) {
      const link = buildEvidenceLink({evidence, linkContext});
      lines.push(`- ${link} — ${evidence.detail}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

/**
 * Creates the full agent input from pull request metadata, architecture context,
 * diff excerpts, and any referenced implementation plans.
 *
 * @param options - Pull request metadata and fetched context for the review.
 * @returns Prompt input passed to the Agent SDK run.
 */
export const buildArchitecturalReviewInput = ({
  changedAreaSummary,
  changedFiles,
  diffContext,
  incrementalFromSha = null,
  planContents,
  previousReviewContext = null,
  pullRequest,
}: {
  changedAreaSummary: string;
  changedFiles: GitHubPullRequestFile[];
  diffContext: string;
  incrementalFromSha?: string | null;
  planContents: ImplementationPlanContent[];
  previousReviewContext?: PreviousReviewContext | null;
  pullRequest: PullRequestEventPayload["pull_request"];
}): string => {
  const normalizedBody = truncateText(pullRequest.body ?? "(no PR description provided)", MAX_PR_BODY_CHARACTERS);
  const changedFileLines = changedFiles.slice(0, MAX_CHANGED_FILE_LIST_ITEMS).map(
    (changedFile) =>
      `- ${changedFile.filename} (${changedFile.status}, +${changedFile.additions}/-${changedFile.deletions})${
        changedFile.previous_filename !== undefined ? ` renamed from ${changedFile.previous_filename}` : ""
      }`
  );
  if (changedFiles.length > MAX_CHANGED_FILE_LIST_ITEMS) {
    changedFileLines.push(`- ... ${changedFiles.length - MAX_CHANGED_FILE_LIST_ITEMS} more changed files omitted from the list`);
  }
  const changedFileList = changedFileLines.join("\n");

  const planSections =
    planContents.length === 0
      ? "No implementation plan files were changed or explicitly referenced in the PR description."
      : planContents
          .map((planContent) => {
            if (planContent.content === null) {
              return `#### ${planContent.path}\nUnable to fetch this plan at the PR head SHA.`;
            }

            return `#### ${planContent.path}\n${truncateText(planContent.content, MAX_PLAN_CONTENT_CHARACTERS)}`;
          })
          .join("\n\n");

  return [
    ARCHITECTURAL_REVIEW_TASK_PREFIX,
    "",
    incrementalFromSha !== null
      ? `This is an incremental re-review. Focus only on changes since commit ${incrementalFromSha}.`
      : "This is the first architectural review for the current pull request state.",
    "",
    "## Repository architecture",
    REPOSITORY_ARCHITECTURE_CONTEXT,
    "",
    "## Implementation plan conventions",
    IMPLEMENTATION_PLAN_CONTEXT,
    "",
    "## Pull request metadata",
    `- Title: ${pullRequest.title}`,
    `- PR number: ${pullRequest.number}`,
    `- Author: ${pullRequest.user.login}`,
    `- Base branch: ${pullRequest.base.ref} (${pullRequest.base.sha})`,
    `- Head branch: ${pullRequest.head.ref} (${pullRequest.head.sha})`,
    `- Draft: ${pullRequest.draft ? "yes" : "no"}`,
    incrementalFromSha !== null ? `- Incremental review from: ${incrementalFromSha}` : "",
    "",
    "## Pull request description",
    normalizedBody,
    "",
    "## Changed areas",
    changedAreaSummary,
    "",
    "## Changed files",
    changedFileList,
    "",
    "## Diff excerpts",
    diffContext,
    "",
    "## Referenced implementation plans",
    planSections,
    "",
    "## Previous architectural review comments",
    previousReviewContext === null
      ? "No previous architectural review comments were found on this pull request."
      : buildPreviousReviewContextSection(previousReviewContext),
  ]
    .filter((section) => section !== "")
    .join("\n");
};

/**
 * Fetches all changed files for the pull request using GitHub's paginated REST API.
 *
 * @param options - Repo identity, pull request number, and authentication token.
 * @returns Full list of changed files including additions/deletions and patches.
 */
export const listPullRequestFiles = async ({
  owner,
  pullRequestNumber,
  repo,
  token,
}: {
  owner: string;
  pullRequestNumber: number;
  repo: string;
  token: string;
}): Promise<GitHubPullRequestFile[]> => {
  const files: GitHubPullRequestFile[] = [];

  for (let page = 1; page < 100; page += 1) {
    const pageFiles = await githubRequestJson<GitHubPullRequestFile[]>({
      path: `/repos/${owner}/${repo}/pulls/${pullRequestNumber}/files?per_page=100&page=${page}`,
      token,
    });

    files.push(...pageFiles);
    if (pageFiles.length < 100) {
      break;
    }
  }

  return files;
};

/**
 * Fetches the file diff between two commits for incremental architectural reviews.
 *
 * @param options - Repo identity, compare range, and authentication token.
 * @returns Changed files with patches limited to the requested commit range.
 */
export const comparePullRequestFiles = async ({
  baseSha,
  headSha,
  owner,
  repo,
  token,
}: {
  baseSha: string;
  headSha: string;
  owner: string;
  repo: string;
  token: string;
}): Promise<GitHubPullRequestFile[]> => {
  const compareResponse = await githubRequestJson<GitHubCompareResponse>({
    path: `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`,
    token,
  });

  return compareResponse.files ?? [];
};

/**
 * Fetches architectural review thread metadata, including resolution status and replies.
 *
 * @param options - Repo identity, pull request number, and authentication token.
 * @returns Review threads with comment bodies used to suppress repeated findings.
 */
export const fetchArchitecturalReviewThreads = async ({
  owner,
  pullRequestNumber,
  repo,
  token,
}: {
  owner: string;
  pullRequestNumber: number;
  repo: string;
  token: string;
}): Promise<PreviousReviewThread[]> => {
  const response = await githubGraphqlRequest<{
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: Array<{
            comments: {
              nodes: Array<{
                author: {login: string | null} | null;
                body: string;
              }>;
            };
            isResolved: boolean;
          }>;
        };
      } | null;
    } | null;
  }>({
    query: `
      query ArchitecturalReviewThreads($owner: String!, $repo: String!, $pullRequestNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pullRequestNumber) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                comments(first: 50) {
                  nodes {
                    body
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    token,
    variables: {
      owner,
      pullRequestNumber,
      repo,
    },
  });

  const threadNodes = response.repository?.pullRequest?.reviewThreads.nodes ?? [];
  return threadNodes.map((thread) => ({
    comments: thread.comments.nodes.map((comment) => ({
      authorLogin: comment.author?.login ?? "unknown",
      body: comment.body,
    })),
    isResolved: thread.isResolved,
  }));
};

/**
 * Fetches raw file contents from the repository at a specific ref without
 * checking out the pull request head locally.
 *
 * @param options - Repo identity, file path, ref SHA, and authentication token.
 * @returns Raw UTF-8 file contents, or null when the file cannot be fetched.
 */
export const fetchRepositoryFileText = async ({
  owner,
  path,
  ref,
  repo,
  token,
}: {
  owner: string;
  path: string;
  ref: string;
  repo: string;
  token: string;
}): Promise<string | null> => {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const response = await fetch(`${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, {
    headers: createGitHubHeaders({
      accept: "application/vnd.github.raw",
      token,
    }),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub contents API failed for ${path}: ${response.status} ${response.statusText} - ${body}`);
  }

  return response.text();
};

/**
 * Fetches the existing sticky review comment, if any, so the workflow can
 * update it instead of creating duplicate comments.
 *
 * @param options - Repo identity, pull request number, and authentication token.
 * @returns Existing sticky comment metadata, or null when not found.
 */
export const findExistingStickyComment = async ({
  owner,
  pullRequestNumber,
  repo,
  token,
}: {
  owner: string;
  pullRequestNumber: number;
  repo: string;
  token: string;
}): Promise<GitHubIssueComment | null> => {
  for (let page = 1; page < 100; page += 1) {
    const comments = await githubRequestJson<GitHubIssueComment[]>({
      path: `/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments?per_page=100&page=${page}`,
      token,
    });

    const existingComment = comments.find((comment) => comment.body.includes(STICKY_COMMENT_MARKER));
    if (existingComment !== undefined) {
      return existingComment;
    }

    if (comments.length < 100) {
      break;
    }
  }

  return null;
};

/**
 * Finds existing architectural finding comments posted as PR review comments.
 *
 * @param options - Repo identity, pull request number, and authentication token.
 * @returns Array of review comments containing the finding marker.
 */
export const findExistingReviewComments = async ({
  owner,
  pullRequestNumber,
  repo,
  token,
}: {
  owner: string;
  pullRequestNumber: number;
  repo: string;
  token: string;
}): Promise<GitHubPullRequestReviewComment[]> => {
  const matchingComments: GitHubPullRequestReviewComment[] = [];

  for (let page = 1; page < 100; page += 1) {
    const comments = await githubRequestJson<GitHubPullRequestReviewComment[]>({
      path: `/repos/${owner}/${repo}/pulls/${pullRequestNumber}/comments?per_page=100&page=${page}`,
      token,
    });

    for (const comment of comments) {
      if (comment.body.includes(FINDING_COMMENT_MARKER)) {
        matchingComments.push(comment);
      }
    }

    if (comments.length < 100) {
      break;
    }
  }

  return matchingComments;
};

/**
 * Updates or creates the sticky issue comment containing the overall summary.
 *
 * @param options - Repo identity, pull request number, markdown body, and authentication token.
 * @returns Promise that resolves after the GitHub API mutation succeeds.
 */
const upsertIssueSummaryComment = async ({
  body,
  owner,
  pullRequestNumber,
  repo,
  token,
}: {
  body: string;
  owner: string;
  pullRequestNumber: number;
  repo: string;
  token: string;
}): Promise<void> => {
  const existingComment = await findExistingStickyComment({
    owner,
    pullRequestNumber,
    repo,
    token,
  });

  if (existingComment === null) {
    await githubRequestJson({
      method: "POST",
      path: `/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments`,
      token,
      body: {body},
    });
    return;
  }

  await githubRequestJson({
    method: "PATCH",
    path: `/repos/${owner}/${repo}/issues/comments/${existingComment.id}`,
    token,
    body: {body},
  });
};

/**
 * Returns whether a review started for `expectedHeadSha` should skip posting
 * because the pull request head has moved to a newer commit.
 */
export const isStalePullRequestHead = ({
  expectedHeadSha,
  liveHeadSha,
}: {
  expectedHeadSha: string;
  liveHeadSha: string;
}): boolean => expectedHeadSha !== liveHeadSha;

/**
 * Fetches the current pull request head commit SHA from the GitHub API.
 */
const fetchPullRequestHeadSha = async ({
  owner,
  pullRequestNumber,
  repo,
  token,
}: {
  owner: string;
  pullRequestNumber: number;
  repo: string;
  token: string;
}): Promise<string> => {
  const pullRequest = await githubRequestJson<{head: {sha: string}}>({
    path: `/repos/${owner}/${repo}/pulls/${pullRequestNumber}`,
    token,
  });

  return pullRequest.head.sha;
};

/**
 * Posts new architectural review findings while preserving prior inline comments.
 *
 * @param options - Review data, changed files, and GitHub API context.
 * @returns Promise that resolves after all comments are posted.
 */
export const postArchitecturalReview = async ({
  changedFiles,
  existingFindingComments,
  headSha,
  incrementalFromSha = null,
  owner,
  previousStickyBody = null,
  pullRequestNumber,
  repo,
  review,
  token,
}: {
  changedFiles: GitHubPullRequestFile[];
  existingFindingComments: GitHubPullRequestReviewComment[];
  headSha: string;
  incrementalFromSha?: string | null;
  owner: string;
  previousStickyBody?: string | null;
  pullRequestNumber: number;
  repo: string;
  review: ArchitecturalReview;
  token: string;
}): Promise<void> => {
  const liveHeadSha = await fetchPullRequestHeadSha({
    owner,
    pullRequestNumber,
    repo,
    token,
  });
  if (isStalePullRequestHead({expectedHeadSha: headSha, liveHeadSha})) {
    console.warn(
      `Skipping architectural review post because PR head moved from ${headSha.slice(0, 7)} to ${liveHeadSha.slice(0, 7)}.`
    );
    return;
  }

  const existingFingerprints = collectExistingFindingFingerprints(existingFindingComments);
  const linkContext: LinkContext = {headSha, owner, repo};

  const sortedFindings = filterNewFindings({
    existingFingerprints,
    findings: [...review.findings].sort(
      (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    ),
  });

  let postedFindingsCount = 0;
  const unanchorableFindings: ReviewFinding[] = [];

  for (const finding of sortedFindings) {
    const position = resolveCommentPosition({changedFiles, finding});
    if (position === null) {
      unanchorableFindings.push(finding);
      continue;
    }

    const findingBody = renderFindingComment({finding, linkContext});
    await githubRequestJson({
      method: "POST",
      path: `/repos/${owner}/${repo}/pulls/${pullRequestNumber}/comments`,
      token,
      body: {
        body: findingBody,
        commit_id: headSha,
        line: position.line,
        path: position.path,
        side: "RIGHT",
      },
    });
    postedFindingsCount += 1;
  }

  const summaryBody = renderOverallSummaryComment({
    existingFindingsCount: existingFindingComments.length,
    findingsCount: postedFindingsCount,
    headSha,
    incrementalFromSha,
    previousStickyBody,
    review,
    unanchorableFindings,
  });
  await upsertIssueSummaryComment({body: summaryBody, owner, pullRequestNumber, repo, token});
};

/**
 * Appends a short note to the GitHub Actions job summary when available.
 *
 * @param lines - Summary lines to append.
 * @returns Nothing. Safely no-ops when GITHUB_STEP_SUMMARY is unavailable.
 */
export const appendStepSummary = (lines: string[]): void => {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath === undefined || summaryPath === "") {
    return;
  }

  writeFileSync(summaryPath, `${lines.join("\n")}\n`, {flag: "a"});
};

/**
 * Runs the architectural review through the Cursor Agent CLI in headless mode.
 *
 * The Cursor CLI authenticates with the `CURSOR_API_KEY` secret, so the review
 * runs against Cursor's own models instead of OpenAI. Because the CLI returns
 * free-form text rather than schema-constrained output, the prompt embeds the
 * JSON Schema for the expected review and the CLI response is parsed and
 * validated with Zod.
 *
 * @param input - Full review input with repo context, metadata, diff, and plans.
 * @returns Parsed structured review output validated by Zod.
 */
export const runArchitecturalReview = async (input: string): Promise<ArchitecturalReview> => {
  const reviewSchemaJson = JSON.stringify(z.toJSONSchema(ArchitecturalReviewSchema), null, 2);
  const prompt = [
    ARCHITECTURAL_REVIEW_PROMPT,
    "",
    STRUCTURED_OUTPUT_INSTRUCTIONS,
    reviewSchemaJson,
    "",
    input,
  ].join("\n");

  const cliOutput = await runCursorAgentCli(prompt);
  const reviewJson = extractReviewJson(cliOutput);

  let parsedReview: unknown;
  try {
    parsedReview = JSON.parse(reviewJson);
  } catch (error) {
    throw new Error(
      `Failed to parse architectural review JSON from Cursor Agent CLI output: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return ArchitecturalReviewSchema.parse(parsedReview);
};

/**
 * Spawns the Cursor Agent CLI in non-interactive print mode and returns the
 * final assistant text.
 *
 * The prompt is delivered over stdin to avoid command-line length limits on
 * large diffs. The CLI is invoked with `--output-format json`, whose top-level
 * `result` field holds the agent's final answer; the raw stdout is returned as
 * a fallback when the wrapper cannot be parsed. The trust flag is required in
 * GitHub Actions because the runner cannot answer interactive trust prompts.
 *
 * @param prompt - Full prompt to send to the agent over stdin.
 * @returns The agent's final response text.
 */
const runCursorAgentCli = (prompt: string): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const model = process.env.CURSOR_MODEL?.trim() ?? "";
    const cliArguments = [CURSOR_AGENT_TRUST_FLAG, "--print", "--output-format", "json"];
    if (model !== "") {
      cliArguments.push("--model", model);
    }

    const child = spawn(CURSOR_AGENT_BINARY, cliArguments, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      reject(new Error(`Failed to start Cursor Agent CLI (${CURSOR_AGENT_BINARY}): ${error.message}`));
    });
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`Cursor Agent CLI exited with code ${code ?? "unknown"}: ${stderr.trim()}`));
        return;
      }

      resolve(extractCursorAgentResultText(stdout));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
};

/**
 * Extracts the agent's final text from the Cursor Agent CLI JSON envelope.
 *
 * @param stdout - Raw stdout from the CLI invoked with `--output-format json`.
 * @returns The `result` string when present, otherwise the trimmed raw stdout.
 */
const extractCursorAgentResultText = (stdout: string): string => {
  const trimmedStdout = stdout.trim();
  if (trimmedStdout === "") {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmedStdout) as {result?: unknown};
    if (typeof parsed.result === "string") {
      return parsed.result;
    }
  } catch {
    // The CLI did not emit a single JSON envelope; fall back to raw stdout so
    // the JSON extractor below can still recover the embedded review object.
  }

  return trimmedStdout;
};

/**
 * Isolates the JSON review object from arbitrary agent text, tolerating
 * Markdown code fences and surrounding commentary.
 *
 * @param text - Final agent response text that should contain a JSON object.
 * @returns The substring spanning the first `{` through the last `}`.
 */
const extractReviewJson = (text: string): string => {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch?.[1] ?? text;
  const objectStart = candidate.indexOf("{");
  const objectEnd = candidate.lastIndexOf("}");
  if (objectStart === -1 || objectEnd === -1 || objectEnd < objectStart) {
    throw new Error("Cursor Agent CLI output did not contain a JSON object for the architectural review.");
  }

  return candidate.slice(objectStart, objectEnd + 1);
};

/**
 * Assembles prior review comment state used to suppress duplicate findings.
 *
 * @param options - Previously posted comments and review thread metadata.
 * @returns Structured previous review context for the model prompt.
 */
export const buildPreviousReviewContext = ({
  existingFindingComments,
  existingSummaryComment,
  incrementalFromSha,
  reviewThreads,
}: {
  existingFindingComments: GitHubPullRequestReviewComment[];
  existingSummaryComment: GitHubIssueComment | null;
  incrementalFromSha: string | null;
  reviewThreads: PreviousReviewThread[];
}): PreviousReviewContext => {
  return {
    existingFindingFingerprints: collectExistingFindingFingerprints(existingFindingComments),
    incrementalFromSha,
    previousFindingComments: existingFindingComments,
    previousSummaryComment: existingSummaryComment,
    reviewThreads,
  };
};

/**
 * Loads pull request metadata from GitHub Actions event JSON or CircleCI's
 * `CIRCLE_PULL_REQUEST` URL plus the GitHub REST API.
 *
 * @param token - GitHub token used when the CircleCI path must fetch the PR.
 * @returns Event payload consumed by the rest of this script.
 */
export const loadPullRequestEvent = async (token: string): Promise<PullRequestEventPayload> => {
  const eventPath = process.env.GITHUB_EVENT_PATH ?? "";
  if (eventPath !== "") {
    return parsePullRequestEvent(eventPath);
  }

  const circlePullRequestUrl = process.env.CIRCLE_PULL_REQUEST ?? "";
  if (circlePullRequestUrl === "") {
    throw new Error("GITHUB_EVENT_PATH or CIRCLE_PULL_REQUEST is required.");
  }

  const {owner, pullRequestNumber, repo} = parseCirclePullRequestUrl(circlePullRequestUrl);
  const pullRequest = await githubRequestJson<GitHubPullRequestApi>({
    path: `/repos/${owner}/${repo}/pulls/${pullRequestNumber}`,
    token,
  });
  return pullRequestEventFromApi(pullRequest);
};

/**
 * Main workflow entrypoint: fetches PR context, runs the Cursor Agent CLI
 * review, and syncs the sticky PR comment.
 *
 * @returns Promise that resolves when the review comment has been updated.
 */
export const main = async (): Promise<void> => {
  const cursorApiKey = process.env.CURSOR_API_KEY ?? "";
  if (cursorApiKey === "") {
    appendStepSummary([
      "### Architectural review",
      "",
      "Skipped because `CURSOR_API_KEY` is not configured for this repository.",
    ]);
    console.info("Skipping architectural review because CURSOR_API_KEY is not configured.");
    return;
  }

  // The Cursor Agent CLI reads CURSOR_API_KEY from the environment for
  // authentication; it is already present here, so no extra wiring is needed.
  const githubToken = process.env.GITHUB_TOKEN ?? "";
  if (githubToken === "") {
    appendStepSummary([
      "### Architectural review",
      "",
      "Skipped because `GITHUB_TOKEN` is not configured for this runner.",
    ]);
    console.info("Skipping architectural review because GITHUB_TOKEN is not configured.");
    return;
  }

  const event = await loadPullRequestEvent(githubToken);
  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  const pullRequest = event.pull_request;

  if (isBotUser(pullRequest.user.login)) {
    appendStepSummary([
      "### Architectural review",
      "",
      `Skipped for bot user: ${pullRequest.user.login}`,
    ]);
    console.info(`Skipping architectural review for bot user: ${pullRequest.user.login}`);
    return;
  }

  const [existingSummaryComment, existingFindingComments, reviewThreads] = await Promise.all([
    findExistingStickyComment({
      owner,
      pullRequestNumber: pullRequest.number,
      repo,
      token: githubToken,
    }),
    findExistingReviewComments({
      owner,
      pullRequestNumber: pullRequest.number,
      repo,
      token: githubToken,
    }),
    fetchArchitecturalReviewThreads({
      owner,
      pullRequestNumber: pullRequest.number,
      repo,
      token: githubToken,
    }),
  ]);

  const lastReviewedSha = extractLastReviewedSha(existingSummaryComment?.body ?? null);
  const currentHeadSha = pullRequest.head.sha;
  const isIncrementalReview = lastReviewedSha !== null && lastReviewedSha !== currentHeadSha;

  if (lastReviewedSha === currentHeadSha) {
    appendStepSummary([
      "### Architectural review",
      "",
      `Skipped because commit \`${currentHeadSha.slice(0, 7)}\` was already reviewed.`,
    ]);
    console.info(`Skipping architectural review because head SHA ${currentHeadSha} was already reviewed.`);
    return;
  }

  const changedFiles = isIncrementalReview
    ? await comparePullRequestFiles({
        baseSha: lastReviewedSha ?? pullRequest.base.sha,
        headSha: currentHeadSha,
        owner,
        repo,
        token: githubToken,
      })
    : await listPullRequestFiles({
        owner,
        pullRequestNumber: pullRequest.number,
        repo,
        token: githubToken,
      });

  if (isIncrementalReview && changedFiles.length === 0) {
    const noChangesReview: ArchitecturalReview = {
      findings: [],
      overallAssessment: "no_comment",
      planComparison: {
        comparedPlanPaths: [],
        discrepancies: [],
        notes: [],
        status: "not_applicable",
      },
      suggestedRefactors: [],
      summary: "No file changes were detected since the previous architectural review.",
    };

    await postArchitecturalReview({
      changedFiles,
      existingFindingComments,
      headSha: currentHeadSha,
      incrementalFromSha: lastReviewedSha,
      owner,
      previousStickyBody: existingSummaryComment?.body ?? null,
      pullRequestNumber: pullRequest.number,
      repo,
      review: noChangesReview,
      token: githubToken,
    });
    appendStepSummary([
      "### Architectural review",
      "",
      "No file changes since the previous review.",
    ]);
    console.info("Architectural review skipped because there were no incremental file changes.");
    return;
  }

  const implementationPlanPaths = selectImplementationPlanPaths({
    changedFiles,
    prBody: pullRequest.body,
  });

  const planContents = await Promise.all(
    implementationPlanPaths.slice(0, MAX_FETCHED_PLAN_FILES).map(
      async (path): Promise<ImplementationPlanContent> => ({
        content: await fetchRepositoryFileText({
          owner,
          path,
          ref: pullRequest.head.sha,
          repo,
          token: githubToken,
        }),
        path,
      })
    )
  );

  const previousReviewContext = buildPreviousReviewContext({
    existingFindingComments,
    existingSummaryComment,
    incrementalFromSha: lastReviewedSha,
    reviewThreads,
  });

  const reviewInput = buildArchitecturalReviewInput({
    changedAreaSummary: summarizeChangedAreas(changedFiles),
    changedFiles,
    diffContext: buildFileDiffContext(changedFiles),
    incrementalFromSha: lastReviewedSha,
    planContents,
    previousReviewContext,
    pullRequest,
  });

  const review = await runArchitecturalReview(reviewInput);

  if (review.overallAssessment === "no_comment") {
    await postArchitecturalReview({
      changedFiles,
      existingFindingComments,
      headSha: currentHeadSha,
      incrementalFromSha: lastReviewedSha,
      owner,
      previousStickyBody: existingSummaryComment?.body ?? null,
      pullRequestNumber: pullRequest.number,
      repo,
      review: {
        ...review,
        summary:
          lastReviewedSha === null
            ? review.summary
            : review.summary || "No new material architectural concerns identified in the latest changes.",
      },
      token: githubToken,
    });
    appendStepSummary([
      "### Architectural review",
      "",
      lastReviewedSha === null
        ? "No architectural concerns to report."
        : "No new architectural concerns in the latest changes.",
    ]);
    console.info("Architectural review completed with no new concerns to report.");
    return;
  }

  await postArchitecturalReview({
    changedFiles,
    existingFindingComments,
    headSha: currentHeadSha,
    incrementalFromSha: lastReviewedSha,
    owner,
    previousStickyBody: existingSummaryComment?.body ?? null,
    pullRequestNumber: pullRequest.number,
    repo,
    review,
    token: githubToken,
  });

  appendStepSummary([
    "### Architectural review",
    "",
    `- Overall assessment: ${review.overallAssessment}`,
    `- New findings: ${review.findings.length}`,
    `- Compared plans: ${review.planComparison.comparedPlanPaths.length}`,
    lastReviewedSha === null ? "- Scope: full pull request" : `- Scope: incremental since ${lastReviewedSha.slice(0, 7)}`,
  ]);
  console.info(`Architectural review completed with ${review.findings.length} new finding(s).`);
};

/**
 * Issues an authenticated GitHub REST API request and parses the JSON response.
 *
 * @param options - Request path, method, token, and optional JSON body.
 * @returns Parsed JSON response body.
 */
const githubRequestJson = async <T>({
  body,
  method = "GET",
  path,
  token,
}: {
  body?: unknown;
  method?: "DELETE" | "GET" | "PATCH" | "POST";
  path: string;
  token: string;
}): Promise<T> => {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: createGitHubHeaders({token}),
    method,
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`GitHub API request failed for ${path}: ${response.status} ${response.statusText} - ${responseBody}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

/**
 * Issues an authenticated GitHub GraphQL request and parses the JSON response.
 *
 * @param options - GraphQL query, variables, and authentication token.
 * @returns Parsed GraphQL data payload.
 */
const githubGraphqlRequest = async <T>({
  query,
  token,
  variables,
}: {
  query: string;
  token: string;
  variables?: Record<string, unknown>;
}): Promise<T> => {
  const response = await fetch(`${GITHUB_API_BASE_URL}/graphql`, {
    body: JSON.stringify({query, variables}),
    headers: createGitHubHeaders({token}),
    method: "POST",
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText} - ${responseBody}`);
  }

  const payload = (await response.json()) as {data?: T; errors?: Array<{message: string}>};
  if (payload.errors !== undefined && payload.errors.length > 0) {
    throw new Error(`GitHub GraphQL request returned errors: ${payload.errors.map((error) => error.message).join("; ")}`);
  }

  if (payload.data === undefined) {
    throw new Error("GitHub GraphQL request returned no data.");
  }

  return payload.data;
};

/**
 * Builds the standard GitHub REST API headers used by this script.
 *
 * @param options - Authentication token and optional Accept override.
 * @returns Header map for fetch requests.
 */
const createGitHubHeaders = ({accept = "application/vnd.github+json", token}: GitHubRequestOptions): HeadersInit => {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": GITHUB_USER_AGENT,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
};

/**
 * Reads a required environment variable and throws a clear error when missing.
 *
 * @param name - Environment variable name.
 * @returns Non-empty environment variable value.
 */
const getRequiredEnvironmentVariable = (name: string): string => {
  const value = process.env[name] ?? "";
  if (value === "") {
    throw new Error(`${name} is required.`);
  }

  return value;
};

/**
 * Heuristically prioritizes files that usually carry architecture signal for
 * review context when the diff must be truncated.
 *
 * @param filePath - Repository-relative changed file path.
 * @returns True when the file is likely to be relevant for holistic review.
 */
const isHighSignalFile = (filePath: string): boolean => {
  return (
    filePath.endsWith(".ts") ||
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".js") ||
    filePath.endsWith(".mjs") ||
    filePath.endsWith(".cjs") ||
    filePath.endsWith(".yml") ||
    filePath.endsWith(".yaml") ||
    filePath.endsWith(".md") ||
    filePath.startsWith("terraform/") ||
    filePath.startsWith("infra/")
  );
};

/**
 * Truncates large text blocks to keep the model input bounded while preserving
 * a visible marker that context was trimmed.
 *
 * @param text - Source text.
 * @param maxCharacters - Maximum number of characters to keep.
 * @returns Truncated text when needed, otherwise the original text.
 */
const truncateText = (text: string, maxCharacters: number): string => {
  if (text.length <= maxCharacters) {
    return text;
  }

  return `${text.slice(0, maxCharacters)}\n... [truncated]`;
};

/**
 * Formats overall assessment labels for the sticky PR comment.
 *
 * @param overallAssessment - Structured overall assessment from the model.
 * @returns Human-readable assessment label with emphasis.
 */
const formatOverallAssessment = (overallAssessment: ArchitecturalReview["overallAssessment"]): string => {
  if (overallAssessment === "no_comment") {
    return "No comment";
  }

  if (overallAssessment === "clear") {
    return "Clear";
  }

  if (overallAssessment === "watch") {
    return "Needs attention";
  }

  return "Concern";
};

/**
 * Formats the plan comparison status for the sticky comment.
 *
 * @param status - Structured plan comparison status from the model.
 * @returns Human-readable plan status label.
 */
const formatPlanComparisonStatus = (status: ArchitecturalReview["planComparison"]["status"]): string => {
  if (status === "aligned") {
    return "Aligned";
  }

  if (status === "discrepancies_found") {
    return "Discrepancies found";
  }

  return "Not applicable";
};

/**
 * Formats finding severity labels for display.
 *
 * @param severity - Finding severity from the model.
 * @returns Human-readable severity label.
 */
const formatSeverity = (severity: ReviewFinding["severity"]): string => {
  if (severity === "critical") {
    return "Critical";
  }

  if (severity === "high") {
    return "High";
  }

  if (severity === "medium") {
    return "Medium";
  }

  return "Low";
};

const isCliEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
