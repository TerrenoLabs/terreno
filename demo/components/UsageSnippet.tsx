import {Box, Button, Text} from "@terreno/ui";
import * as Clipboard from "expo-clipboard";
import type React from "react";
import {useCallback, useState} from "react";

export const UsageSnippet: React.FC<{example: string}> = ({example}) => {
  const [copiedExample, setCopiedExample] = useState<string | null>(null);
  const copied = copiedExample === example;

  const handleCopy = useCallback(async (): Promise<void> => {
    await Clipboard.setStringAsync(example);
    setCopiedExample(example);
  }, [example]);

  return (
    <Box gap={2} marginBottom={4} testID="usage-snippet">
      <Text>{example}</Text>
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
