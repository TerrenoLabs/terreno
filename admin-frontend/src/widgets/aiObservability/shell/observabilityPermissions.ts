import type {ObservabilityStatusPayload} from "./aiObservabilityNav";

export interface PromptActionPermissions {
  canCreate: boolean;
  canPlayground: boolean;
  canPromote: boolean;
  canUpdate: boolean;
}

const NO_PROMPT_WRITE_PERMISSIONS: PromptActionPermissions = {
  canCreate: false,
  canPlayground: false,
  canPromote: false,
  canUpdate: false,
};

export interface ResolvePromptActionPermissionsInput {
  status?: ObservabilityStatusPayload;
  statusError?: boolean;
  statusLoading?: boolean;
}

export const resolvePromptActionPermissions = ({
  status,
  statusError = false,
  statusLoading = false,
}: ResolvePromptActionPermissionsInput): PromptActionPermissions => {
  if (statusLoading || statusError || !status) {
    return NO_PROMPT_WRITE_PERMISSIONS;
  }

  const permissions = status.permissions;
  if (!permissions) {
    return NO_PROMPT_WRITE_PERMISSIONS;
  }

  return {
    canCreate: permissions.aiPrompt?.create === true,
    canPlayground: permissions.aiPrompt?.playground === true,
    canPromote: permissions.aiPrompt?.promote === true,
    canUpdate: permissions.aiPrompt?.update === true,
  };
};

export const promptActionPermissionsFromStatus = (
  status?: ObservabilityStatusPayload
): PromptActionPermissions => {
  return resolvePromptActionPermissions({status});
};
