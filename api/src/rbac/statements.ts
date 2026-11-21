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
  consentResponse: ["list", "read", "signOnBehalf"],
  featureFlag: MODEL_CRUD,
  organization: ORGANIZATION_ACTIONS,
  rbac: ["read", "manageRoles", "assignRoles"],
  user: [
    "create",
    "list",
    "read",
    "update",
    "delete",
    "impersonate",
    "setPassword",
    "updateIdentity",
    "manageSecurity",
    "issueSignInLink",
  ],
} as const;

export type Statements = Record<string, readonly string[]>;

export type PermissionSet = {[resource: string]: readonly string[]};

/** Optional human labels for permissions, keyed by resource then action. */
export type StatementDescriptions = Record<string, Record<string, string>>;

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

export const adminModelDescriptions = (noun: string): Record<string, string> => ({
  read: `View ${noun} in the admin panel`,
  write: `Create and update any ${noun} in the admin panel`,
  writeOwned: `Create and update ${noun} you own in the admin panel`,
});

export const modelCrudDescriptions = (noun: string): Record<string, string> => ({
  create: `Create ${noun}`,
  delete: `Delete ${noun}`,
  list: `List ${noun}`,
  read: `View ${noun}`,
  update: `Update ${noun}`,
});

export const terrenoStatementDescriptions: StatementDescriptions = {
  admin: {
    access: "Open the admin panel",
    jobs: "Open the jobs admin screen",
    runScripts: "Run admin scripts",
    viewBackgroundTasks: "View background tasks",
  },
  adminAnnouncement: adminModelDescriptions("announcements"),
  adminAnnouncementAcknowledgement: adminModelDescriptions("announcement acknowledgements"),
  adminAnnouncementClickEvent: adminModelDescriptions("announcement click events"),
  adminAnnouncementImpression: adminModelDescriptions("announcement impressions"),
  adminConsentForm: adminModelDescriptions("consent forms"),
  adminConsentResponse: adminModelDescriptions("consent responses"),
  adminFeatureFlag: adminModelDescriptions("feature flags"),
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
  announcement: modelCrudDescriptions("announcements"),
  announcementAcknowledgement: {
    list: "List announcement acknowledgements",
    read: "View announcement acknowledgements",
  },
  announcementImpression: {
    list: "List announcement impressions",
    read: "View announcement impressions",
  },
  configuration: {
    read: "View configuration",
    update: "Update configuration",
  },
  consentForm: modelCrudDescriptions("consent forms"),
  consentResponse: {
    list: "List consent responses",
    read: "View consent responses",
    signOnBehalf: "Record, view, and void provisional consent signatures for other users",
  },
  featureFlag: modelCrudDescriptions("feature flags"),
  organization: {
    create: "Create organizations",
    delete: "Delete organizations",
    disable: "Disable an organization",
    list: "List organizations",
    manageMembers: "Add, update, and remove organization members",
    read: "View an organization",
    update: "Update an organization",
  },
  rbac: {
    assignRoles: "Assign roles to users",
    manageRoles: "Create and edit roles",
    read: "View roles and the permission vocabulary",
  },
  user: {
    ...modelCrudDescriptions("users"),
    impersonate: "Sign in as another user",
    issueSignInLink:
      "Create a sign-in account for a legacy user and hand them a set-password link (AccountSecurityApp)",
    manageSecurity: "View any user's sign-in methods and run account recovery (AccountSecurityApp)",
    setPassword: "Set another user's password",
    updateIdentity:
      "Change another user's email, disabled flag, email verification, or linked Better Auth and GitHub ids",
  },
};

const copyStatementDescriptions = (
  target: StatementDescriptions,
  source: StatementDescriptions | undefined
): void => {
  for (const [resource, actions] of Object.entries(source ?? {})) {
    const next: Record<string, string> = {...(target[resource] ?? {})};
    for (const [action, description] of Object.entries(actions ?? {})) {
      if (typeof description !== "string") {
        continue;
      }
      const trimmed = description.trim();
      if (trimmed.length === 0) {
        continue;
      }
      next[action] = trimmed;
    }
    if (Object.keys(next).length > 0) {
      target[resource] = next;
    }
  }
};

/**
 * Framework labels, then the app's. An app label replaces the framework label for that
 * action. A blank string is ignored, so it does not erase a framework label.
 */
export const mergeStatementDescriptions = (
  appDescriptions?: StatementDescriptions
): StatementDescriptions => {
  const merged: StatementDescriptions = {};
  copyStatementDescriptions(merged, terrenoStatementDescriptions);
  copyStatementDescriptions(merged, appDescriptions);
  return merged;
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
