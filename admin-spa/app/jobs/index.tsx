import {AdminShellLayout, JobsDashboardScreenWidget} from "@terreno/admin-frontend";
import React from "react";
import {useAppConfig} from "../../components/AppConfigGate";

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
      <JobsDashboardScreenWidget
        config={{customScreens: [], models: [], scripts: []}}
        routeBase=""
        screenName="jobs"
      />
    </AdminShellLayout>
  );
};

export default JobsAdminRoute;
