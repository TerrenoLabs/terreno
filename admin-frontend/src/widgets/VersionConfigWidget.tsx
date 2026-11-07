import {AdminVersionConfig} from "../AdminVersionConfig";
import type {AdminHomeWidgetProps} from "../types";

/** Home-slot wrapper around the version config editor (embedded panel). */
export const VersionConfigWidget: React.FC<AdminHomeWidgetProps> = ({apiBase, routeBase}) => {
  return <AdminVersionConfig apiBase={apiBase} embedded routeBase={routeBase} />;
};
