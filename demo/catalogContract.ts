export interface DemoControlDefault {
  defaultValue?: unknown;
  type?: string;
}

export interface DemoInteractionStep {
  action: "press" | "type" | "expectText" | "expectRole";
  name?: string;
  role?: string;
  targetTestID?: string;
  value?: string;
}

const normalizeName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

export const controlDefault = (control: DemoControlDefault): unknown => {
  if (control.defaultValue !== undefined) {
    return control.defaultValue;
  }
  if (control.type === "boolean") {
    return false;
  }
  if (control.type === "number") {
    return 0;
  }
  return "";
};

export const unresolvedRelated = (related: string[], names: string[]): string[] => {
  const known = new Set(names.map(normalizeName));
  return related.filter((name) => !known.has(normalizeName(name)));
};

export const storiesForDemo = <T extends {showInDemo?: boolean}>(
  stories: Record<string, T>
): Record<string, T> => {
  const visible: Record<string, T> = {};
  for (const [name, story] of Object.entries(stories)) {
    if (story.showInDemo === false) {
      continue;
    }
    visible[name] = story;
  }
  return visible;
};

export const catalogIssues = (
  configs: {
    name: string;
    related: string[];
    stories: Record<string, {excludeReason?: string; stability?: string}>;
  }[]
): string[] => {
  const names = configs.map((config) => config.name);
  const issues: string[] = [];
  for (const config of configs) {
    for (const missing of unresolvedRelated(config.related, names)) {
      issues.push(`${config.name} related "${missing}" does not match a component`);
    }
    for (const [storyName, story] of Object.entries(config.stories)) {
      if (story.stability === "exclude" && !story.excludeReason?.trim()) {
        issues.push(`${config.name} / ${storyName} is excluded without a reason`);
      }
    }
  }
  return issues;
};

export const relatedDemoHref = (name: string): string => {
  return `/demo/${encodeURIComponent(name)}`;
};
