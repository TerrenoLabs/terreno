import {AdminShellLayout, JobsDashboardScreenWidget} from "@terreno/admin-frontend";
import React from "react";
import {useAppConfig} from "../../components/AppConfigGate";
import {RouteSeed} from "../../components/RouteSeed";
import {createJobsCommsLoader} from "../../server/jobsCommsRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createJobsCommsLoader("/jobs");

const JobsAdminRoute: React.FC = () => {
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";

  return (
    <AdminShellLayout
      apiBase={apiBase}
      breadcrumbs={[{href: "/", label: "Admin"}, {label: "Jobs"}]}
      configurationPath="/configuration"
      rolesPath="/roles"
      routeBase=""
    >
      <RouteSeed>
        <JobsDashboardScreenWidget
          config={{customScreens: [], models: [], scripts: []}}
          routeBase=""
          screenName="jobs"
        />
      </RouteSeed>
    </AdminShellLayout>
  );
};

export default JobsAdminRoute;
