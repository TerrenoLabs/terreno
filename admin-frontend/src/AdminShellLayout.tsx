import {Box} from "@terreno/ui";
import React from "react";
import {AdminShell, type AdminShellProps} from "./AdminShell";

/**
 * Props for {@link AdminShellLayout}: same as {@link AdminShellProps} except `children` is the
 * main column body (typically an Expo Router `<Stack />`, a single screen, or a fragment).
 */
export type AdminShellLayoutProps = Omit<AdminShellProps, "children"> & {
  children: React.ReactNode;
};

/**
 * Default admin chrome for Expo Router (and similar) apps: {@link AdminShell} plus a flex main
 * column so nested navigators fill the area beside the sidebar without each app re-wrapping
 * `children` in a grow `Box`.
 *
 * Use in `app/admin/_layout.tsx` (or your admin root) as:
 *
 * ```tsx
 * <AdminShellLayout apiBase="/admin" routeBase="/admin" configurationPath="...">
 *   <Stack>...</Stack>
 * </AdminShellLayout>
 * ```
 */
export const AdminShellLayout: React.FC<AdminShellLayoutProps> = ({children, ...shellProps}) => {
  return (
    <AdminShell {...shellProps}>
      <Box flex="grow" minHeight={0} minWidth={0}>
        {children}
      </Box>
    </AdminShell>
  );
};
