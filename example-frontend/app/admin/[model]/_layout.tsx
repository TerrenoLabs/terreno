import {Stack} from "expo-router";
import type React from "react";

const AdminModelLayout: React.FC = () => {
  return (
    <Stack
      screenOptions={{contentStyle: {backgroundColor: "transparent", flex: 1}, headerShown: false}}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" options={{title: "Edit"}} />
      <Stack.Screen name="create" />
    </Stack>
  );
};

export default AdminModelLayout;
