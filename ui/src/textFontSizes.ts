import {Platform} from "react-native";

import type {TextSize} from "./Common";

interface TextFontSizeAndWeight {
  size: number;
  weight: "regular" | "medium";
}

const fontSizeAndWeightWeb: Record<TextSize, TextFontSizeAndWeight> = {
  "2xl": {size: 48, weight: "medium"},
  lg: {size: 18, weight: "medium"},
  md: {size: 16, weight: "regular"},
  sm: {size: 12, weight: "regular"},
  xl: {size: 20, weight: "medium"},
};

const fontSizeAndWeightMobile: Record<TextSize, TextFontSizeAndWeight> = {
  "2xl": {size: 40, weight: "medium"},
  lg: {size: 16, weight: "medium"},
  md: {size: 14, weight: "regular"},
  sm: {size: 10, weight: "regular"},
  xl: {size: 18, weight: "medium"},
};

/**
 * Font size and weight for each `Text` size on the current platform. Shared by `Text` and by
 * anything that has to predict how wide `Text` will render, such as DataTable auto widths.
 */
export const textFontSizes: Record<TextSize, TextFontSizeAndWeight> =
  Platform.OS === "web" ? fontSizeAndWeightWeb : fontSizeAndWeightMobile;
