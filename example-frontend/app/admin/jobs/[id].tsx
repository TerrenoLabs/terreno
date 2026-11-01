import {JobsJobDetail} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {adminApi} from "@/store/sdk";

const ADMIN_BASE_URL = "/admin";

const JobsJobAdminScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const jobId = Array.isArray(id) ? id[0] : (id ?? "");

  return <JobsJobDetail api={adminApi} jobId={jobId} routeBase={ADMIN_BASE_URL} />;
};

export default JobsJobAdminScreen;
