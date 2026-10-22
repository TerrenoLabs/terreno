import {SidebarNavigation, type SidebarNavigationItem} from "@terreno/ui";
import {router} from "expo-router";
import {Pressable, StyleSheet, Text} from "react-native";

export const unstable_settings = {
  initialRouteName: "index",
};

const topItems: SidebarNavigationItem[] = [
  {iconName: "house", label: "Home", route: "index"},
  {iconName: "chart-line", label: "Dashboard", route: "dashboard"},
  {badge: 5, iconName: "folder", label: "Projects", route: "projects"},
  {badge: 142, iconName: "envelope", label: "Messages", route: "messages"},
  {badge: true, iconName: "code", label: "Tools", route: "projects"},
];

const bottomItems: SidebarNavigationItem[] = [
  {iconName: "gear", label: "Settings", route: "settings"},
  {iconName: "circle-question", label: "Help", route: "help"},
];

const headerRight = () => (
  <Pressable onPress={() => router.navigate("/dev")} style={styles.headerButton}>
    <Text style={{fontWeight: "bold"}}>Dev Mode</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  headerButton: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
  },
});

const SidebarNavigationLayout = () => {
  return (
    <SidebarNavigation
      bottomItems={bottomItems}
      screenOptions={{headerRight, title: "Sidebar Navigation"}}
      topItems={topItems}
    >
      <SidebarNavigation.Screen name="index" options={{title: "Home"}} />
      <SidebarNavigation.Screen name="dashboard" options={{title: "Dashboard"}} />
      <SidebarNavigation.Screen name="projects" options={{title: "Projects"}} />
      <SidebarNavigation.Screen name="messages" options={{title: "Messages"}} />
      <SidebarNavigation.Screen name="settings" options={{title: "Settings"}} />
      <SidebarNavigation.Screen name="help" options={{title: "Help"}} />
    </SidebarNavigation>
  );
};

export default SidebarNavigationLayout;
