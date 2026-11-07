import {CommsMessageDetail} from "@terreno/admin-frontend";
import {useLoaderData, useLocalSearchParams} from "expo-router";
import React from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";
import {RecordNotFound} from "../../components/RecordNotFound";
import {RouteSeed} from "../../components/RouteSeed";
import {createJobsCommsLoader} from "../../server/jobsCommsRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createJobsCommsLoader("/comms/[id]");

const CommsMessageAdminRoute: React.FC = () => {
  const isNotFound = Boolean((useLoaderData() as {notFound?: boolean} | undefined)?.notFound);
  const {id} = useLocalSearchParams<{id: string}>();
  const messageId = Array.isArray(id) ? id[0] : (id ?? "");

  return (
    <AdminSpaShell
      breadcrumbs={[
        {href: "/", label: "Admin"},
        {href: "/comms", label: "Comms"},
        {label: "Message"},
      ]}
    >
      {isNotFound ? (
        <RecordNotFound backHref="/comms" message={`No message with id "${messageId}".`} />
      ) : (
        <RouteSeed>
          <CommsMessageDetail messageId={messageId} routeBase="" />
        </RouteSeed>
      )}
    </AdminSpaShell>
  );
};

export default CommsMessageAdminRoute;
