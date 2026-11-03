import {AdminScreenRouter} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {adminApi} from "@/store/sdk";

const ADMIN_BASE_URL = "/admin";

const AdminTableScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  return <AdminScreenRouter api={adminApi} baseUrl={ADMIN_BASE_URL} name={model} />;
};

export default AdminTableScreen;
