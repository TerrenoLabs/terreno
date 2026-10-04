import {isNarrowViewport} from "@terreno/ui";
import {router, Stack} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {Pressable, StyleSheet, Text} from "react-native";

const Layout = () => {
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerBackTitle: "Back",
          headerBackVisible: isNarrowViewport(),
          headerRight: () => (
            <Pressable
              onPress={async () => {
                router.navigate("demo");
              }}
              style={styles.header}
            >
              <Text style={{fontWeight: "bold"}}>Demo Mode</Text>
            </Pressable>
          ),
          title: "Palette Generator",
        }}
      />
    </>
  );
};

export default Layout;

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    marginRight: isNarrowViewport() ? 0 : 16,
  },
});
