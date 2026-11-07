import {JobsJobDetail} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";

const ADMIN_BASE_URL = "/admin";

const JobsJobAdminScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const jobId = Array.isArray(id) ? id[0] : (id ?? "");

  return <JobsJobDetail jobId={jobId} routeBase={ADMIN_BASE_URL} />;
};

export default JobsJobAdminScreen;
