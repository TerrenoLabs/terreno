import type React from "react";
import type {FC} from "react";

import type {IconRegistryMap, ThemePrimitives} from "./Common";
import {IconRegistryProvider} from "./IconRegistry";
import {OpenAPIProvider} from "./OpenAPIContext";
import {Host} from "./PortalHost";
import {type DeepPartial, type ThemeColorScheme, ThemeProvider} from "./Theme";
import {Toast} from "./Toast";
import {ToastProvider} from "./ToastNotifications";

export interface TerrenoProviderProps {
  children: React.ReactNode;
  colorScheme?: ThemeColorScheme;
  initialPrimitives?: DeepPartial<ThemePrimitives>;
  openAPISpecUrl?: string;
  /**
   * Custom icons to register, keyed by icon name. Registered names take
   * precedence over FontAwesome glyphs and are usable anywhere an `iconName`
   * is accepted (Icon, Button, IconButton, fields, etc.).
   */
  icons?: IconRegistryMap;
}

export const TerrenoProvider: FC<TerrenoProviderProps> = ({
  children,
  colorScheme,
  initialPrimitives,
  openAPISpecUrl,
  icons,
}) => {
  return (
    <ThemeProvider colorScheme={colorScheme} initialPrimitives={initialPrimitives}>
      <IconRegistryProvider icons={icons}>
        <ToastProvider
          animationDuration={250}
          animationType="slide-in"
          duration={50000}
          offset={50}
          placement="bottom"
          renderToast={(toastOptions) => {
            const dataOnDismiss = toastOptions?.data?.onDismiss;
            const providerOnHide = toastOptions?.onHide;
            const handleDismiss = () => {
              dataOnDismiss?.();
              providerOnHide?.();
            };

            const toastData = toastOptions?.data;
            const title =
              toastData?.title ??
              (typeof toastOptions?.message === "string" ? toastOptions.message : "");

            return <Toast {...toastData} onDismiss={handleDismiss} title={title} />;
          }}
          swipeEnabled
        >
          <OpenAPIProvider specUrl={openAPISpecUrl}>
            <Host>{children}</Host>
          </OpenAPIProvider>
        </ToastProvider>
      </IconRegistryProvider>
    </ThemeProvider>
  );
};
