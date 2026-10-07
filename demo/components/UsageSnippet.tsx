import {Box, Button, useTheme} from "@terreno/ui";
import * as Clipboard from "expo-clipboard";
import type React from "react";
import {useCallback, useState} from "react";
import {Platform, Text as RNText, type TextStyle} from "react-native";

const CODE_FONT = Platform.OS === "ios" ? "Menlo" : "monospace";

const codeTextStyle: TextStyle = {
  fontFamily: CODE_FONT,
  fontSize: 13,
  lineHeight: 20,
  ...(Platform.OS === "web"
    ? ({
        maxWidth: "100%",
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
      } as TextStyle)
    : null),
};

export const UsageSnippet: React.FC<{example: string}> = ({example}) => {
  const {theme} = useTheme();
  const [copiedExample, setCopiedExample] = useState<string | null>(null);
  const copied = copiedExample === example;

  const handleCopy = useCallback(async (): Promise<void> => {
    await Clipboard.setStringAsync(example);
    setCopiedExample(example);
  }, [example]);

  return (
    <Box gap={2} marginBottom={4} maxWidth="100%" minWidth={0} testID="usage-snippet" width="100%">
      <Box
        border="default"
        color="neutralLight"
        maxWidth="100%"
        minWidth={0}
        overflow="hidden"
        padding={3}
        rounding="md"
        testID="usage-code"
        width="100%"
      >
        <RNText selectable style={[codeTextStyle, {color: theme.text.primary}]}>
          {example}
        </RNText>
      </Box>
      <Button
        onClick={() => {
          void handleCopy();
        }}
        testID="usage-copy"
        text={copied ? "Copied" : "Copy"}
      />
    </Box>
  );
};
