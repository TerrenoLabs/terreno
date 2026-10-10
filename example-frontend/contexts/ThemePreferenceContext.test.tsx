import {describe, it} from "bun:test";
import {TerrenoProvider} from "@terreno/ui";
import {assert} from "chai";
import React, {type ReactElement} from "react";
import TestRenderer, {act} from "react-test-renderer";

import {AppThemeProvider, useThemePreference} from "./ThemePreferenceContext";

const PreferenceProbe = (): ReactElement => {
  const {colorSchemeSetting, isLoading, setColorScheme} = useThemePreference();
  return React.createElement("PreferenceProbe", {
    colorSchemeSetting,
    isLoading,
    onSetDark: (): void => {
      void setColorScheme("dark");
    },
  });
};

describe("ThemePreferenceContext", () => {
  it("defaults to follow-system outside the provider", async () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(PreferenceProbe));
    });
    assert.isDefined(renderer);
    const probe = renderer.root.findByType("PreferenceProbe");
    assert.equal(probe.props.colorSchemeSetting, "system");
    assert.isFalse(probe.props.isLoading);
    await act(async () => {
      probe.props.onSetDark();
    });
    assert.equal(probe.props.colorSchemeSetting, "system");
  });

  it("passes the stored scheme to TerrenoProvider", async () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AppThemeProvider,
          {openAPISpecUrl: "http://example.test/openapi.json"},
          React.createElement(PreferenceProbe)
        )
      );
    });
    assert.isDefined(renderer);
    const provider = renderer.root.findByType(TerrenoProvider);
    const probe = renderer.root.findByType("PreferenceProbe");
    assert.equal(provider.props.openAPISpecUrl, "http://example.test/openapi.json");
    assert.equal(provider.props.colorScheme, probe.props.colorSchemeSetting);
    assert.isFalse(probe.props.isLoading);
    await act(async () => {
      probe.props.onSetDark();
    });
    assert.equal(provider.props.colorScheme, probe.props.colorSchemeSetting);
  });
});
