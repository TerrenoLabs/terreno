export interface E2EUser {
  email: string;
  name: string;
  password: string;
  /**
   * Base32 TOTP secret for a user with two-factor on. `loginAs` answers the challenge with the
   * current code from it.
   */
  totpSecret?: string;
}

export const TEST_USER: E2EUser = {
  email: "e2e-test@terreno.dev",
  name: "E2E Test User",
  password: "TestPassword123!",
};

export const ADMIN_USER: E2EUser = {
  email: "e2e-admin@terreno.dev",
  name: "E2E Admin User",
  password: "AdminPassword123!",
};

/**
 * Second non-admin user used by realtime tests to verify owner-strategy isolation —
 * realtime events for one user's documents must not reach another user's socket.
 * Also used by the syncdb user-switch scenario (AC-7).
 */
export const SECOND_USER: E2EUser = {
  email: "e2e-second@terreno.dev",
  name: "E2E Second User",
  password: "SecondPassword123!",
};

/**
 * Per-suite users so spec files that mutate a user's todos can run in parallel
 * against the same backend without stomping each other's data. Every spec file
 * that clears/creates todos must own one of these (TEST_USER stays reserved for
 * todos.spec.ts and the non-todo suites: login, profile, ai-chat, consents).
 */
const suiteUser = (slug: string, name: string): E2EUser => ({
  email: `e2e-${slug}@terreno.dev`,
  name,
  password: "SuitePassword123!",
});

export const REALTIME_USER = suiteUser("realtime", "E2E Realtime User");
export const OFFLINE_SYNC_USER = suiteUser("offline-sync", "E2E Offline Sync User");
export const OFFLINE_MUTATIONS_USER = suiteUser("offline-mutations", "E2E Offline Mutations User");
export const OFFLINE_CONFLICTS_USER = suiteUser("offline-conflicts", "E2E Offline Conflicts User");
export const OFFLINE_UI_USER = suiteUser("offline-ui", "E2E Offline UI User");
export const SYNCDB_LOAD_USER = suiteUser("syncdb-load", "E2E SyncDB Load User");
export const SYNCDB_OFFLINE_USER = suiteUser("syncdb-offline", "E2E SyncDB Offline User");
export const SYNCDB_CONFLICTS_USER = suiteUser("syncdb-conflicts", "E2E SyncDB Conflicts User");
export const SYNCDB_STORAGE_USER = suiteUser("syncdb-storage", "E2E SyncDB Storage User");
export const SYNCDB_CHAOS_USER = suiteUser("syncdb-chaos", "E2E SyncDB Chaos User");
/**
 * Admin-capable suite user for the SyncDB Load Lab e2e (Phase F4): the admin-guarded
 * `/todos/loadtest*` collectionActions require `user.admin === true`, so this user is promoted
 * to admin in auth.setup.ts alongside ADMIN_USER.
 */
export const SYNCDB_LOADLAB_USER = suiteUser("syncdb-loadlab", "E2E SyncDB LoadLab User");

/** The member staff sign consent for in provisionalConsent.spec.ts. */
export const PROVISIONAL_MEMBER_USER = suiteUser("provisional-member", "E2E Provisional Member");
/** Non-admin staff granted consentResponse:signOnBehalf through an RBAC role. */
export const PROVISIONAL_STAFF_USER = suiteUser("provisional-staff", "E2E Provisional Staff");
/** Non-admin user without the role; the signer screen must refuse them. */
export const PROVISIONAL_OUTSIDER_USER = suiteUser(
  "provisional-outsider",
  "E2E Provisional Outsider"
);

/** Every user auth.setup.ts must create (ADMIN_USER is additionally promoted). */
export const ALL_E2E_USERS: E2EUser[] = [
  TEST_USER,
  ADMIN_USER,
  SECOND_USER,
  REALTIME_USER,
  OFFLINE_SYNC_USER,
  OFFLINE_MUTATIONS_USER,
  OFFLINE_CONFLICTS_USER,
  OFFLINE_UI_USER,
  SYNCDB_LOAD_USER,
  SYNCDB_OFFLINE_USER,
  SYNCDB_CONFLICTS_USER,
  SYNCDB_STORAGE_USER,
  SYNCDB_CHAOS_USER,
  SYNCDB_LOADLAB_USER,
  PROVISIONAL_MEMBER_USER,
  PROVISIONAL_STAFF_USER,
  PROVISIONAL_OUTSIDER_USER,
];
