const MODEL_CRUD = ["create", "list", "read", "update", "delete"] as const;
export const ADMIN_MODEL_ACCESS = ["read", "write", "writeOwned"] as const;

export const AI_PROMPT_ACTIONS = [
  "list",
  "read",
  "create",
  "update",
  "promote",
  "playground",
] as const;
export const AI_TRACE_ACTIONS = ["list", "read"] as const;
export const AI_REVIEW_ACTIONS = ["list", "read", "score", "assign"] as const;
export const AI_EXPERIMENT_ACTIONS = ["list", "read", "create", "promote"] as const;

export const OBSERVABILITY_RBAC_RESOURCES = [
  "aiPrompt",
  "aiTrace",
  "aiReview",
  "aiDataset",
  "aiExperiment",
  "aiEvaluator",
] as const;

export type ObservabilityRbacResource = (typeof OBSERVABILITY_RBAC_RESOURCES)[number];

/** Resource/action that opens the admin panel. Other admin permissions do not grant entry. */
export const ADMIN_PAGE_RESOURCE = "admin" as const;
export const ADMIN_PAGE_ACTION = "access" as const;
export const ADMIN_PAGE_PERMISSION = {
  [ADMIN_PAGE_RESOURCE]: [ADMIN_PAGE_ACTION],
} as const;

export const ORGANIZATION_ACTIONS = [
  "create",
  "list",
  "read",
  "update",
  "delete",
  "manageMembers",
  "disable",
] as const;

export const terrenoStatements = {
  admin: [ADMIN_PAGE_ACTION, "jobs", "runScripts", "viewBackgroundTasks"],
  adminAnnouncement: ADMIN_MODEL_ACCESS,
  adminAnnouncementAcknowledgement: ADMIN_MODEL_ACCESS,
  adminAnnouncementClickEvent: ADMIN_MODEL_ACCESS,
  adminAnnouncementImpression: ADMIN_MODEL_ACCESS,
  adminConsentForm: ADMIN_MODEL_ACCESS,
  adminConsentResponse: ADMIN_MODEL_ACCESS,
  adminFeatureFlag: ADMIN_MODEL_ACCESS,
  aiDataset: MODEL_CRUD,
  aiEvaluator: MODEL_CRUD,
  aiExperiment: AI_EXPERIMENT_ACTIONS,
  aiPrompt: AI_PROMPT_ACTIONS,
  aiReview: AI_REVIEW_ACTIONS,
  aiTrace: AI_TRACE_ACTIONS,
  announcement: MODEL_CRUD,
  announcementAcknowledgement: ["list", "read"],
  announcementImpression: ["list", "read"],
  configuration: ["read", "update"],
  consentForm: MODEL_CRUD,
  consentResponse: ["list", "read"],
  featureFlag: MODEL_CRUD,
  organization: ORGANIZATION_ACTIONS,
  rbac: ["read", "manageRoles", "assignRoles"],
  user: ["create", "list", "read", "update", "delete", "impersonate", "setPassword"],
} as const;

export type Statements = Record<string, readonly string[]>;

export type PermissionSet = {[resource: string]: readonly string[]};

export const READ_ACTIONS = ["read", "list", "view"] as const;

export const READ_ONLY_ROLE_PERMISSIONS = {readOnly: true} as const;

export type RolePermissionSpec = PermissionSet | "*" | typeof READ_ONLY_ROLE_PERMISSIONS;

const isReadOnlySentinel = (spec: RolePermissionSpec): spec is typeof READ_ONLY_ROLE_PERMISSIONS =>
  typeof spec === "object" &&
  spec !== null &&
  !Array.isArray(spec) &&
  Object.keys(spec).length === 1 &&
  (spec as {readOnly?: unknown}).readOnly === true;

export const mergeStatements = <S extends Statements>(appStatements: S): Statements & S => {
  return {
    ...terrenoStatements,
    ...appStatements,
  };
};

export const terrenoStatementDescriptions: Record<string, Record<string, string>> = {
  aiDataset: {
    create: "Create datasets",
    delete: "Delete datasets",
    list: "List datasets",
    read: "View dataset detail and items",
    update: "Update datasets and items",
  },
  aiEvaluator: {
    create: "Create evaluators",
    delete: "Delete evaluators",
    list: "List evaluators and templates",
    read: "View evaluator detail",
    update: "Update evaluators",
  },
  aiExperiment: {
    create: "Start experiments and run estimates",
    list: "List experiments",
    promote: "Promote a passing prompt version to production",
    read: "View experiment results",
  },
  aiPrompt: {
    create: "Create prompts",
    list: "List prompts",
    playground: "Run the prompt playground",
    promote: "Move production or staging labels",
    read: "View prompt detail and versions",
    update: "Create new prompt versions",
  },
  aiReview: {
    assign: "Assign review items and enqueue traces for review",
    list: "List the review queue",
    read: "Open review items",
    score: "Submit or skip review scores",
  },
  aiTrace: {
    list: "List traces and observability status",
    read: "View trace detail and run trace test helpers",
  },
};

/** Add missing actions for selected resources without removing consumer-defined grants. */
export const mergeMissingResourcePermissions = (
  existing: PermissionSet,
  defaults: PermissionSet,
  resources: readonly string[]
): PermissionSet => {
  const merged: PermissionSet = {...existing};
  for (const resource of resources) {
    const defaultActions = defaults[resource];
    if (!defaultActions || defaultActions.length === 0) {
      continue;
    }
    const current = new Set(merged[resource] ?? []);
    for (const action of defaultActions) {
      current.add(action);
    }
    merged[resource] = [...current];
  }
  return merged;
};

export const expandRolePermissions = (
  spec: RolePermissionSpec,
  statements: Statements,
  readActions: readonly string[]
): PermissionSet => {
  if (spec === "*") {
    const expanded: PermissionSet = {};
    for (const [resource, actions] of Object.entries(statements)) {
      expanded[resource] = [...actions];
    }
    return expanded;
  }

  if (isReadOnlySentinel(spec)) {
    const expanded: PermissionSet = {};
    for (const [resource, actions] of Object.entries(statements)) {
      const readish = actions.filter((action) => readActions.includes(action));
      if (readish.length > 0) {
        expanded[resource] = readish;
      }
    }
    return expanded;
  }

  return spec;
};
