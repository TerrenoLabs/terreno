import {describe, it, type mock} from "bun:test";
import {useFonts as useTextFonts} from "@expo-google-fonts/nunito";
import {useFonts as useHeadingFonts} from "@expo-google-fonts/titillium-web";
import {render} from "@testing-library/react-native";
import {assert} from "chai";
import type React from "react";
import {Text as NativeText} from "react-native";

import {TerrenoFontProvider, useTerrenoFontsLoaded} from "./TerrenoFontProvider";

const FontStatus: React.FC = () => {
  const areFontsLoaded = useTerrenoFontsLoaded();
  return <NativeText testID="font-status">{String(areFontsLoaded)}</NativeText>;
};

describe("TerrenoFontProvider", () => {
  it("publishes font-load completion so memoized typography redraws", () => {
    (useTextFonts as ReturnType<typeof mock>).mockReturnValue([false, null]);
    (useHeadingFonts as ReturnType<typeof mock>).mockReturnValue([false, null]);
    const result = render(
      <TerrenoFontProvider>
        <FontStatus />
      </TerrenoFontProvider>
    );

    assert.equal(result.getByTestId("font-status").children[0], "false");

    (useTextFonts as ReturnType<typeof mock>).mockReturnValue([true, null]);
    (useHeadingFonts as ReturnType<typeof mock>).mockReturnValue([true, null]);
    result.rerender(
      <TerrenoFontProvider>
        <FontStatus />
      </TerrenoFontProvider>
    );

    assert.equal(result.getByTestId("font-status").children[0], "true");
  });
});
