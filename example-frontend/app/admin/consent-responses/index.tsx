import {AdminModelTable} from "@terreno/admin-frontend";
import React from "react";
import {adminApi} from "@/store/sdk";

const ADMIN_BASE_URL = "/admin";

// AdminModelTable links each row to `${baseUrl}/${modelName}/${id}`, which is this route's
// `[id]` detail screen.
const ConsentResponsesScreen: React.FC = () => {
  return <AdminModelTable api={adminApi} baseUrl={ADMIN_BASE_URL} modelName="consent-responses" />;
};

export default ConsentResponsesScreen;
