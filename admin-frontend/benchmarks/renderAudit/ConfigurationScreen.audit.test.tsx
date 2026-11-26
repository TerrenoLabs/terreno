import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";

const SECTION_COUNT = 4;
const FIELDS_PER_SECTION = 4;
const sectionFields = {
  apiKey: {required: false, secret: true, type: "string"},
  enabled: {required: false, type: "boolean"},
  host: {description: "Server host name", required: false, type: "string"},
  port: {default: 587, required: false, type: "number"},
};
const meta = {
  sections: [
    {
      description: "Top-level settings",
      displayName: "General",
      fields: {
        appName: {required: false, type: "string"},
        maintenance: {required: false, type: "boolean"},
      },
      name: "__root__",
    },
    ...Array.from({length: SECTION_COUNT}, (_, index) => ({
      description: `Settings for service ${index}`,
      displayName: `Service ${index}`,
      fields: sectionFields,
      name: `service${index}`,
    })),
  ],
};
const values = {
  appName: "Example",
  maintenance: false,
  ...Object.fromEntries(
    Array.from({length: SECTION_COUNT}, (_, index) => [
      `service${index}`,
      {apiKey: "secret", enabled: true, host: `host${index}.example.com`, port: 587},
    ])
  ),
};
const metaResult = {data: meta, isLoading: false};
const valuesResult = {data: values, isLoading: false};
const mutation = [
  (): {unwrap: () => Promise<unknown>} => ({unwrap: async () => ({})}),
  {isLoading: false},
];

mock.module("../../src/useConfigurationApi", () => ({
  useConfigurationApi: () => ({
    useMetaQuery: () => metaResult,
    useUpdateMutation: () => mutation,
    useValuesQuery: () => valuesResult,
  }),
}));

import {ConfigurationScreen} from "../../src/ConfigurationScreen";

describe("ConfigurationScreen renders", () => {
  it("re-renders only the edited field's section while typing", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    const view = await audit.step("mount", () => renderWithTheme(<ConfigurationScreen />));
    await audit.step("same props", () => view.rerender(<ConfigurationScreen />));
    await audit.step("type in a section field", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("config-service2-host"), "host2x.example.com");
      });
    });
    await audit.step("type in a root field", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("config-__root__-appName"), "Example 2");
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## ConfigurationScreen\n${formatReport(report, {limit: 30})}`);
    }
    expect(componentStat(report, "mount", "ConfigFieldComponent")?.mounts).toBe(
      SECTION_COUNT * FIELDS_PER_SECTION + 2
    );
    expect(componentStat(report, "same props", "SectionCardComponent")).toBeUndefined();
    expect(componentStat(report, "same props", "ConfigFieldComponent")).toBeUndefined();
    // The root card reads the whole form, so it re-renders with the edited section's card.
    expect(componentStat(report, "type in a section field", "SectionCardComponent")?.updates).toBe(
      2
    );
    expect(componentStat(report, "type in a section field", "ConfigFieldComponent")?.updates).toBe(
      1
    );
    expect(componentStat(report, "type in a root field", "SectionCardComponent")?.updates).toBe(1);
    expect(componentStat(report, "type in a root field", "ConfigFieldComponent")?.updates).toBe(1);
  });
});
