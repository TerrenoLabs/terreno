import {createSessionApi} from "@terreno/rtk";

/**
 * Base RTK Query API for the admin SPA's own session queries (`/auth/me`). Admin
 * screens from `@terreno/admin-frontend` do not use RTK: they call the backend through
 * the cookie-bound fetch client that `AdminProvider` creates.
 *
 * Uses the cookie-session API (NOT `emptySplitApi`): the SPA authenticates with the
 * better-auth session cookie on the same origin, and `emptySplitApi`'s JWT base query
 * would dispatch a global logout (killing the better-auth session) whenever no bearer
 * token is found in storage.
 */
export const openapi = createSessionApi().enhanceEndpoints({
  addTagTypes: ["profile"],
});

interface AdminSpaProfile {
  admin?: boolean;
  permissions?: Record<string, readonly string[]>;
  roles?: string[];
}

const profileApi = openapi.injectEndpoints({
  endpoints: (build) => ({
    getAdminSpaProfile: build.query<AdminSpaProfile, void>({
      providesTags: ["profile"],
      query: () => ({method: "GET", url: "/auth/me"}),
    }),
  }),
});

export const {useGetAdminSpaProfileQuery} = profileApi;
