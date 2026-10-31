import {getReleaseChangelogSection} from "../../check-upgrade-docs/lib";

const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/;

// Branch names the release skill pushes; Cursor cloud agents must use a cursor/ prefix.
const RELEASE_BRANCH_PATTERN = /^(?:release\/|cursor\/release-)(\d+\.\d+\.\d+)$/;
const ROADMAP_BRANCH_PATTERN = /^automation\/roadmap-[\w-]+$/;

// A bot-merged pull request may only touch generated or release-note files, so the
// bot can never land code. Anything else falls back to normal human review.
const RELEASE_ALLOWED_PATHS: RegExp[] = [
  /^CHANGELOG\.md$/,
  /^changelog\/unreleased\/[^/]+$/,
  /^example-frontend\/constants\/whatsNew\.generated\.json$/,
  /^mcp-server\/src\/docs\/upgrades\/[^/]+\.md$/,
];
const ROADMAP_ALLOWED_PATHS: RegExp[] = [
  /^ROADMAP\.md$/,
  /^docs\/explanation\/roadmap-seed-issues\.md$/,
];

const BOT_MERGE_KINDS = {
  release: "release",
  roadmap: "roadmap",
} as const;

type BotMergeKind = (typeof BOT_MERGE_KINDS)[keyof typeof BOT_MERGE_KINDS];

export interface BotMergePlan {
  disallowedFiles: string[];
  isEligible: boolean;
  kind?: BotMergeKind;
  reason: string;
  version?: string;
}

// BOT_MERGE_AUTHORS is a comma- or whitespace-separated list of GitHub logins.
const parseAllowedAuthors = (allowedAuthors: string): string[] =>
  allowedAuthors
    .split(/[\s,]+/)
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);

export const planBotMerge = ({
  allowedAuthors,
  author,
  changelog,
  files,
  headRef,
}: {
  allowedAuthors: string;
  author: string;
  changelog?: string;
  files: string[];
  headRef: string;
}): BotMergePlan => {
  // GitHub logins are case-insensitive.
  if (!parseAllowedAuthors(allowedAuthors).includes(author.trim().toLowerCase())) {
    return {
      disallowedFiles: [],
      isEligible: false,
      reason: `${author} is not in BOT_MERGE_AUTHORS`,
    };
  }

  const releaseMatch = headRef.match(RELEASE_BRANCH_PATTERN);
  const isRoadmap = ROADMAP_BRANCH_PATTERN.test(headRef);
  if (!releaseMatch && !isRoadmap) {
    return {
      disallowedFiles: [],
      isEligible: false,
      reason: `${headRef} is not a release or roadmap automation branch`,
    };
  }

  const kind = releaseMatch ? BOT_MERGE_KINDS.release : BOT_MERGE_KINDS.roadmap;
  const allowedPaths = releaseMatch ? RELEASE_ALLOWED_PATHS : ROADMAP_ALLOWED_PATHS;
  const disallowedFiles = files.filter(
    (file) => !allowedPaths.some((pattern) => pattern.test(file))
  );
  if (files.length === 0) {
    return {disallowedFiles, isEligible: false, kind, reason: "pull request has no changed files"};
  }
  if (disallowedFiles.length > 0) {
    return {
      disallowedFiles,
      isEligible: false,
      kind,
      reason: `files outside the ${kind} allowlist need human review`,
    };
  }
  if (!releaseMatch) {
    return {disallowedFiles, isEligible: true, kind, reason: "roadmap-only changes"};
  }

  const version = releaseMatch[1];
  const section = changelog ? getReleaseChangelogSection({changelog, version}) : undefined;
  if (!section?.trim()) {
    return {
      disallowedFiles,
      isEligible: false,
      kind,
      reason: `CHANGELOG.md has no non-empty ## [${version}] section`,
      version,
    };
  }
  return {disallowedFiles, isEligible: true, kind, reason: "release-notes-only changes", version};
};

export interface ReleaseTagCheck {
  failures: string[];
  isValid: boolean;
}

// The tag must point at merged release notes so the published tarballs carry them.
export const checkReleaseTag = ({
  changelog,
  isOnMaster,
  unreleasedFragmentCount,
  version,
}: {
  changelog: string;
  isOnMaster: boolean;
  unreleasedFragmentCount: number;
  version: string;
}): ReleaseTagCheck => {
  if (!VERSION_PATTERN.test(version)) {
    return {failures: [`${version} is not a semver tag`], isValid: false};
  }

  // Prereleases test the publish pipeline from any branch and do not assemble the changelog.
  if (!STABLE_VERSION_PATTERN.test(version)) {
    return {failures: [], isValid: true};
  }

  const failures: string[] = [];
  if (!isOnMaster) {
    failures.push(`tag ${version} is not on master; merge the release notes pull request first`);
  }
  if (!getReleaseChangelogSection({changelog, version})?.trim()) {
    failures.push(`CHANGELOG.md has no non-empty ## [${version}] section`);
  }
  if (unreleasedFragmentCount > 0) {
    failures.push(
      `${unreleasedFragmentCount} changelog/unreleased fragment(s) were not assembled into ${version}`
    );
  }
  return {failures, isValid: failures.length === 0};
};

export const renderReleaseNotes = ({
  changelog,
  previousVersion,
  repository,
  version,
}: {
  changelog: string;
  previousVersion?: string;
  repository: string;
  version: string;
}): string => {
  const section = getReleaseChangelogSection({changelog, version})?.trim();
  if (!section) {
    throw new Error(`CHANGELOG.md has no ## [${version}] section`);
  }
  const compare = previousVersion
    ? `\n\n**Full Changelog**: https://github.com/${repository}/compare/${previousVersion}...${version}`
    : "";
  return `${section}${compare}\n`;
};
