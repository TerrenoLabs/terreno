import type {FC} from "react";

import {Badge} from "../Badge";
import {Box} from "../Box";

interface LastUsedBadgeProps {
  /** Badge text, such as "Last used". */
  label: string;
  /** Test ID for the badge. */
  testID: string;
}

/**
 * Marks the sign-in method this device used last. Sits right-aligned above the method it labels.
 */
export const LastUsedBadge: FC<LastUsedBadgeProps> = ({label, testID}) => {
  return (
    <Box alignItems="end" marginBottom={1} width="100%">
      <Badge status="info" testID={testID} value={label} />
    </Box>
  );
};
