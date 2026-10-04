import {Box, isNarrowViewport, Text} from "@terreno/ui";
import {router, useGlobalSearchParams} from "expo-router";
import type React from "react";

interface HeaderModeLinkProps {
  target: "demo" | "dev";
}

const MODE_LABELS: Record<HeaderModeLinkProps["target"], string> = {
  demo: "Demo Mode",
  dev: "Dev Mode",
};

/** Header link that switches between the demo catalog and the dev story browser. */
export const HeaderModeLink: React.FC<HeaderModeLinkProps> = ({target}) => {
  const {theme} = useGlobalSearchParams<{theme?: string | string[]}>();
  const selectedTheme = Array.isArray(theme) ? theme[0] : theme;

  return (
    <Box
      accessibilityHint={`Opens ${MODE_LABELS[target]}`}
      accessibilityLabel={MODE_LABELS[target]}
      alignItems="center"
      height="100%"
      justifyContent="center"
      marginRight={isNarrowViewport() ? 0 : 4}
      onClick={(): void => {
        router.navigate({
          params: selectedTheme ? {theme: selectedTheme} : undefined,
          pathname: `/${target}`,
        });
      }}
      testID={`header-mode-${target}`}
    >
      <Text bold>{MODE_LABELS[target]}</Text>
    </Box>
  );
};
