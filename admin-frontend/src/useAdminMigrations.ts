import {
  type AdminRpcQueryState,
  useAdminRpc,
  useAdminRpcMutation,
  useAdminRpcQuery,
} from "./useAdminRpc";

interface MigrationStatusRecord {
  appliedAt?: string;
  checksum: string;
  id: string;
}

interface MigrationLockStatus {
  expiresAt: string;
  holder: string;
}

interface AdminMigrationStatus {
  applied: MigrationStatusRecord[];
  lock: MigrationLockStatus | null;
  pending: Array<{checksum: string; id: string}>;
}

const MIGRATION_TAGS = ["admin_migrations"] as const;

export interface AdminMigrationsApi {
  useGetMigrationsQuery: (
    arg?: undefined,
    options?: {skip?: boolean; pollingInterval?: number}
  ) => AdminRpcQueryState<AdminMigrationStatus>;
  useRunMigrationsMutation: () => [
    (args: {wetRun: boolean}) => {unwrap: () => Promise<{taskId: string}>},
    {isLoading: boolean},
  ];
}

/** Migration status and run hooks for `{apiBase}/migrations/*`. */
export const useAdminMigrations = (apiBase: string): AdminMigrationsApi => {
  const rpc = useAdminRpc();
  return {
    useGetMigrationsQuery: (_arg, options) =>
      useAdminRpcQuery<AdminMigrationStatus>({
        pollingInterval: options?.pollingInterval,
        providesTags: MIGRATION_TAGS,
        rpc,
        skip: Boolean(options?.skip),
        url: `${apiBase}/migrations/status`,
      }),
    useRunMigrationsMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, {invalidatesTags: MIGRATION_TAGS});
      return [
        ({wetRun}: {wetRun: boolean}) =>
          trigger({method: "POST", url: `${apiBase}/migrations/run?wetRun=${wetRun}`}),
        meta,
      ] as ReturnType<AdminMigrationsApi["useRunMigrationsMutation"]>;
    },
  };
};
