/**
 * A drop-in account security screen connected to a Better Auth client: `@terreno/ui`'s
 * `AccountSecurityScreen` driven by `useAccountSecurity`. Each card shows only when the server
 * has its feature on (`GET {basePath}/terreno/methods`).
 */
import type {AccountSecurityScreenProps} from "@terreno/ui";
import {AccountSecurityScreen} from "@terreno/ui";
import type {FC} from "react";

import {type UseAccountSecurityOptions, useAccountSecurity} from "./useAccountSecurity";

export interface TerrenoAccountSecurityScreenProps
  extends UseAccountSecurityOptions,
    Pick<
      AccountSecurityScreenProps,
      "title" | "description" | "header" | "children" | "withPage" | "maxWidth" | "testID"
    > {}

/**
 * Renders the security screen for the signed-in user. See "Drop-in security screen" in
 * docs/how-to/configure-better-auth.md.
 *
 * @example
 * ```tsx
 * <TerrenoAccountSecurityScreen
 *   callbackURL="/security"
 *   client={authClient}
 *   linkError={useLocalSearchParams<{error?: string}>().error}
 * />
 * ```
 */
export const TerrenoAccountSecurityScreen: FC<TerrenoAccountSecurityScreenProps> = ({
  title,
  description,
  header,
  children,
  withPage,
  maxWidth,
  testID,
  ...options
}) => {
  const security = useAccountSecurity(options);
  return (
    <AccountSecurityScreen
      description={description}
      header={header}
      maxWidth={maxWidth}
      testID={testID}
      title={title}
      withPage={withPage}
      {...security.screenProps}
    >
      {children}
    </AccountSecurityScreen>
  );
};
