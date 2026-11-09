import type {BlockError} from "@terreno/blocks";
import type React from "react";

import {Accordion} from "../Accordion";
import {Banner} from "../Banner";
import {Box} from "../Box";
import {Text} from "../Text";

const VISIBLE_ERRORS = 3;

export const BlocksError: React.FC<{
  errors: readonly BlockError[];
  raw: string;
  testID?: string;
}> = ({errors, raw, testID}) => {
  const summary = errors
    .slice(0, VISIBLE_ERRORS)
    .map((error) => (error.path === "" ? error.message : `${error.path}: ${error.message}`))
    .join(" ");
  return (
    <Box gap={2} testID={testID}>
      <Banner hasIcon status="alert" text={summary} />
      <Accordion isCollapsed testID={testID ? `${testID}-raw` : undefined} title="Raw document">
        <Text>{raw}</Text>
      </Accordion>
    </Box>
  );
};
