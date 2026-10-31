import {AdminRolesList} from "@terreno/admin-frontend";
import React from "react";
import {ADMIN_ROUTE} from "@/constants/adminConstants";
import {adminApi} from "@/store/sdk";

const AdminRolesScreen: React.FC = () => {
  return <AdminRolesList api={adminApi} apiBase={ADMIN_ROUTE} routeBase={ADMIN_ROUTE} />;
};

export default AdminRolesScreen;
