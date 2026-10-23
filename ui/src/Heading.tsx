import React from "react";
import {Text as NativeText, Platform, type StyleProp, type TextStyle} from "react-native";

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
  level,
  size,
  testID,
}: HeadingProps): React.ReactElement => {
  const {theme} = useTheme();
  useTerrenoFontsLoaded();

  const style: StyleProp<TextStyle> = {};

  if (size === "sm") {
    style.fontFamily = "heading-semibold";
  } else {
    style.fontFamily = "heading-bold";
  }

  style.fontSize = fontSizes[size || "md"].size;
  if (align) {
    style.textAlign = align;
  }
  style.color = theme.text[color];

  // react-native-web turns role="heading" plus aria-level into <h1>-<h6>; native maps the role
  // to the header accessibility role. RN's TextProps don't declare aria-level, hence the spread.
  const headingProps = level === undefined ? {} : {"aria-level": level, role: "heading" as const};

  const lines = 0;
  return (
    <NativeText numberOfLines={lines} style={style} testID={testID} {...headingProps}>
      {children}
    </NativeText>
  );
};

HeadingComponent.displayName = "Heading";

export const Heading = React.memo(HeadingComponent);
