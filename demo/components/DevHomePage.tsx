import type {DemoConfiguration} from "@config";
import {Box, Heading, Text} from "@terreno/ui";
import {useNavigation} from "expo-router";
import React, {useEffect, useMemo, useState} from "react";
import {Pressable, ScrollView, View} from "react-native";

import {matchesDemoSearch} from "../catalogContract";
import {DemoCatalogFilters} from "./DemoCatalogFilters";

interface DevHomePageProps {
  demoConfig: DemoConfiguration[];
  onPress: (componentName: string, story: string) => void;
}

export const DevHomePage = ({demoConfig, onPress}: DevHomePageProps): React.ReactElement => {
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const visibleConfigs = useMemo(
    () => demoConfig.filter((config) => matchesDemoSearch(config, query, category)),
    [category, demoConfig, query]
  );
  // Set the title
  useEffect(() => {
    navigation.setOptions({title: "Terreno UI Dev"});
  }, [navigation]);

  return (
    <ScrollView>
      <View
        style={{
          display: "flex",
          flex: 1,
          overflow: "scroll",
          paddingBottom: 120,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 16,
        }}
      >
        <DemoCatalogFilters
          category={category}
          onCategoryChange={setCategory}
          onQueryChange={setQuery}
          query={query}
        />
        {visibleConfigs.map((config) => (
          <React.Fragment key={config.name}>
            <Box marginBottom={3}>
              <Heading size="md">{config.name}</Heading>
            </Box>
            {Object.keys(config.stories).map((title) => (
              <Pressable
                key={title}
                onPress={() => {
                  void onPress(config.name, title);
                }}
              >
                <Box marginBottom={2}>
                  <Text size="md">{title}</Text>
                </Box>
              </Pressable>
            ))}
          </React.Fragment>
        ))}
      </View>
    </ScrollView>
  );
};
