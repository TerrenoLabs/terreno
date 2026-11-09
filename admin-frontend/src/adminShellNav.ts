import type {AdminCustomScreen, AdminModelConfig} from "./types";

export interface AdminModelGroup {
  group: string;
  models: AdminModelConfig[];
}

export interface AdminSidebarGroup {
  customScreens: AdminCustomScreen[];
  group: string;
  models: AdminModelConfig[];
}

const sortSidebarGroupKeys = (keys: string[]): string[] => {
  return [...keys].sort((a, b) => {
    if (a === "General") {
      return 1;
    }
    if (b === "General") {
      return -1;
    }
    return a.localeCompare(b);
  });
};

/**
 * Groups admin models by {@link AdminModelConfig.group} for sidebar navigation.
 * Models without a group go under "General", which is sorted last.
 */
export const groupAdminModelsByGroup = (models: AdminModelConfig[]): AdminModelGroup[] => {
  if (!Array.isArray(models)) {
    return [];
  }
  const map = new Map<string, AdminModelConfig[]>();
  for (const model of models) {
    const group = model.group?.trim() || "General";
    const list = map.get(group);
    if (list) {
      list.push(model);
    } else {
      map.set(group, [model]);
    }
  }
  const keys = sortSidebarGroupKeys([...map.keys()]);
  return keys.map((group) => ({group, models: map.get(group) ?? []}));
};

/**
 * Merges grouped custom screens into model sidebar groups (screens first), leaving
 * ungrouped screens for the separate Screens section.
 */
export const buildAdminSidebarGroups = ({
  customScreens,
  models,
}: {
  customScreens: AdminCustomScreen[];
  models: AdminModelConfig[];
}): {groups: AdminSidebarGroup[]; ungroupedScreens: AdminCustomScreen[]} => {
  const modelGroups = groupAdminModelsByGroup(models);
  const groupedScreens = customScreens.filter((screen) => Boolean(screen.group?.trim()));
  const ungroupedScreens = customScreens.filter((screen) => !screen.group?.trim());

  const groupNames = new Set<string>();
  for (const {group} of modelGroups) {
    groupNames.add(group);
  }
  for (const screen of groupedScreens) {
    groupNames.add(screen.group?.trim() ?? "General");
  }

  const groups = sortSidebarGroupKeys([...groupNames]).map((group) => ({
    customScreens: groupedScreens.filter((screen) => (screen.group?.trim() || "General") === group),
    group,
    models: modelGroups.find((entry) => entry.group === group)?.models ?? [],
  }));

  return {groups, ungroupedScreens};
};

export const adminScreenGroupTestId = (group: string): string => {
  return `admin-shell-nav-group-${group.trim().toLowerCase().replace(/\s+/g, "-")}`;
};
