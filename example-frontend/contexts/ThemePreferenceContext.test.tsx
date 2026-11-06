import {describe, it} from "bun:test";
import {TerrenoProvider} from "@terreno/ui";
import {assert} from "chai";
import React, {type ReactElement} from "react";
import TestRenderer, {act} from "react-test-renderer";

import {AppThemeProvider, useThemePreference} from "./ThemePreferenceContext";

// Host element type the probe renders; typed as string so it compares with node.type.
const PROBE_HOST: string = "PreferenceProbe";

const PreferenceProbe = (): ReactElement => {
  const {colorSchemeSetting, isLoading, setColorScheme} = useThemePreference();
  return React.createElement(PROBE_HOST, {
    colorSchemeSetting,
    isLoading,
    onSetDark: (): void => {
      void setColorScheme("dark");
    },
  });
};

describe("ThemePreferenceContext", () => {
  it("defaults to light outside the provider", async () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(PreferenceProbe));
    });
    assert.isDefined(renderer);
    const probe = renderer.root.find((node) => node.type === PROBE_HOST);
    assert.equal(probe.props.colorSchemeSetting, "light");
    assert.isFalse(probe.props.isLoading);
    await act(async () => {
      probe.props.onSetDark();
    });
    assert.equal(probe.props.colorSchemeSetting, "light");
  });

  it("passes the stored scheme to TerrenoProvider", async () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(AppThemeProvider, {
          children: React.createElement(PreferenceProbe),
          openAPISpecUrl: "http://example.test/openapi.json",
        })
      );
    });
    assert.isDefined(renderer);
    const provider = renderer.root.findByType(TerrenoProvider);
    const probe = renderer.root.find((node) => node.type === PROBE_HOST);
    assert.equal(provider.props.openAPISpecUrl, "http://example.test/openapi.json");
    assert.equal(provider.props.colorScheme, probe.props.colorSchemeSetting);
    assert.isFalse(probe.props.isLoading);
    await act(async () => {
      probe.props.onSetDark();
    });
    assert.equal(provider.props.colorScheme, probe.props.colorSchemeSetting);
  });
});
