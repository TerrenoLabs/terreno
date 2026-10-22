import React, {createContext, useContext} from "react";

import type {SyncDb} from "../client";

const SyncDbContext = createContext<SyncDb | null>(null);

export interface SyncDbProviderProps {
  client: SyncDb;
  children: React.ReactNode;
}

/** Provides a SyncDb client to descendant hooks (`useEntity`, `useQuery`, etc.). */
export const SyncDbProvider: React.FC<SyncDbProviderProps> = ({client, children}) => {
  return <SyncDbContext.Provider value={client}>{children}</SyncDbContext.Provider>;
};

/** Access the SyncDb client from context; throws when no provider is mounted. */
export const useSyncDbClient = (): SyncDb => {
  const client = useContext(SyncDbContext);
  if (!client) {
    throw new Error(
      "useSyncDbClient must be used within a <SyncDbProvider client={...}>. " +
        "Wrap your app (or the subtree using syncdb hooks) in SyncDbProvider."
    );
  }
  return client;
};

/** The SyncDb client from context, or `null` when no provider is mounted. */
export const useOptionalSyncDbClient = (): SyncDb | null => useContext(SyncDbContext);
