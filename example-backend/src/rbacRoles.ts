import type {RoleDefinition} from "@terreno/api";
import {terrenoStatements} from "@terreno/api";

/**
 * Baseline role every signed-up user receives. Terreno's shipped `member` role grants
 * nothing, so apps that gate resources through `access` define their own baseline.
 */
export const DEFAULT_USER_ROLE = "todoUser";

/** Role used by the seed scripts and admin UI demo for elevated todo access. */
const MANAGER_ROLE = "manager";

/** Role granting the admin shell and RBAC management screens. */
export const SUPERADMIN_ROLE = "superadmin";

/** Example read-only AI observability role (admin shell + list/read on every observability resource). */
export const AI_OBSERVABILITY_VIEWER_ROLE = "aiObservabilityViewer";

/** Example full AI observability operator role (admin shell + every approved observability action). */
export const AI_OBSERVABILITY_OPERATOR_ROLE = "aiObservabilityOperator";

export const observabilityReadOnlyPermissions = {
  admin: ["access"],
  aiDataset: ["list", "read"],
  aiEvaluator: ["list", "read"],
  aiExperiment: ["list", "read"],
  aiPrompt: ["list", "read"],
  aiReview: ["list", "read"],
  aiTrace: ["list", "read"],
};

export const observabilityOperatorPermissions = {
  admin: ["access"],
  aiDataset: [...terrenoStatements.aiDataset],
  aiEvaluator: [...terrenoStatements.aiEvaluator],
  aiExperiment: [...terrenoStatements.aiExperiment],
  aiPrompt: [...terrenoStatements.aiPrompt],
  aiReview: [...terrenoStatements.aiReview],
  aiTrace: [...terrenoStatements.aiTrace],
};

export const appDefaultRoles: RoleDefinition[] = [
  {
    description: "Baseline role for signed-up users: full CRUD on their own todos",
    displayName: "Todo User",
    name: DEFAULT_USER_ROLE,
    permissions: {
      todo: ["create", "read", "update", "delete", "list"],
    },
  },
  {
    description: "Can manage todos across the workspace but cannot delete them",
    displayName: "Manager",
    name: MANAGER_ROLE,
    permissions: {
      todo: ["create", "read", "update", "list"],
    },
  },
  {
    description:
      "Opens the admin shell and lists or reads prompts, traces, review, datasets, evaluators, and experiments",
    displayName: "AI Observability Viewer",
    name: AI_OBSERVABILITY_VIEWER_ROLE,
    permissions: observabilityReadOnlyPermissions,
  },
  {
    description:
      "Opens the admin shell and can run the full AI observability control plane (prompts through experiments)",
    displayName: "AI Observability Operator",
    name: AI_OBSERVABILITY_OPERATOR_ROLE,
    permissions: observabilityOperatorPermissions,
  },
];
