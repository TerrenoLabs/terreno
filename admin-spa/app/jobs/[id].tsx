import {AdminShellLayout, JobsJobDetail} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {useAppConfig} from "../../components/AppConfigGate";

const JobsJobDetailRoute: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const jobId = Array.isArray(id) ? id[0] : (id ?? "");

  return (
    <AdminShellLayout
      apiBase={apiBase}
      breadcrumbs={[{href: "/", label: "Admin"}, {href: "/jobs", label: "Jobs"}, {label: "Detail"}]}
      configurationPath="/configuration"
      rolesPath="/roles"
      routeBase=""
    >
      <JobsJobDetail jobId={jobId} routeBase="" />
    </AdminShellLayout>
  );
};

export default JobsJobDetailRoute;
