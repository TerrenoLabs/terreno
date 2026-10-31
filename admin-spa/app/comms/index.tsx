import {CommsDashboardScreenWidget} from "@terreno/admin-frontend";
import React from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";

const CommsAdminRoute: React.FC = () => {
  return (
    <AdminSpaShell breadcrumbs={[{href: "/", label: "Admin"}, {label: "Comms"}]}>
      <CommsDashboardScreenWidget
        config={{customScreens: [], models: [], scripts: []}}
        routeBase=""
        screenName="comms"
      />
    </AdminSpaShell>
  );
};

export default CommsAdminRoute;
