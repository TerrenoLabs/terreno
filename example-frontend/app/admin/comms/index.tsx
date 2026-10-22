import {CommsDashboardScreenWidget} from "@terreno/admin-frontend";
import React from "react";

const ADMIN_BASE_URL = "/admin";

const CommsAdminScreen: React.FC = () => {
  return (
    <CommsDashboardScreenWidget
      config={{customScreens: [], models: [], scripts: []}}
      routeBase={ADMIN_BASE_URL}
      screenName="comms"
    />
  );
};

export default CommsAdminScreen;
