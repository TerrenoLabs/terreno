import type {AdminConfigResponse} from "@terreno/admin-frontend";
import React, {createContext, useContext} from "react";

const AdminGateConfigContext = createContext<AdminConfigResponse | null>(null);

/**
 * Shares the `/admin/config` response that {@link AdminGate} already loaded with the
 * screens it gates. The gate renders the admin route Stack only after that response
 * arrives, so a consumer has the config on its first render. Reading it here instead of
 * issuing a second request keeps the provider tree under the gate from changing shape
 * after mount, which would remount the Stack and reset the route to `/`.
 */
export const AdminGateConfigProvider: React.FC<{
  children: React.ReactNode;
  config: AdminConfigResponse | null;
}> = ({children, config}) => (
  <AdminGateConfigContext.Provider value={config}>{children}</AdminGateConfigContext.Provider>
);

/**
 * The admin config loaded by {@link AdminGate}, or `null` on routes the gate renders
 * without one (`/login`, `/forbidden`).
 */
export const useAdminGateConfig = (): AdminConfigResponse | null => {
  return useContext(AdminGateConfigContext);
};
