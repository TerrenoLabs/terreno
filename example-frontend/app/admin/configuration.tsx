import {ConfigurationScreen} from "@terreno/admin-frontend";
import React from "react";
import {adminApi} from "@/store/sdk";

const ConfigScreen: React.FC = () => {
  return <ConfigurationScreen api={adminApi} title="App Configuration" />;
};

export default ConfigScreen;
