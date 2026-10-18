import {AdminScreenRouter} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";

const ADMIN_BASE_URL = "/admin";

const AdminTableScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  return <AdminScreenRouter baseUrl={ADMIN_BASE_URL} name={model} />;
};

export default AdminTableScreen;
