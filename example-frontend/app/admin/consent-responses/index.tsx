import {AdminModelTable} from "@terreno/admin-frontend";
import React from "react";

const ADMIN_BASE_URL = "/admin";

const ConsentResponsesScreen: React.FC = () => {
  return <AdminModelTable baseUrl={ADMIN_BASE_URL} modelName="consent-responses" />;
};

export default ConsentResponsesScreen;
