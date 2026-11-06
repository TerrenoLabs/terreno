import {type OrganizationSummary, OrgDirectoryScreen, useOrgContext} from "@terreno/admin-frontend";
import {router} from "expo-router";
import React, {useCallback} from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";
import {isOrganizationOperatorProfile, useAdminSpaProfile} from "../../components/adminSpaProfile";
import {RouteSeed} from "../../components/RouteSeed";
import {createOrgsLoader} from "../../server/orgsRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createOrgsLoader("/orgs");

const OrgDirectoryRoute: React.FC = () => {
  const {data: profile} = useAdminSpaProfile();
  const {selectOrganization} = useOrgContext();
  const isOperator = isOrganizationOperatorProfile(profile);
  const handleEnter = useCallback(
    (organization: OrganizationSummary): void => {
      selectOrganization(organization);
      router.push(`/orgs/${organization._id}`);
    },
    [selectOrganization]
  );
  return (
    <AdminSpaShell breadcrumbs={[{href: "/", label: "Admin"}, {label: "Organizations"}]}>
      <RouteSeed>
        <OrgDirectoryScreen
          isOperator={isOperator}
          onEnterOrganization={handleEnter}
          routeBase=""
        />
      </RouteSeed>
    </AdminSpaShell>
  );
};

export default OrgDirectoryRoute;
