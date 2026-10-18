import {ConsentResponseViewer} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";

const ADMIN_BASE_URL = "/admin";

const ConsentResponseScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  return <ConsentResponseViewer baseUrl={ADMIN_BASE_URL} id={id} />;
};

export default ConsentResponseScreen;
