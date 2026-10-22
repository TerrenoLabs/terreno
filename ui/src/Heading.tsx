import React from "react";
import {Text as NativeText, Platform, type TextStyle} from "react-native";

import type {HeadingProps} from "./Common";
import {useTerrenoFontsLoaded} from "./TerrenoFontProvider";
import {useTheme} from "./Theme";

const fontSizeAndWeightWeb = {
  "2xl": {size: 48, weight: "bold"},
  lg: {size: 24, weight: "bold"},
  md: {size: 18, weight: "bold"},
  sm: {size: 16, weight: "semibold"},
  xl: {size: 32, weight: "bold"},
};

const fontSizeAndWeighMobile = {
  "2xl": {size: 32, weight: "bold"},
  lg: {size: 20, weight: "bold"},
  md: {size: 16, weight: "bold"},
  sm: {size: 14, weight: "semibold"},
  xl: {size: 28, weight: "bold"},
};

const fontSizes = Platform.OS === "web" ? fontSizeAndWeightWeb : fontSizeAndWeighMobile;

const HeadingComponent = ({
  align,
  children,
  color = "primary",
  size,
  testID,
}: HeadingProps): React.ReactElement => {
  const {theme} = useTheme();
  useTerrenoFontsLoaded();

  const style: TextStyle = {
    color: theme.text[color],
    fontFamily: size === "sm" ? "heading-semibold" : "heading-bold",
    fontSize: fontSizes[size || "md"].size,
    ...(align ? {textAlign: align} : {}),
  };

  const lines = 0;
  return (
    <NativeText numberOfLines={lines} style={style} testID={testID}>
      {children}
    </NativeText>
  );
};

HeadingComponent.displayName = "Heading";

export const Heading = React.memo(HeadingComponent);
