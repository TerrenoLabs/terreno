const RELEASE_HEADING_PATTERN = /^## \[([^\]]+)\](?:\s+-\s+.*)?$/gm;
const UPGRADE_NOTE_SECTION_PATTERN =
  /^###\s+(Breaking(?:\s+changes?)?|Deprecated|Removed|Changed)\s*$/gim;

export interface UpgradeDocumentationCheck {
  isValid: boolean;
  message: string;
  requiresUpgradeNote: boolean;
  triggeringSections: string[];
}

interface CheckUpgradeDocumentationOptions {
  changelog: string;
  hasUpgradeNote: boolean;
  version: string;
}

export const getReleaseChangelogSection = ({
  changelog,
  version,
}: {
  changelog: string;
  version: string;
}): string | undefined => {
  const headings = [...changelog.matchAll(RELEASE_HEADING_PATTERN)];
  const releaseHeadingIndex = headings.findIndex((match) => match[1] === version);

  if (releaseHeadingIndex === -1) {
    return undefined;
  }

  const releaseHeading = headings[releaseHeadingIndex];
  const nextHeading = headings[releaseHeadingIndex + 1];
  const sectionStart = (releaseHeading.index ?? 0) + releaseHeading[0].length;
  const sectionEnd = nextHeading?.index ?? changelog.length;

  return changelog.slice(sectionStart, sectionEnd);
};

const getUpgradeNoteTriggeringSections = (releaseSection: string): string[] => {
  return [...releaseSection.matchAll(UPGRADE_NOTE_SECTION_PATTERN)].map((match) =>
    match[1].toLowerCase()
  );
};

export const checkUpgradeDocumentation = ({
  changelog,
  hasUpgradeNote,
  version,
}: CheckUpgradeDocumentationOptions): UpgradeDocumentationCheck => {
  const releaseSection = getReleaseChangelogSection({changelog, version});

  if (releaseSection === undefined) {
    return {
      isValid: false,
      message: `CHANGELOG.md has no release section for ${version}`,
      requiresUpgradeNote: false,
      triggeringSections: [],
    };
  }

  const triggeringSections = getUpgradeNoteTriggeringSections(releaseSection);
  const requiresUpgradeNote = triggeringSections.length > 0;

  if (!requiresUpgradeNote) {
    return {
      isValid: true,
      message: `${version} has no changelog sections that require an upgrade note`,
      requiresUpgradeNote,
      triggeringSections,
    };
  }

  if (!hasUpgradeNote) {
    return {
      isValid: false,
      message: `${version} requires mcp-server/src/docs/upgrades/${version}.md because its changelog contains: ${triggeringSections.join(", ")}`,
      requiresUpgradeNote,
      triggeringSections,
    };
  }

  return {
    isValid: true,
    message: `${version} includes its required upgrade note`,
    requiresUpgradeNote,
    triggeringSections,
  };
};
