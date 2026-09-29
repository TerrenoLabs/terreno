import {Box, Text} from "@terreno/ui";
import {router} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {Pressable} from "react-native";

import {relatedDemoHref} from "../catalogContract";

export const RelatedComponents: React.FC<{names: string[]}> = ({names}) => {
  const openRelated = useCallback((name: string): void => {
    router.push(relatedDemoHref(name));
  }, []);

  if (names.length === 0) {
    return null;
  }
  return (
    <Box direction="row" gap={3} testID="related-components" wrap>
      {names.map((name) => (
        <Pressable
          accessibilityHint={relatedDemoHref(name)}
          accessibilityRole="link"
          key={name}
          onPress={() => {
            openRelated(name);
          }}
          testID={`related-${name}`}
        >
          <Text color="link">{name}</Text>
        </Pressable>
      ))}
    </Box>
  );
};
