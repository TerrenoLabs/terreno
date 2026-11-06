import {CommsDashboardScreenWidget} from "@terreno/admin-frontend";
import React from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";
import {RouteSeed} from "../../components/RouteSeed";
import {createJobsCommsLoader} from "../../server/jobsCommsRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createJobsCommsLoader("/comms");

const CommsAdminRoute: React.FC = () => {
  return (
    <AdminSpaShell breadcrumbs={[{href: "/", label: "Admin"}, {label: "Comms"}]}>
      <RouteSeed>
        <CommsDashboardScreenWidget
          config={{customScreens: [], models: [], scripts: []}}
          routeBase=""
          screenName="comms"
        />
      </RouteSeed>
    </AdminSpaShell>
  );
};

export default CommsAdminRoute;
