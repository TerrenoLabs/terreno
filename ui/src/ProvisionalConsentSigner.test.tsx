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

/** A fake of the consumer's RTK api: the status query returns `initial`, signing runs `signResult`. */
const buildApi = (
  initial: QueryState,
  signResult: () => Promise<unknown> = () => Promise.resolve({})
): {
  api: ProvisionalConsentApi;
  refetch: ReturnType<typeof mock>;
  signedBodies: unknown[];
  userIds: string[];
} => {
  const refetch = mock(() => {});
  const userIds: string[] = [];
  const signedBodies: unknown[] = [];
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
        useSignConsentProvisionallyMutation: () => [
          (body: unknown) => {
            signedBodies.push(body);
            return {unwrap: signResult};
          },
          {isLoading: false},
        ],
      }),
    }),
  } as unknown as ProvisionalConsentApi;
  return {api, refetch, signedBodies, userIds};
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
  describe("signing on the user's behalf", () => {
    const openForm = async (
      getByTestId: (id: string) => unknown,
      formId: string
    ): Promise<void> => {
      act(() => {
        fireEvent.press(getByTestId(`provisional-consent-open-${formId}`) as never);
      });
      await waitFor(() => {
        expect(getByTestId("provisional-consent-note-input")).toBeTruthy();
      });
    };

    const withContent = (
      row: ProvisionalConsentStatusRow,
      content: string
    ): ProvisionalConsentStatusRow => ({
      ...row,
      form: {...row.form, content: {en: content}},
    });

    it("offers signing only for pending and declined forms", () => {
      const {api} = buildApi({data: rows});
      const {getByTestId, queryByTestId} = renderWithTheme(
        <ProvisionalConsentSigner api={api} userId="member-1" />
      );
      expect(getByTestId("provisional-consent-open-form-pending")).toBeTruthy();
      expect(getByTestId("provisional-consent-open-form-declined")).toBeTruthy();
      expect(queryByTestId("provisional-consent-open-form-provisional")).toBeNull();
      expect(queryByTestId("provisional-consent-open-form-signed")).toBeNull();
    });

    it("shows the form content with variables and keeps submit disabled until a note is entered", async () => {
      const {api} = buildApi({data: [withContent(rows[0], "Hello {{memberName}}, please agree.")]});
      const {getByTestId, getByText} = renderWithTheme(
        <ProvisionalConsentSigner api={api} userId="member-1" variables={{memberName: "Sam"}} />
      );

      await openForm(getByTestId, "form-pending");
      await waitFor(() => {
        expect(getByText("Hello Sam, please agree.")).toBeTruthy();
      });
      expect(getByTestId("provisional-consent-note-input")).toBeTruthy();
      const submit = (): {props: {accessibilityState?: {disabled?: boolean}}} =>
        getByTestId("provisional-consent-submit-button");
      expect(submit().props.accessibilityState?.disabled).toBe(true);

      act(() => {
        fireEvent.changeText(getByTestId("provisional-consent-note-input"), "   ");
      });
      expect(submit().props.accessibilityState?.disabled).toBe(true);

      act(() => {
        fireEvent.changeText(getByTestId("provisional-consent-note-input"), "Guardian by phone");
      });
      expect(submit().props.accessibilityState?.disabled).toBe(false);
    });

    it("posts the note, shows who signed and when, and calls onSigned", async () => {
      const response = {
        _id: "response-9",
        agreedAt: signedAt,
        consentFormId: "form-pending",
        provisional: true,
        provisionalSignedBy: {_id: "staff-1", email: "dana@example.com", name: "Dana Rivera"},
        userId: "member-1",
      };
      const onSigned = mock(() => {});
      const {api, signedBodies} = buildApi({data: [rows[0]]}, () =>
        Promise.resolve({data: response})
      );
      const {getByTestId, getByText, queryByTestId} = renderWithTheme(
        <ProvisionalConsentSigner api={api} onSigned={onSigned} userId="member-1" />
      );

      await openForm(getByTestId, "form-pending");
      act(() => {
        fireEvent.changeText(
          getByTestId("provisional-consent-note-input"),
          "  Guardian agreed by phone  "
        );
      });
      act(() => {
        fireEvent.press(getByTestId("provisional-consent-submit-button"));
      });

      await waitFor(() => {
        expect(getByTestId("provisional-consent-success")).toBeTruthy();
      });
      expect(signedBodies).toEqual([
        {
          consentFormId: "form-pending",
          locale: "en",
          note: "Guardian agreed by phone",
          userId: "member-1",
        },
      ]);
      expect(
        getByText(`Telehealth signed provisionally by Dana Rivera on ${formatted(signedAt)}`)
      ).toBeTruthy();
      expect(onSigned).toHaveBeenCalledWith(response);
      expect(queryByTestId("provisional-consent-note-input")).toBeNull();
    });

    it("shows a server error inline and calls onError", async () => {
      const serverError = {data: {title: "Consent form is not active"}, status: 400};
      const onError = mock(() => {});
      const {api} = buildApi({data: [rows[0]]}, () => Promise.reject(serverError));
      const {getByTestId, getByText, queryByTestId} = renderWithTheme(
        <ProvisionalConsentSigner api={api} onError={onError} userId="member-1" />
      );

      await openForm(getByTestId, "form-pending");
      act(() => {
        fireEvent.changeText(getByTestId("provisional-consent-note-input"), "Phone");
      });
      act(() => {
        fireEvent.press(getByTestId("provisional-consent-submit-button"));
      });

      await waitFor(() => {
        expect(getByTestId("provisional-consent-submit-error")).toBeTruthy();
      });
      expect(getByText("Consent form is not active")).toBeTruthy();
      expect(onError).toHaveBeenCalledWith(serverError);
      expect(queryByTestId("provisional-consent-success")).toBeNull();
      expect(getByTestId("provisional-consent-note-input")).toBeTruthy();
    });

    it("shows a generic error when the server gives no title", async () => {
      const {api} = buildApi({data: [rows[0]]}, () => Promise.reject({status: "FETCH_ERROR"}));
      const {getByTestId, getByText} = renderWithTheme(
        <ProvisionalConsentSigner api={api} userId="member-1" />
      );
      await openForm(getByTestId, "form-pending");
      act(() => {
        fireEvent.changeText(getByTestId("provisional-consent-note-input"), "Phone");
      });
      act(() => {
        fireEvent.press(getByTestId("provisional-consent-submit-button"));
      });
      await waitFor(() => {
        expect(getByText("Could not sign the form.")).toBeTruthy();
      });
    });

    it("returns to the list on cancel without signing", async () => {
      const {api, signedBodies} = buildApi({data: [rows[0]]});
      const {getByTestId, queryByTestId} = renderWithTheme(
        <ProvisionalConsentSigner api={api} userId="member-1" />
      );
      await openForm(getByTestId, "form-pending");
      act(() => {
        fireEvent.press(getByTestId("provisional-consent-cancel-button"));
      });
      await waitFor(() => {
        expect(getByTestId("provisional-consent-row-form-pending")).toBeTruthy();
      });
      expect(queryByTestId("provisional-consent-note-input")).toBeNull();
      expect(signedBodies).toEqual([]);
    });

    it("names the signer as staff when the response is not populated", async () => {
      const {api} = buildApi({data: [rows[0]]}, () =>
        Promise.resolve({_id: "r", agreedAt: signedAt, provisionalSignedBy: "staff-1"})
      );
      const {getByTestId, getByText} = renderWithTheme(
        <ProvisionalConsentSigner api={api} userId="member-1" />
      );
      await openForm(getByTestId, "form-pending");
      act(() => {
        fireEvent.changeText(getByTestId("provisional-consent-note-input"), "Phone");
      });
      act(() => {
        fireEvent.press(getByTestId("provisional-consent-submit-button"));
      });
      await waitFor(() => {
        expect(
          getByText(`Telehealth signed provisionally by staff on ${formatted(signedAt)}`)
        ).toBeTruthy();
      });
    });
  });
});
