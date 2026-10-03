import FontAwesome from "@expo/vector-icons/FontAwesome";
import {useTheme} from "@terreno/ui";
import {Tabs} from "expo-router";
import type React from "react";
import type {ColorValue} from "react-native";

const TabBarIcon: React.FC<{
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: ColorValue;
}> = ({name, color}) => {
  return <FontAwesome color={color} name={name} size={24} style={{marginBottom: -3}} />;
};

const TabLayout: React.FC = () => {
  const {theme} = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.surface.primary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarButtonTestID: "tab-todos",
          tabBarIcon: ({color}) => <TabBarIcon color={color} name="list" />,
          title: "Todos",
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          headerShown: false,
          tabBarIcon: ({color}) => <TabBarIcon color={color} name="comments" />,
          title: "AI",
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          tabBarButtonTestID: "tab-documents",
          tabBarIcon: ({color}) => <TabBarIcon color={color} name="folder-open" />,
          title: "Documents",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarButtonTestID: "tab-profile",
          tabBarIcon: ({color}) => <TabBarIcon color={color} name="user" />,
          title: "Profile",
        }}
      />
    </Tabs>
  );
};

export default TabLayout;
