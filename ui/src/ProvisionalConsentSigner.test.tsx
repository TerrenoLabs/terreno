import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {DateTime} from "luxon";

import {ProvisionalConsentSigner} from "./ProvisionalConsentSigner";
import {renderWithTheme} from "./test-utils";
import type {ConsentFormPublic} from "./useConsentForms";
import type {ProvisionalConsentApi, ProvisionalConsentStatusRow} from "./useProvisionalConsent";

interface QueryState {
  data?: unknown;
  error?: unknown;
  isLoading?: boolean;
}

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
const respondedAt = "2026-10-21T09:00:00.000Z";
const formatted = (iso: string): string =>
  DateTime.fromISO(iso).toLocaleString(DateTime.DATETIME_MED);

const rows: ProvisionalConsentStatusRow[] = [
  {form: makeForm("form-pending", "Telehealth"), isConsented: false, status: "pending"},
  {
    form: makeForm("form-provisional", "Treatment"),
    isConsented: true,
    provisional: {
      note: "Guardian agreed by phone",
      responseId: "response-1",
      signedAt,
      signedBy: {email: "dana@example.com", id: "staff-1", name: "Dana Rivera"},
    },
    respondedAt: signedAt,
    status: "provisional",
  },
  {
    form: makeForm("form-signed", "Privacy"),
    isConsented: true,
    respondedAt,
    status: "signed",
  },
  {
    form: makeForm("form-declined", "Research"),
    isConsented: false,
    respondedAt,
    status: "declined",
  },
];

/** A fake of the consumer's RTK api whose status query returns `state`. */
const buildApi = (
  initial: QueryState
): {api: ProvisionalConsentApi; refetch: ReturnType<typeof mock>; userIds: string[]} => {
  const refetch = mock(() => {});
  const userIds: string[] = [];
  const api = {
    enhanceEndpoints: () => ({
      injectEndpoints: () => ({
        useGetConsentStatusQuery: (userId: string) => {
          userIds.push(userId);
          return {
            data: initial.data,
            error: initial.error,
            isLoading: initial.isLoading ?? false,
            refetch,
          };
        },
      }),
    }),
  } as unknown as ProvisionalConsentApi;
  return {api, refetch, userIds};
};

describe("ProvisionalConsentSigner", () => {
  it("shows a spinner while statuses load", () => {
    const {api} = buildApi({isLoading: true});
    const {getByTestId, queryByTestId} = renderWithTheme(
      <ProvisionalConsentSigner api={api} userId="member-1" />
    );
    expect(getByTestId("provisional-consent-signer")).toBeTruthy();
    expect(getByTestId("provisional-consent-loading")).toBeTruthy();
    expect(queryByTestId("provisional-consent-row-form-pending")).toBeNull();
  });

  it("lists each form with its status for the target user", () => {
    const {api, userIds} = buildApi({data: {data: rows}});
    const {getByTestId, getByText} = renderWithTheme(
      <ProvisionalConsentSigner api={api} userId="member-1" />
    );

    expect(userIds).toContain("member-1");
    for (const row of rows) {
      expect(getByTestId(`provisional-consent-row-${row.form.id}`)).toBeTruthy();
      expect(getByText(row.form.title)).toBeTruthy();
    }
    expect(getByText("Pending")).toBeTruthy();
    expect(getByText(`Signed provisionally by Dana Rivera on ${formatted(signedAt)}`)).toBeTruthy();
    expect(getByText(`Signed by user on ${formatted(respondedAt)}`)).toBeTruthy();
    expect(getByText(`Declined by user on ${formatted(respondedAt)}`)).toBeTruthy();
    expect(getByTestId("provisional-consent-status-form-provisional")).toBeTruthy();
  });

  it("falls back to the signer's email, then to staff", () => {
    const byEmail: ProvisionalConsentStatusRow = {
      ...rows[1],
      provisional: {responseId: "r", signedAt, signedBy: {email: "dana@example.com", id: "s"}},
    };
    const deletedSigner: ProvisionalConsentStatusRow = {
      ...rows[1],
      form: makeForm("form-other", "Other"),
      provisional: {responseId: "r2", signedAt, signedBy: null},
    };
    const {api} = buildApi({data: [byEmail, deletedSigner]});
    const {getByText} = renderWithTheme(<ProvisionalConsentSigner api={api} userId="member-1" />);
    expect(
      getByText(`Signed provisionally by dana@example.com on ${formatted(signedAt)}`)
    ).toBeTruthy();
    expect(getByText(`Signed provisionally by staff on ${formatted(signedAt)}`)).toBeTruthy();
  });

  it("uses the form _id when the row has no id", () => {
    const {id: _omitted, ...formWithoutId} = makeForm("ignored", "Mongo id form");
    const row = {
      form: {...formWithoutId, _id: "mongo-id"},
      isConsented: false,
      status: "pending",
    } as unknown as ProvisionalConsentStatusRow;
    const {api} = buildApi({data: [row]});
    const {getByTestId} = renderWithTheme(<ProvisionalConsentSigner api={api} userId="member-1" />);
    expect(getByTestId("provisional-consent-row-mongo-id")).toBeTruthy();
  });

  it("leaves the date off when it is missing or invalid", () => {
    const {api} = buildApi({
      data: [
        {form: makeForm("no-date", "No date"), isConsented: true, status: "signed"},
        {
          form: makeForm("bad-date", "Bad date"),
          isConsented: false,
          respondedAt: "not-a-date",
          status: "declined",
        },
      ],
    });
    const {getByText} = renderWithTheme(<ProvisionalConsentSigner api={api} userId="member-1" />);
    expect(getByText("Signed by user")).toBeTruthy();
    expect(getByText("Declined by user")).toBeTruthy();
  });

  it("says so when no forms apply", () => {
    const {api} = buildApi({data: {data: []}});
    const {getByTestId} = renderWithTheme(<ProvisionalConsentSigner api={api} userId="member-1" />);
    expect(getByTestId("provisional-consent-empty")).toBeTruthy();
  });

  it("shows the server error with a Retry button that refetches", async () => {
    const {api, refetch} = buildApi({error: {data: {title: "Access denied"}, status: 405}});
    const {getByTestId, getByText} = renderWithTheme(
      <ProvisionalConsentSigner api={api} userId="member-1" />
    );
    expect(getByTestId("provisional-consent-error")).toBeTruthy();
    expect(getByText("Access denied")).toBeTruthy();

    act(() => {
      fireEvent.press(getByTestId("provisional-consent-retry-button"));
    });
    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a generic message when the error has no title", () => {
    const {api} = buildApi({error: {status: "FETCH_ERROR"}});
    const {getByText} = renderWithTheme(<ProvisionalConsentSigner api={api} userId="member-1" />);
    expect(getByText("Could not load consent forms.")).toBeTruthy();
  });
});
