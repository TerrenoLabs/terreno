export interface RoadmapItem {
  area: string;
  impact: string;
  ipSlug: string | null;
  status: string;
  target: string;
  title: string;
  url: string;
}

/**
 * Render order for `## Target:` sections. Must stay deep-equal to the `target`
 * list in `.github/roadmap-fields.yml` (asserted in checkRoadmapItem.test.ts).
 * `Released` sits last so shipped history renders below upcoming work.
 */
export const TARGET_ORDER = ["57.3", "58", "Next", "Future", "Released"] as const;

export const AREA_ORDER = [
  "api",
  "ui",
  "syncdb",
  "auth",
  "admin",
  "ai",
  "mcp",
  "docs",
  "deploy",
  "examples",
  "dx",
] as const;

const DECLINED_STATUS = "Declined";

/**
 * Roadmap issues are marked with the `roadmap` label, not a title prefix. Older
 * issues were titled `[Roadmap] <thing>`, so that legacy prefix is stripped
 * here — both for rendering and for matching a board issue to a seed entry.
 */
export const displayTitle = (title: string): string => {
  return title.replace(/^\s*\[Roadmap\]\s*/, "").trim() || title.trim();
};

const compareByArea = (left: RoadmapItem, right: RoadmapItem): number => {
  const leftIndex = AREA_ORDER.indexOf(left.area as (typeof AREA_ORDER)[number]);
  const rightIndex = AREA_ORDER.indexOf(right.area as (typeof AREA_ORDER)[number]);
  const normalizedLeft = leftIndex === -1 ? AREA_ORDER.length : leftIndex;
  const normalizedRight = rightIndex === -1 ? AREA_ORDER.length : rightIndex;
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft - normalizedRight;
  }

  return left.title.localeCompare(right.title);
};

const compareByTarget = (left: RoadmapItem, right: RoadmapItem): number => {
  const leftIndex = TARGET_ORDER.indexOf(left.target as (typeof TARGET_ORDER)[number]);
  const rightIndex = TARGET_ORDER.indexOf(right.target as (typeof TARGET_ORDER)[number]);
  const normalizedLeft = leftIndex === -1 ? TARGET_ORDER.length : leftIndex;
  const normalizedRight = rightIndex === -1 ? TARGET_ORDER.length : rightIndex;
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft - normalizedRight;
  }

  return compareByArea(left, right);
};

export const filterRoadmapItems = (items: RoadmapItem[]): RoadmapItem[] => {
  return items.filter((item) => item.status !== DECLINED_STATUS).sort(compareByTarget);
};

const groupItemsByTarget = (items: RoadmapItem[]): Map<string, RoadmapItem[]> => {
  const grouped = new Map<string, RoadmapItem[]>();

  for (const item of filterRoadmapItems(items)) {
    const bucket = grouped.get(item.target) ?? [];
    bucket.push(item);
    grouped.set(item.target, bucket);
  }

  for (const [target, bucket] of grouped) {
    grouped.set(target, [...bucket].sort(compareByArea));
  }

  return grouped;
};

export const renderRoadmapMarkdown = ({
  generatedAtIso,
  items,
  projectUrl,
  taskSlugs = new Set<string>(),
}: {
  generatedAtIso: string;
  items: RoadmapItem[];
  projectUrl: string;
  /** IP slugs that have a `docs/tasks/<slug>.md` list, so the entry can link it. */
  taskSlugs?: Set<string>;
}): string => {
  const lines: string[] = [
    "# Terreno roadmap",
    "",
    `> **Generated** from the [Terreno Roadmap](${projectUrl}) GitHub Project. The board is the source of`,
    "> truth; this file is refreshed by CI. **Target** versions are directional — no calendar",
    `> dates are promised. Last updated: ${generatedAtIso}.`,
    "",
    "Discuss priorities in [GitHub Discussions](https://github.com/TerrenoLabs/terreno/discussions).",
    "See [roadmap process](docs/explanation/roadmap-process.md) for how work is triaged.",
    "",
  ];

  const grouped = groupItemsByTarget(items);
  const targetKeys = [
    ...TARGET_ORDER.filter((target) => grouped.has(target)),
    ...[...grouped.keys()]
      .filter((target) => !TARGET_ORDER.includes(target as (typeof TARGET_ORDER)[number]))
      .sort(),
  ];

  if (targetKeys.length === 0) {
    lines.push("_No roadmap items on the project board yet._", "");
    return lines.join("\n");
  }

  for (const target of targetKeys) {
    const bucket = grouped.get(target) ?? [];
    lines.push(`## Target: ${target}`, "");

    const byArea = new Map<string, RoadmapItem[]>();
    for (const item of bucket) {
      const areaBucket = byArea.get(item.area) ?? [];
      areaBucket.push(item);
      byArea.set(item.area, areaBucket);
    }

    const areaKeys = [
      ...AREA_ORDER.filter((area) => byArea.has(area)),
      ...[...byArea.keys()]
        .filter((area) => !AREA_ORDER.includes(area as (typeof AREA_ORDER)[number]))
        .sort(),
    ];

    for (const area of areaKeys) {
      lines.push(`### ${area}`, "");
      for (const item of byArea.get(area) ?? []) {
        const ipLink =
          item.ipSlug === null || item.ipSlug === ""
            ? ""
            : ` — IP: [${item.ipSlug}](docs/implementationPlans/${item.ipSlug}.md)`;
        const tasksLink =
          item.ipSlug !== null && taskSlugs.has(item.ipSlug)
            ? ` · Tasks: [${item.ipSlug}](docs/tasks/${item.ipSlug}.md)`
            : "";
        lines.push(
          `- [${displayTitle(item.title)}](${item.url}) (${item.impact}, ${item.status})${ipLink}${tasksLink}`
        );
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
};
