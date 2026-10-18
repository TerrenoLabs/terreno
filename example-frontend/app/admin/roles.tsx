import {AdminRolesList} from "@terreno/admin-frontend";
import React from "react";
import {ADMIN_ROUTE} from "@/constants/adminConstants";

const AdminRolesScreen: React.FC = () => {
  return <AdminRolesList apiBase={ADMIN_ROUTE} routeBase={ADMIN_ROUTE} />;
};

export default AdminRolesScreen;
