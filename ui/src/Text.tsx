import React from "react";
import {Text as NativeText, Platform, type TextStyle} from "react-native";

import type {TextProps} from "./Common";
import {Hyperlink} from "./Hyperlink";
import {useTerrenoFontsLoaded} from "./TerrenoFontProvider";
import {useTheme} from "./Theme";

const fontSizeAndWeightWeb = {
  "2xl": {size: 48, weight: "medium"},
  lg: {size: 18, weight: "medium"},
  md: {size: 16, weight: "regular"},
  sm: {size: 12, weight: "regular"},
  xl: {size: 20, weight: "medium"},
};

const fontSizeAndWeighMobile = {
  "2xl": {size: 40, weight: "medium"},
  lg: {size: 16, weight: "medium"},
  md: {size: 14, weight: "regular"},
  sm: {size: 10, weight: "regular"},
  xl: {size: 18, weight: "medium"},
};

const fontSizes = Platform.OS === "web" ? fontSizeAndWeightWeb : fontSizeAndWeighMobile;

const TextComponent = ({
  accessibilityRole,
  align = "left",
  bold,
  children,
  color,
  italic = false,
  size = "md",
  truncate = false,
  underline,
  numberOfLines,
  ref,
  skipLinking,
  testID,
}: TextProps): React.ReactElement => {
  const {theme} = useTheme();
  useTerrenoFontsLoaded();

  const style: TextStyle = {};

  if (size === "sm" || size === "md") {
    if (bold && italic) {
      style.fontFamily = "text-bold-italic";
    } else if (italic) {
      style.fontFamily = "text-regular-italic";
    } else if (bold) {
      style.fontFamily = "text-bold";
    } else {
      style.fontFamily = "text-regular";
    }
  } else {
    if (bold && italic) {
      style.fontFamily = "text-bold-italic";
    } else if (italic) {
      style.fontFamily = "text-medium-italic";
    } else if (bold) {
      style.fontFamily = "text-bold";
    } else {
      style.fontFamily = "text-medium";
    }
  }

  style.fontSize = fontSizes[size].size;
  if (align) {
    style.textAlign = align;
  }
  if (!theme?.text) {
    throw new Error("Text component must be used within TerrenoProvider");
  }
  if (color) {
    style.color = theme.text[color];
  } else {
    style.color = theme.text.primary;
  }

  if (italic) {
    style.fontStyle = "italic";
  }
  if (underline) {
    style.textDecorationLine = "underline";
  }
  let lines = 0;
  if (numberOfLines && truncate && numberOfLines > 1) {
    console.error(`Cannot truncate Text and have ${numberOfLines} lines`);
  }
  if (numberOfLines) {
    lines = numberOfLines;
  } else if (truncate) {
    lines = 1;
  }
  const inner = (
    <NativeText
      numberOfLines={lines}
      selectable={undefined}
      style={style}
      testID={testID}
      {...(accessibilityRole ? {accessibilityRole} : {})}
      {...(ref ? {ref} : {})}
    >
      {children}
    </NativeText>
  );
  if (skipLinking) {
    return inner;
  } else {
    return (
      <Hyperlink linkDefault linkStyle={{textDecorationLine: "underline"}}>
        {inner}
      </Hyperlink>
    );
  }
};

TextComponent.displayName = "Text";

export const Text = React.memo(TextComponent);
