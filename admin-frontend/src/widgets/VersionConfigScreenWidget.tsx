import {AdminVersionConfig} from "../AdminVersionConfig";
import type {AdminScreenWidgetProps} from "../types";

/** Full-page version config screen (`version-config` route). */
export const VersionConfigScreenWidget: React.FC<AdminScreenWidgetProps> = ({
  apiBase,
  baseUrl,
  routeBase,
}) => {
  return <AdminVersionConfig apiBase={apiBase} baseUrl={baseUrl} routeBase={routeBase} />;
};
