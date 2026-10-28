import type {AdminCustomScreen} from "@terreno/api";

export const AI_HARNESS_GROUP = "AI Harness";

/** Admin custom screen name of the approvals inbox (`@terreno/admin-frontend` widget key). */
export const HARNESS_APPROVALS_SCREEN = "harness-approvals";

/** Custom admin screens `HarnessApp` contributes to `AdminApp`'s sidebar. */
export const harnessAdminScreens = (): AdminCustomScreen[] => [
  {displayName: "Approvals", group: AI_HARNESS_GROUP, name: HARNESS_APPROVALS_SCREEN},
];
