import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import type React from "react";
import {Pressable} from "react-native";
import {Box} from "./Box";
import {ConsentNavigator} from "./ConsentNavigator";
import {Text} from "./Text";
import {createFakeRequestClient, fakeHttpError, renderWithTheme} from "./test-utils";
import type {ConsentFormPublic} from "./useConsentForms";

const makeForm = (overrides: Partial<ConsentFormPublic> = {}): ConsentFormPublic => ({
  active: true,
  agreeButtonText: "I Agree",
  allowDecline: false,
  captureSignature: false,
  checkboxes: [],
  content: {en: "# Terms\n\nPlease read these terms."},
  declineButtonText: "Decline",
  defaultLocale: "en",
  id: "form-1",
  order: 1,
  required: true,
  requireScrollToBottom: false,
  slug: "tos",
  title: "Terms of Service",
  type: "terms",
  version: 1,
  ...overrides,
});

/** Fake client serving `forms` from GET /consents/pending; submissions remove the form. */
const createConsentClient = (
  initialForms: ConsentFormPublic[],
  {
    pending,
    respond,
  }: {
    pending?: () => unknown;
    respond?: (body: Record<string, unknown>) => unknown;
  } = {}
): ReturnType<typeof createFakeRequestClient> & {forms: () => ConsentFormPublic[]} => {
  let forms = [...initialForms];
  const fake = createFakeRequestClient({
    "GET /consents/pending": () => (pending ? pending() : {data: forms}),
    "POST /consents/respond": (args) => {
      const body = (args.body ?? {}) as Record<string, unknown>;
      if (respond) {
        return respond(body);
      }
      forms = forms.filter((form) => form.id !== body.consentFormId);
      return {agreed: body.agreed, id: "response-1"};
    },
  });
  return {...fake, forms: () => forms};
};

const renderNavigator = async (
  element: React.ReactElement
): Promise<ReturnType<typeof renderWithTheme>> => {
  const result = renderWithTheme(element);
  await waitFor(() => expect(result.queryByTestId("consent-navigator-loading")).toBeNull());
  return result;
};

const ExtraScreen: React.FC<{onNext?: () => void}> = ({onNext}) => (
  <Box testID="extra-screen">
    <Text>Extra Screen Content</Text>
    <Pressable onPress={onNext} testID="extra-screen-next">
      <Text>Next</Text>
    </Pressable>
  </Box>
);

describe("ConsentNavigator", () => {
  it("renders children when there are no pending consent forms", async () => {
    const {client} = createConsentClient([]);
    const {getByText} = await renderNavigator(
      <ConsentNavigator client={client}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(getByText("App Content")).toBeTruthy();
  });

  it("shows ConsentFormScreen when there are pending forms", async () => {
    const {client} = createConsentClient([makeForm()]);

    const {getByTestId} = await renderNavigator(
      <ConsentNavigator client={client}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    // The agree button is rendered inside ConsentFormScreen
    expect(getByTestId("consent-form-agree-button")).toBeTruthy();
  });

  it("requests pending consents under baseUrl", async () => {
    const {client, calls} = createFakeRequestClient({
      "GET /api/consents/pending": () => [],
    });
    const {getByText} = await renderNavigator(
      <ConsentNavigator baseUrl="/api" client={client}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );
    expect(getByText("App Content")).toBeTruthy();
    expect(calls[0]?.url).toBe("/api/consents/pending");
  });

  it("shows loading spinner while fetching consent forms", () => {
    const {client} = createConsentClient([], {pending: () => new Promise(() => {})});

    const {getByTestId} = renderWithTheme(
      <ConsentNavigator client={client}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(getByTestId("consent-navigator-loading")).toBeTruthy();
  });

  it("shows extra screens after consent forms are completed", async () => {
    const {client} = createConsentClient([]);

    const {getByTestId, queryByText} = await renderNavigator(
      <ConsentNavigator client={client} extraScreens={[<ExtraScreen key="extra" />]}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(getByTestId("extra-screen")).toBeTruthy();
    expect(queryByText("App Content")).toBeNull();
  });

  it("shows children after all extra screens are dismissed", async () => {
    const {client} = createConsentClient([]);

    const {getByTestId, getByText} = await renderNavigator(
      <ConsentNavigator client={client} extraScreens={[<ExtraScreen key="extra" />]}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(getByTestId("extra-screen")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("extra-screen-next"));
    });
    await waitFor(() => {
      expect(getByText("App Content")).toBeTruthy();
    });
  });

  it("injects onNext prop into extra screen elements", async () => {
    const {client} = createConsentClient([]);

    const {getByTestId} = await renderNavigator(
      <ConsentNavigator client={client} extraScreens={[<ExtraScreen key="extra" />]}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    // The extra screen should have a working next button (onNext was injected)
    expect(getByTestId("extra-screen-next")).toBeTruthy();
  });

  it("renders children when error is auth (401)", async () => {
    const onError = mock(() => {});
    const {client} = createConsentClient([], {
      pending: () => {
        throw fakeHttpError(401);
      },
    });

    const {getByText} = await renderNavigator(
      <ConsentNavigator client={client} onError={onError}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );
    await waitFor(() => expect(getByText("App Content")).toBeTruthy());
    expect(onError).not.toHaveBeenCalled();
  });

  it("renders children when error is auth (403 originalStatus)", async () => {
    const {client} = createConsentClient([], {
      pending: () => {
        throw Object.assign(new Error("Forbidden"), {originalStatus: 403});
      },
    });

    const {getByText} = await renderNavigator(
      <ConsentNavigator client={client}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );
    await waitFor(() => expect(getByText("App Content")).toBeTruthy());
  });

  it("renders error screen with retry button for non-auth errors", async () => {
    const onError = mock(() => {});
    let shouldFail = true;
    const {client, callsTo} = createConsentClient([], {
      pending: () => {
        if (shouldFail) {
          throw fakeHttpError(500, "Server error");
        }
        return [];
      },
    });

    const {getByTestId, getByText} = await renderNavigator(
      <ConsentNavigator client={client} onError={onError}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );
    await waitFor(() => expect(getByTestId("consent-navigator-error")).toBeTruthy());
    expect(getByText("Failed to load consent forms")).toBeTruthy();
    expect(onError).toHaveBeenCalled();

    shouldFail = false;
    await act(async () => {
      fireEvent.press(getByText("Retry"));
    });
    await waitFor(() => expect(getByText("App Content")).toBeTruthy());
    expect(callsTo("GET /consents/pending")).toHaveLength(2);
  });

  it("submits and shows the app once the last form is agreed to", async () => {
    const {client, callsTo} = createConsentClient([makeForm()]);

    const {getByTestId, getByText} = await renderNavigator(
      <ConsentNavigator client={client}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    await act(async () => {
      fireEvent.press(getByTestId("consent-form-agree-button"));
    });

    await waitFor(() => expect(getByText("App Content")).toBeTruthy());
    const [submission] = callsTo("POST /consents/respond");
    expect(submission?.body).toMatchObject({agreed: true, consentFormId: "form-1"});
    // One initial load plus one refetch: the post-submit invalidation and the explicit
    // refetch share a request.
    expect(callsTo("GET /consents/pending")).toHaveLength(2);
  });

  it("advances to the next pending form after agreeing", async () => {
    const {client} = createConsentClient([
      makeForm(),
      makeForm({id: "form-2", slug: "privacy", title: "Privacy Policy"}),
    ]);

    const {getByTestId, findByText} = await renderNavigator(
      <ConsentNavigator client={client}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    await act(async () => {
      fireEvent.press(getByTestId("consent-form-agree-button"));
    });

    expect(await findByText("Privacy Policy")).toBeTruthy();
  });

  it("invokes onError when consent submission fails on agree", async () => {
    const onError = mock(() => {});
    const submitError = fakeHttpError(500, "submit failed");
    const {client, callsTo} = createConsentClient([makeForm()], {
      respond: () => {
        throw submitError;
      },
    });

    const {getByTestId} = await renderNavigator(
      <ConsentNavigator client={client} onError={onError}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    await act(async () => {
      fireEvent.press(getByTestId("consent-form-agree-button"));
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(submitError));
    expect(callsTo("GET /consents/pending")).toHaveLength(1);
  });

  it("calls submit with agreed=false when user declines an optional consent form", async () => {
    const {client, callsTo} = createConsentClient([
      makeForm({allowDecline: true, required: false}),
    ]);

    const {getByTestId, getByText} = await renderNavigator(
      <ConsentNavigator client={client}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    await act(async () => {
      fireEvent.press(getByTestId("consent-form-decline-button"));
    });
    await waitFor(() => expect(getByText("App Content")).toBeTruthy());
    expect(callsTo("POST /consents/respond")[0]?.body).toMatchObject({
      agreed: false,
      consentFormId: "form-1",
    });
  });

  it("invokes onError when consent submission fails on decline", async () => {
    const onError = mock(() => {});
    const declineError = fakeHttpError(500, "decline failed");
    const {client, callsTo} = createConsentClient(
      [makeForm({allowDecline: true, required: false})],
      {
        respond: () => {
          throw declineError;
        },
      }
    );

    const {getByTestId} = await renderNavigator(
      <ConsentNavigator client={client} onError={onError}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    await act(async () => {
      fireEvent.press(getByTestId("consent-form-decline-button"));
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(declineError));
    expect(callsTo("GET /consents/pending")).toHaveLength(1);
  });

  it("renders non-element extra screens as-is without injecting onNext", async () => {
    const {client} = createConsentClient([]);

    const {queryByText, toJSON} = await renderNavigator(
      <ConsentNavigator client={client} extraScreens={[null]}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(toJSON()).toBeNull();
    expect(queryByText("App Content")).toBeNull();
  });
});
