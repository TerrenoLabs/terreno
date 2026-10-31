import {afterEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {DateTime} from "luxon";
import type React from "react";
import {ProvisionalConsentSigner} from "./ProvisionalConsentSigner";
import * as pdfHtmlTemplate from "./pdfHtmlTemplate";
import type {TerrenoRequestClient} from "./requestClient";
import {createFakeRequestClient, renderWithTheme} from "./test-utils";
import type {ConsentFormPublic} from "./useConsentForms";
import type {ProvisionalConsentStatusRow} from "./useProvisionalConsent";

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

/**
 * A fake request client: the status route answers `initial` (hangs while `isLoading`, rejects
 * with `error`), signing runs `signResult`, voiding runs `voidResult`. `refetch` is called for
 * every status request after the first.
 */
const buildApi = (
  initial: QueryState,
  signResult: () => Promise<unknown> = () => Promise.resolve({}),
  voidResult: () => Promise<unknown> = () => Promise.resolve({})
): {
  client: TerrenoRequestClient;
  refetch: ReturnType<typeof mock>;
  signedBodies: unknown[];
  userIds: string[];
  voidedArgs: unknown[];
} => {
  const refetch = mock(() => {});
  const userIds: string[] = [];
  const signedBodies: unknown[] = [];
  const voidedArgs: unknown[] = [];
  const fake = createFakeRequestClient({
    "GET /consent-responses/status": async (args) => {
      if (userIds.length > 0) {
        refetch();
      }
      userIds.push(String(args.params?.userId));
      if (initial.isLoading) {
        return new Promise(() => {});
      }
      if (initial.error) {
        throw initial.error;
      }
      return initial.data;
    },
    "POST /consent-responses/:id/void": async (args, params) => {
      voidedArgs.push({reason: (args.body as {reason: string}).reason, responseId: params.id});
      return voidResult();
    },
    "POST /consent-responses/provisional": async (args) => {
      signedBodies.push(args.body);
      return signResult();
    },
  });
  return {client: fake.client, refetch, signedBodies, userIds, voidedArgs};
};

/** Renders the component and waits for the status request to settle. */
const renderLoaded = async (
  element: React.ReactElement
): Promise<ReturnType<typeof renderWithTheme>> => {
  const result = renderWithTheme(element);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
};

describe("ProvisionalConsentSigner", () => {
  it("shows a spinner while statuses load", async () => {
    const {client} = buildApi({isLoading: true});
    const {getByTestId, queryByTestId} = await renderLoaded(
      <ProvisionalConsentSigner client={client} userId="member-1" />
    );
    expect(getByTestId("provisional-consent-signer")).toBeTruthy();
    expect(getByTestId("provisional-consent-loading")).toBeTruthy();
    expect(queryByTestId("provisional-consent-row-form-pending")).toBeNull();
  });

  it("lists each form with its status for the target user", async () => {
    const {client, userIds} = buildApi({data: {data: rows}});
    const {getByTestId, getByText} = await renderLoaded(
      <ProvisionalConsentSigner client={client} userId="member-1" />
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

  it("falls back to the signer's email, then to staff", async () => {
    const byEmail: ProvisionalConsentStatusRow = {
      ...rows[1],
      provisional: {responseId: "r", signedAt, signedBy: {email: "dana@example.com", id: "s"}},
    };
    const deletedSigner: ProvisionalConsentStatusRow = {
      ...rows[1],
      form: makeForm("form-other", "Other"),
      provisional: {responseId: "r2", signedAt, signedBy: null},
    };
    const {client} = buildApi({data: [byEmail, deletedSigner]});
    const {getByText} = await renderLoaded(
      <ProvisionalConsentSigner client={client} userId="member-1" />
    );
    expect(
      getByText(`Signed provisionally by dana@example.com on ${formatted(signedAt)}`)
    ).toBeTruthy();
    expect(getByText(`Signed provisionally by Staff on ${formatted(signedAt)}`)).toBeTruthy();
  });

  it("uses the form _id when the row has no id", async () => {
    const {id: _omitted, ...formWithoutId} = makeForm("ignored", "Mongo id form");
    const row = {
      form: {...formWithoutId, _id: "mongo-id"},
      isConsented: false,
      status: "pending",
    } as unknown as ProvisionalConsentStatusRow;
    const {client} = buildApi({data: [row]});
    const {getByTestId} = await renderLoaded(
      <ProvisionalConsentSigner client={client} userId="member-1" />
    );
    expect(getByTestId("provisional-consent-row-mongo-id")).toBeTruthy();
  });

  it("leaves the date off when it is missing or invalid", async () => {
    const {client} = buildApi({
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
    const {getByText} = await renderLoaded(
      <ProvisionalConsentSigner client={client} userId="member-1" />
    );
    expect(getByText("Signed by user")).toBeTruthy();
    expect(getByText("Declined by user")).toBeTruthy();
  });

  it("says so when no forms apply", async () => {
    const {client} = buildApi({data: {data: []}});
    const {getByTestId} = await renderLoaded(
      <ProvisionalConsentSigner client={client} userId="member-1" />
    );
    expect(getByTestId("provisional-consent-empty")).toBeTruthy();
  });

  it("shows the server error with a Retry button that refetches", async () => {
    const {client, refetch} = buildApi({error: {data: {title: "Access denied"}, status: 405}});
    const {getByTestId, getByText} = await renderLoaded(
      <ProvisionalConsentSigner client={client} userId="member-1" />
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

  it("shows a generic message when the error has no title", async () => {
    const {client} = buildApi({error: {status: "FETCH_ERROR"}});
    const {getByText} = await renderLoaded(
      <ProvisionalConsentSigner client={client} userId="member-1" />
    );
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

    it("offers signing only for pending forms", async () => {
      const {client} = buildApi({data: rows});
      const {getByTestId, queryByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );
      expect(getByTestId("provisional-consent-open-form-pending")).toBeTruthy();
      expect(queryByTestId("provisional-consent-open-form-declined")).toBeNull();
      expect(queryByTestId("provisional-consent-open-form-provisional")).toBeNull();
      expect(queryByTestId("provisional-consent-open-form-signed")).toBeNull();
    });

    it("shows the form content with variables and keeps submit disabled until a note is entered", async () => {
      const {client} = buildApi({
        data: [withContent(rows[0], "Hello {{memberName}}, please agree.")],
      });
      const {getByTestId, getByText} = await renderLoaded(
        <ProvisionalConsentSigner
          client={client}
          userId="member-1"
          variables={{memberName: "Sam"}}
        />
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
      const {client, signedBodies} = buildApi({data: [rows[0]]}, () =>
        Promise.resolve({data: response})
      );
      const {getByTestId, getByText, queryByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} onSigned={onSigned} userId="member-1" />
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
      const {client} = buildApi({data: [rows[0]]}, () => Promise.reject(serverError));
      const {getByTestId, getByText, queryByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} onError={onError} userId="member-1" />
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
      const {client} = buildApi({data: [rows[0]]}, () => Promise.reject({status: "FETCH_ERROR"}));
      const {getByTestId, getByText} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
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
      const {client, signedBodies} = buildApi({data: [rows[0]]});
      const {getByTestId, queryByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
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
      const {client} = buildApi({data: [rows[0]]}, () =>
        Promise.resolve({_id: "r", agreedAt: signedAt, provisionalSignedBy: "staff-1"})
      );
      const {getByTestId, getByText} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
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
          getByText(`Telehealth signed provisionally by Staff on ${formatted(signedAt)}`)
        ).toBeTruthy();
      });
    });
  });
  describe("printing and voiding", () => {
    const printed: string[] = [];
    let printSpy: ReturnType<typeof spyOn> | undefined;

    const spyOnPrint = (impl: () => Promise<void> = () => Promise.resolve()): void => {
      printed.length = 0;
      printSpy = spyOn(pdfHtmlTemplate, "printConsentHtml").mockImplementation(
        async ({html}: {html: string}) => {
          printed.push(html);
          return impl();
        }
      );
    };

    afterEach(() => {
      printSpy?.mockRestore();
      printSpy = undefined;
    });

    const press = async (getByTestId: (id: string) => unknown, id: string): Promise<void> => {
      await act(async () => {
        fireEvent.press(getByTestId(id) as never);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    };

    it("offers print on provisional, signed, and declined rows, and void on provisional only", async () => {
      const {client} = buildApi({data: rows});
      const {getByTestId, queryByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );
      expect(queryByTestId("provisional-consent-print-form-pending")).toBeNull();
      expect(getByTestId("provisional-consent-print-form-provisional")).toBeTruthy();
      expect(getByTestId("provisional-consent-print-form-signed")).toBeTruthy();
      expect(getByTestId("provisional-consent-print-form-declined")).toBeTruthy();
      expect(getByTestId("provisional-consent-void-form-provisional")).toBeTruthy();
      expect(queryByTestId("provisional-consent-void-form-signed")).toBeNull();
      expect(queryByTestId("provisional-consent-void-form-declined")).toBeNull();
    });

    it("prints a provisional row with the form content and the provisional block with the note", async () => {
      spyOnPrint();
      const {client} = buildApi({data: rows});
      const {getByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );

      await press(getByTestId, "provisional-consent-print-form-provisional");

      expect(printed).toHaveLength(1);
      expect(printed[0]).toContain("# Treatment");
      expect(printed[0]).toContain("<h2>Provisional signature</h2>");
      expect(printed[0]).toContain("Dana Rivera");
      expect(printed[0]).toContain("Guardian agreed by phone");
    });

    it("prints a signed row without a provisional block", async () => {
      spyOnPrint();
      const {client} = buildApi({data: rows});
      const {getByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );

      await press(getByTestId, "provisional-consent-print-form-signed");

      expect(printed).toHaveLength(1);
      expect(printed[0]).toContain("# Privacy");
      expect(printed[0]).toContain(`Signed by user on ${formatted(respondedAt)}`);
      expect(printed[0]).not.toContain("Provisional signature");
    });

    it("keeps working when printing fails", async () => {
      spyOnPrint(() => Promise.reject(new Error("printer offline")));
      const {client} = buildApi({data: rows});
      const {getByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );
      await press(getByTestId, "provisional-consent-print-form-declined");
      expect(printed).toHaveLength(1);
      expect(getByTestId("provisional-consent-row-form-declined")).toBeTruthy();
    });

    it("prints the just-signed form from the success state", async () => {
      spyOnPrint();
      const response = {
        _id: "response-9",
        agreedAt: signedAt,
        provisionalNote: "Guardian agreed by phone",
        provisionalSignedBy: {_id: "staff-1", name: "Dana Rivera"},
      };
      const {client} = buildApi({data: [rows[0]]}, () => Promise.resolve({data: response}));
      const {getByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );
      await press(getByTestId, "provisional-consent-open-form-pending");
      act(() => {
        fireEvent.changeText(
          getByTestId("provisional-consent-note-input"),
          "Guardian agreed by phone"
        );
      });
      await press(getByTestId, "provisional-consent-submit-button");
      await waitFor(() => {
        expect(getByTestId("provisional-consent-success")).toBeTruthy();
      });

      await press(getByTestId, "provisional-consent-success-print");

      expect(printed).toHaveLength(1);
      expect(printed[0]).toContain("# Telehealth");
      expect(printed[0]).toContain("<h2>Provisional signature</h2>");
      expect(printed[0]).toContain("Guardian agreed by phone");
      expect(printed[0]).toContain("response-9");
    });

    it("voids with a required reason and refetches", async () => {
      const {client, refetch, voidedArgs} = buildApi({data: rows});
      const {getByTestId} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );

      await press(getByTestId, "provisional-consent-void-form-provisional");
      await waitFor(() => {
        expect(getByTestId("provisional-consent-void-reason-input")).toBeTruthy();
      });
      const confirm = (): {props: {accessibilityState?: {disabled?: boolean}}} =>
        getByTestId("provisional-consent-void-modal.primary") as never;
      expect(confirm().props.accessibilityState?.disabled).toBe(true);

      act(() => {
        fireEvent.changeText(
          getByTestId("provisional-consent-void-reason-input"),
          " Wrong member "
        );
      });
      expect(confirm().props.accessibilityState?.disabled).toBe(false);
      await press(getByTestId, "provisional-consent-void-modal.primary");

      await waitFor(() => {
        expect(voidedArgs).toEqual([{reason: "Wrong member", responseId: "response-1"}]);
      });
      await waitFor(() => {
        expect(refetch).toHaveBeenCalled();
      });
    });

    it("closes the void dialog on cancel without voiding", async () => {
      const {client, refetch, voidedArgs} = buildApi({data: rows});
      const {getByTestId, UNSAFE_getByProps} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );

      await press(getByTestId, "provisional-consent-void-form-provisional");
      expect(UNSAFE_getByProps({testID: "provisional-consent-void-modal"}).props.visible).toBe(
        true
      );
      await press(getByTestId, "provisional-consent-void-modal.secondary");

      expect(UNSAFE_getByProps({testID: "provisional-consent-void-modal"}).props.visible).toBe(
        false
      );
      expect(voidedArgs).toEqual([]);
      expect(refetch).not.toHaveBeenCalled();
    });

    it("does not void without a reason even if the confirm handler runs", async () => {
      const {client, voidedArgs} = buildApi({data: rows});
      const {getByTestId, UNSAFE_getByProps} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );

      await press(getByTestId, "provisional-consent-void-form-provisional");
      await act(async () => {
        await UNSAFE_getByProps({
          testID: "provisional-consent-void-modal",
        }).props.primaryButtonOnClick();
      });

      expect(voidedArgs).toEqual([]);
    });

    it("does not sign without a note even if the submit handler runs", async () => {
      const {client, signedBodies} = buildApi({data: [rows[0]]});
      const {getByTestId, UNSAFE_getByProps} = await renderLoaded(
        <ProvisionalConsentSigner client={client} userId="member-1" />
      );

      await press(getByTestId, "provisional-consent-open-form-pending");
      await act(async () => {
        await UNSAFE_getByProps({
          testID: "provisional-consent-submit-button",
          text: "Sign provisionally",
        }).props.onClick();
      });

      expect(signedBodies).toEqual([]);
      expect(getByTestId("provisional-consent-note-input")).toBeTruthy();
    });

    it("shows a void error in the dialog and calls onError", async () => {
      const failure = {data: {title: "Provisional signature is already voided"}, status: 400};
      const onError = mock(() => {});
      const {client, refetch} = buildApi({data: rows}, undefined, () => Promise.reject(failure));
      const {getByTestId, getByText} = await renderLoaded(
        <ProvisionalConsentSigner client={client} onError={onError} userId="member-1" />
      );

      await press(getByTestId, "provisional-consent-void-form-provisional");
      await waitFor(() => {
        expect(getByTestId("provisional-consent-void-reason-input")).toBeTruthy();
      });
      act(() => {
        fireEvent.changeText(getByTestId("provisional-consent-void-reason-input"), "Wrong member");
      });
      await press(getByTestId, "provisional-consent-void-modal.primary");

      await waitFor(() => {
        expect(getByText("Provisional signature is already voided")).toBeTruthy();
      });
      expect(onError).toHaveBeenCalledWith(failure);
      expect(refetch).not.toHaveBeenCalled();
    });
  });
});
