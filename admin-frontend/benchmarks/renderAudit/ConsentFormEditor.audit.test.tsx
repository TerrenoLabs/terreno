import {afterAll, describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../../src/AdminProvider";
import {ConsentFormEditor} from "../../src/ConsentFormEditor";
import {configureAdminModelApiDouble} from "../../src/testing/useAdminModelApiDouble";

const CHECKBOX_COUNT = 8;
const formData = {
  _id: "form-1",
  active: true,
  checkboxes: Array.from({length: CHECKBOX_COUNT}, (_, index) => ({
    confirmationPrompt: "",
    label: `Checkbox ${index}`,
    required: index % 2 === 0,
  })),
  content: {en: "# Terms"},
  order: 1,
  slug: "terms",
  title: "Terms",
  type: "terms",
};
const readResult = {data: formData, isLoading: false};
const mutation = (): unknown[] => [
  (): {unwrap: () => Promise<unknown>} => ({unwrap: async () => ({})}),
  {isLoading: false},
];

const originalFetch = globalThis.fetch;

describe("ConsentFormEditor renders", () => {
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("re-renders only the edited checkbox row while typing", async () => {
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(JSON.stringify({}), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      })) as unknown as typeof fetch;
    configureAdminModelApiDouble({
      useCreateMutation: mutation,
      useReadQuery: () => readResult,
      useUpdateMutation: mutation,
    });
    const audit = createRenderAudit({
      ignore: /^(ThemeProvider|TerrenoFontProvider|AdminProvider)$/,
    });
    const element = (): React.ReactElement => (
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <ConsentFormEditor
          baseUrl="/admin"
          id="form-1"
          onCancel={(): void => {}}
          onSave={(): void => {}}
        />
      </AdminProvider>
    );
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      mounted = renderWithTheme(element());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("same props", () => view.rerender(element()));
    await audit.step("type in title", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("consent-form-title-input"), "Terms 2");
      });
    });
    await audit.step("type in one checkbox label", async () => {
      await act(async () => {
        fireEvent.changeText(
          view.getByTestId("consent-form-checkbox-3-label-input"),
          "Checkbox 3x"
        );
      });
    });
    const titleValue = view.getByTestId("consent-form-title-input").props.value;
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## ConsentFormEditor\n${formatReport(report, {limit: 30})}`);
    }
    expect(titleValue).toBe("Terms 2");
    expect(componentStat(report, "mount", "ConsentCheckboxEditor")?.mounts).toBe(CHECKBOX_COUNT);
    expect(componentStat(report, "same props", "ConsentCheckboxEditor")).toBeUndefined();
    expect(componentStat(report, "type in title", "ConsentCheckboxEditor")).toBeUndefined();
    expect(
      componentStat(report, "type in one checkbox label", "ConsentCheckboxEditor")?.updates
    ).toBe(1);
  });
});
