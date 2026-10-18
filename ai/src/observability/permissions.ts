import {
  ADMIN_PAGE_ACTION,
  type AnyTerrenoAccess,
  Permissions,
  terrenoStatements,
} from "@terreno/api";

export type ObservabilityActionFlags = Record<string, boolean>;

export type ObservabilityPermissions = Record<string, ObservabilityActionFlags>;

const OBSERVABILITY_RESOURCE_ACTIONS: Record<string, readonly string[]> = {
  aiDataset: terrenoStatements.aiDataset,
  aiEvaluator: terrenoStatements.aiEvaluator,
  aiExperiment: terrenoStatements.aiExperiment,
  aiPrompt: terrenoStatements.aiPrompt,
  aiReview: terrenoStatements.aiReview,
  aiTrace: terrenoStatements.aiTrace,
};

const allObservabilityPermissionsGranted = (): ObservabilityPermissions => {
  const permissions: ObservabilityPermissions = {};
  for (const [resource, actions] of Object.entries(OBSERVABILITY_RESOURCE_ACTIONS)) {
    permissions[resource] = {};
    for (const action of actions) {
      permissions[resource][action] = true;
    }
  }
  return permissions;
};

const emptyObservabilityPermissions = (): ObservabilityPermissions => {
  const permissions: ObservabilityPermissions = {};
  for (const [resource, actions] of Object.entries(OBSERVABILITY_RESOURCE_ACTIONS)) {
    permissions[resource] = {};
    for (const action of actions) {
      permissions[resource][action] = false;
    }
  }
  return permissions;
};

export const resolveObservabilityPermissions = async ({
  accessControl,
  user,
}: {
  accessControl?: AnyTerrenoAccess;
  user: unknown;
}): Promise<ObservabilityPermissions> => {
  if (!accessControl) {
    return allObservabilityPermissionsGranted();
  }

  if (Permissions.IsAdmin("read", user as Parameters<typeof Permissions.IsAdmin>[1])) {
    return allObservabilityPermissionsGranted();
  }

  const shell = await accessControl.can({
    permissions: {admin: [ADMIN_PAGE_ACTION]},
    user: user as Parameters<AnyTerrenoAccess["can"]>[0]["user"],
  });
  if (!shell.allowed) {
    return emptyObservabilityPermissions();
  }

  const permissions: ObservabilityPermissions = {};
  for (const [resource, actions] of Object.entries(OBSERVABILITY_RESOURCE_ACTIONS)) {
    permissions[resource] = {};
    for (const action of actions) {
      const result = await accessControl.can({
        permissions: {[resource]: [action]},
        user: user as Parameters<AnyTerrenoAccess["can"]>[0]["user"],
      });
      permissions[resource][action] = result.allowed;
    }
  }
  return permissions;
};
