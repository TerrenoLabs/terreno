import {type FC, memo} from "react";

import {Box} from "../Box";
import {Icon} from "../Icon";
import {Text} from "../Text";
import type {PasswordRequirement} from "./signUpTypes";

interface PasswordRequirementsProps {
  /** The current password value to validate against. */
  password: string;
  /** List of password requirements to display. */
  requirements: PasswordRequirement[];
  /** Test ID prefix for the component. */
  testID?: string;
}

/**
 * Displays a list of password requirements with check/cross indicators.
 * Memoized so typing in a field other than the password does not re-render the list.
 */
export const PasswordRequirements: FC<PasswordRequirementsProps> = memo(
  ({password, requirements, testID = "password-requirements"}) => {
    return (
      <Box testID={testID}>
        {requirements.map((req) => {
          const isMet = password.length > 0 && req.validate(password);
          return (
            <Box
              alignItems="center"
              direction="row"
              gap={2}
              key={req.key}
              marginBottom={1}
              testID={`${testID}-${req.key}`}
            >
              <Icon
                color={isMet ? "success" : "secondaryLight"}
                iconName={isMet ? "circle-check" : "circle"}
                size="sm"
                testID={`${testID}-${req.key}-icon`}
              />
              <Text color={isMet ? "success" : "secondaryLight"} size="sm">
                {req.label}
              </Text>
            </Box>
          );
        })}
      </Box>
    );
  }
);
PasswordRequirements.displayName = "PasswordRequirements";
