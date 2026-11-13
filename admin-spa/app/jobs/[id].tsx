import {AdminShellLayout, JobsJobDetail} from "@terreno/admin-frontend";
import {useLoaderData, useLocalSearchParams} from "expo-router";
import React from "react";
import {useAppConfig} from "../../components/AppConfigGate";
import {RecordNotFound} from "../../components/RecordNotFound";
import {RouteSeed} from "../../components/RouteSeed";
import {createJobsCommsLoader} from "../../server/jobsCommsRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createJobsCommsLoader("/jobs/[id]");

const JobsJobDetailRoute: React.FC = () => {
  const isNotFound = Boolean((useLoaderData() as {notFound?: boolean} | undefined)?.notFound);
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
      {isNotFound ? (
        <RecordNotFound backHref="/jobs" message={`No job with id "${jobId}".`} />
      ) : (
        <RouteSeed>
          <JobsJobDetail jobId={jobId} routeBase="" />
        </RouteSeed>
      )}
    </AdminShellLayout>
  );
};

export default JobsJobDetailRoute;
