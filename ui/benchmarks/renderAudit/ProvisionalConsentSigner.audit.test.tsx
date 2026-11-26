import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {ProvisionalConsentSigner} from "../../src/ProvisionalConsentSigner";
import {createFakeRequestClient, renderWithTheme} from "../../src/test-utils";
import type {ConsentFormPublic} from "../../src/useConsentForms";
import type {ProvisionalConsentStatusRow} from "../../src/useProvisionalConsent";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const makeForm = (id: string, title: string): ConsentFormPublic => ({
  active: true,
  agreeButtonText: "I agree",
  allowDecline: true,
  captureSignature: false,
  checkboxes: [],
  content: {en: `# ${title}`},
  declineButtonText: "Decline",
  defaultLocale: "en",
  id,
  order: 1,
  required: true,
  requireScrollToBottom: false,
  slug: id,
  title,
  type: "agreement",
  version: 1,
});

const signedAt = "2026-10-20T15:30:00.000Z";
const STATUSES = ["pending", "provisional", "signed", "declined"] as const;
const rows: ProvisionalConsentStatusRow[] = Array.from({length: 8}, (_, index) => {
  const status = STATUSES[index % STATUSES.length];
  return {
    form: makeForm(`form-${index}`, `Form ${index}`),
    isConsented: status === "provisional" || status === "signed",
    provisional:
      status === "provisional"
        ? {
            note: "Guardian agreed by phone",
            responseId: `response-${index}`,
            signedAt,
            signedBy: {email: "dana@example.com", id: "staff-1", name: "Dana Rivera"},
          }
        : undefined,
    respondedAt: status === "pending" ? undefined : signedAt,
    status,
  };
});

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("ProvisionalConsentSigner renders", () => {
  it("keeps the form list still while a void reason is typed", async () => {
    const fake = createFakeRequestClient({
      "GET /consent-responses/status": async () => rows,
    });
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      view = renderWithTheme(<ProvisionalConsentSigner client={fake.client} userId="member-1" />);
      await settle();
    });
    await audit.step("same props", async () => {
      view?.rerender(<ProvisionalConsentSigner client={fake.client} userId="member-1" />);
      await settle();
    });
    await audit.step("open void dialog", async () => {
      await act(async () => {
        fireEvent.press(view!.getByTestId("provisional-consent-void-form-1"));
      });
      await settle();
    });
    await audit.step("type one character of void reason", async () => {
      act(() => {
        fireEvent.changeText(view!.getByTestId("provisional-consent-void-reason-input"), "W");
      });
      await settle();
    });
    await audit.step("open sign form", async () => {
      await act(async () => {
        fireEvent.press(view!.getByTestId("provisional-consent-open-form-0"));
      });
      await settle();
    });
    await audit.step("type one character of note", async () => {
      act(() => {
        fireEvent.changeText(view!.getByTestId("provisional-consent-note-input"), "G");
      });
      await settle();
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(formatReport(report, {limit: 14}));
    }

    expect(componentStat(report, "mount", "ConsentStatusRow")?.mounts).toBe(8);
    expect(componentStat(report, "open void dialog", "ConsentStatusRow")).toBeUndefined();
    expect(
      componentStat(report, "type one character of void reason", "ConsentStatusRow")
    ).toBeUndefined();
  });
});
