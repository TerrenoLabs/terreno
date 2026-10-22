import type {ApiRequestArgs} from "@terreno/syncdb/api";
import {type UseApiQueryResult, useApiQuery} from "@terreno/syncdb/react";

/** The parts of `/auth/me` the SPA reads. */
export interface AdminSpaProfile {
  admin?: boolean;
  permissions?: Record<string, readonly string[]>;
  roles?: string[];
}

/** Request for the signed-in user's profile (cookie session, same origin). */
const ADMIN_SPA_PROFILE_REQUEST: ApiRequestArgs = {method: "GET", url: "/auth/me"};

/** Cached `/auth/me` for the current session, shared by every caller. */
export const useAdminSpaProfile = (): UseApiQueryResult<AdminSpaProfile> =>
  useApiQuery<AdminSpaProfile>(ADMIN_SPA_PROFILE_REQUEST, {providesTags: ["profile"]});

/** Operators and superadmins see the organization directory. */
export const isOrganizationOperatorProfile = (profile?: AdminSpaProfile): boolean => {
  const roles = profile?.roles ?? [];
  return roles.includes("operator") || roles.includes("superadmin");
};
