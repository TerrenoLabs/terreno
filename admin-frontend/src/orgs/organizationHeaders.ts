/** `X-Organization-Id` request header for organization-scoped admin and OrgsApp routes. */
export const adminOrganizationHeaders = (
  organizationId: string | undefined
): Record<string, string> | undefined => {
  if (!organizationId) {
    return undefined;
  }
  return {"X-Organization-Id": organizationId};
};
