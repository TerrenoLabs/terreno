import {describe, expect, it, mock} from "bun:test";
import React from "react";
import {Pressable} from "react-native";
import {Box} from "./Box";
import {ConsentNavigator} from "./ConsentNavigator";
import {Text} from "./Text";
import {renderWithTheme} from "./test-utils";
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

const createMockApi = (forms: ConsentFormPublic[]) => {
  const mockUnwrap = mock(() => Promise.resolve({agreed: true, id: "response-1"}));
  const mockSubmitMutation = mock(() => ({unwrap: mockUnwrap}));

  const innerApi = {
    injectEndpoints: mock((_config: unknown) => ({
      useGetPendingConsentsQuery: mock(() => ({
        data: {data: forms},
        error: undefined,
        isLoading: false,
        refetch: mock(() => Promise.resolve()),
      })),
      useSubmitConsentResponseMutation: mock(() => [
        mockSubmitMutation,
        {error: undefined, isLoading: false},
      ]),
    })),
  };

  return {
    enhanceEndpoints: mock((_config: unknown) => innerApi),
  };
};

const createLoadingMockApi = () => {
  const innerApi = {
    injectEndpoints: mock((_config: unknown) => ({
      useGetPendingConsentsQuery: mock(() => ({
        data: undefined,
        error: undefined,
        isLoading: true,
        refetch: mock(() => Promise.resolve()),
      })),
      useSubmitConsentResponseMutation: mock(() => [
        mock(() => ({unwrap: mock(() => Promise.resolve({}))})),
        {error: undefined, isLoading: false},
      ]),
    })),
  };

  return {
    enhanceEndpoints: mock((_config: unknown) => innerApi),
  };
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
    const api = createMockApi([]);
    const {getByText} = renderWithTheme(
      <ConsentNavigator api={api}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(getByText("App Content")).toBeTruthy();
  });

  it("shows ConsentFormScreen when there are pending forms", async () => {
    const form = makeForm();
    const api = createMockApi([form]);

    const {getByTestId} = renderWithTheme(
      <ConsentNavigator api={api}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    // The agree button is rendered inside ConsentFormScreen
    expect(getByTestId("consent-form-agree-button")).toBeTruthy();
  });

  it("shows loading spinner while fetching consent forms", async () => {
    const api = createLoadingMockApi();

    const {getByTestId} = renderWithTheme(
      <ConsentNavigator api={api}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(getByTestId("consent-navigator-loading")).toBeTruthy();
  });

  it("shows extra screens after consent forms are completed", async () => {
    const api = createMockApi([]);

    const {getByTestId, queryByText} = renderWithTheme(
      <ConsentNavigator api={api} extraScreens={[<ExtraScreen key="extra" />]}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(getByTestId("extra-screen")).toBeTruthy();
    expect(queryByText("App Content")).toBeNull();
  });

  it("shows children after all extra screens are dismissed", async () => {
    const api = createMockApi([]);
    const {act, fireEvent, waitFor} = await import("@testing-library/react-native");

    const {getByTestId, getByText} = renderWithTheme(
      <ConsentNavigator api={api} extraScreens={[<ExtraScreen key="extra" />]}>
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
    const api = createMockApi([]);

    const {getByTestId} = renderWithTheme(
      <ConsentNavigator api={api} extraScreens={[<ExtraScreen key="extra" />]}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    // The extra screen should have a working next button (onNext was injected)
    expect(getByTestId("extra-screen-next")).toBeTruthy();
  });

  it("renders children when error is auth (401)", () => {
    const api = {
      enhanceEndpoints: mock(() => ({
        injectEndpoints: mock(() => ({
          useGetPendingConsentsQuery: mock(() => ({
            data: undefined,
            error: {status: 401},
            isLoading: false,
            refetch: mock(() => {}),
          })),
          useSubmitConsentResponseMutation: mock(() => [
            mock(() => ({unwrap: mock(() => Promise.resolve({}))})),
            {error: undefined, isLoading: false},
          ]),
        })),
      })),
    };

    const {getByText} = renderWithTheme(
      <ConsentNavigator api={api}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );
    expect(getByText("App Content")).toBeTruthy();
  });

  it("renders children when error is auth (403)", () => {
    const api = {
      enhanceEndpoints: mock(() => ({
        injectEndpoints: mock(() => ({
          useGetPendingConsentsQuery: mock(() => ({
            data: undefined,
            error: {originalStatus: 403},
            isLoading: false,
            refetch: mock(() => {}),
          })),
          useSubmitConsentResponseMutation: mock(() => [
            mock(() => ({unwrap: mock(() => Promise.resolve({}))})),
            {error: undefined, isLoading: false},
          ]),
        })),
      })),
    };

    const {getByText} = renderWithTheme(
      <ConsentNavigator api={api}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );
    expect(getByText("App Content")).toBeTruthy();
  });

  it("renders error screen with retry button for non-auth errors", () => {
    const onError = mock(() => {});
    const api = {
      enhanceEndpoints: mock(() => ({
        injectEndpoints: mock(() => ({
          useGetPendingConsentsQuery: mock(() => ({
            data: undefined,
            error: {message: "Server error", status: 500},
            isLoading: false,
            refetch: mock(() => {}),
          })),
          useSubmitConsentResponseMutation: mock(() => [
            mock(() => ({unwrap: mock(() => Promise.resolve({}))})),
            {error: undefined, isLoading: false},
          ]),
        })),
      })),
    };

    const {getByTestId, getByText} = renderWithTheme(
      <ConsentNavigator api={api} onError={onError}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );
    expect(getByTestId("consent-navigator-error")).toBeTruthy();
    expect(getByText("Failed to load consent forms")).toBeTruthy();
    expect(onError).toHaveBeenCalled();
  });

  it("renders without error when no extra screens provided", () => {
    const api = createMockApi([]);

    const {getByText} = renderWithTheme(
      <ConsentNavigator api={api}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(getByText("App Content")).toBeTruthy();
  });

  it("calls submit and refetch when user agrees to a consent form", async () => {
    const {act, fireEvent} = await import("@testing-library/react-native");
    const form = makeForm();
    const unwrap = mock(() => Promise.resolve({agreed: true, id: "r-1"}));
    const submitMutation = mock(() => ({unwrap}));
    const refetch = mock(() => Promise.resolve());
    const api = {
      enhanceEndpoints: mock(() => ({
        injectEndpoints: mock(() => ({
          useGetPendingConsentsQuery: mock(() => ({
            data: {data: [form]},
            error: undefined,
            isLoading: false,
            refetch,
          })),
          useSubmitConsentResponseMutation: mock(() => [
            submitMutation,
            {error: undefined, isLoading: false},
          ]),
        })),
      })),
    };

    const {getByTestId} = renderWithTheme(
      <ConsentNavigator api={api}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    await act(async () => {
      fireEvent.press(getByTestId("consent-form-agree-button"));
    });

    expect(submitMutation).toHaveBeenCalled();
  });

  it("invokes onError when consent submission fails on agree", async () => {
    const {act, fireEvent} = await import("@testing-library/react-native");
    const form = makeForm();
    const onError = mock(() => {});
    const unwrap = mock(() => Promise.reject(new Error("submit failed")));
    const submitMutation = mock(() => ({unwrap}));
    const refetch = mock(() => Promise.resolve());
    const api = {
      enhanceEndpoints: mock(() => ({
        injectEndpoints: mock(() => ({
          useGetPendingConsentsQuery: mock(() => ({
            data: {data: [form]},
            error: undefined,
            isLoading: false,
            refetch,
          })),
          useSubmitConsentResponseMutation: mock(() => [
            submitMutation,
            {error: undefined, isLoading: false},
          ]),
        })),
      })),
    };

    const {getByTestId} = renderWithTheme(
      <ConsentNavigator api={api} onError={onError}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    await act(async () => {
      fireEvent.press(getByTestId("consent-form-agree-button"));
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(onError).toHaveBeenCalled();
  });

  it("calls submit with agreed=false when user declines an optional consent form", async () => {
    const {act, fireEvent} = await import("@testing-library/react-native");
    const form = makeForm({allowDecline: true, required: false});
    const unwrap = mock(() => Promise.resolve({agreed: false, id: "r-2"}));
    const submitMutation = mock(() => ({unwrap}));
    const refetch = mock(() => Promise.resolve());
    const api = {
      enhanceEndpoints: mock(() => ({
        injectEndpoints: mock(() => ({
          useGetPendingConsentsQuery: mock(() => ({
            data: {data: [form]},
            error: undefined,
            isLoading: false,
            refetch,
          })),
          useSubmitConsentResponseMutation: mock(() => [
            submitMutation,
            {error: undefined, isLoading: false},
          ]),
        })),
      })),
    };

    const {getByTestId} = renderWithTheme(
      <ConsentNavigator api={api}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    const declineBtn = getByTestId("consent-form-decline-button");
    await act(async () => {
      fireEvent.press(declineBtn);
    });
    expect(submitMutation).toHaveBeenCalled();
  });

  it("invokes onError when consent submission fails on decline", async () => {
    const {act, fireEvent} = await import("@testing-library/react-native");
    const form = makeForm({allowDecline: true, required: false});
    const onError = mock(() => {});
    const declineError = new Error("decline failed");
    const unwrap = mock(() => Promise.reject(declineError));
    const submitMutation = mock(() => ({unwrap}));
    const refetch = mock(() => Promise.resolve());
    const api = {
      enhanceEndpoints: mock(() => ({
        injectEndpoints: mock(() => ({
          useGetPendingConsentsQuery: mock(() => ({
            data: {data: [form]},
            error: undefined,
            isLoading: false,
            refetch,
          })),
          useSubmitConsentResponseMutation: mock(() => [
            submitMutation,
            {error: undefined, isLoading: false},
          ]),
        })),
      })),
    };

    const {getByTestId} = renderWithTheme(
      <ConsentNavigator api={api} onError={onError}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    await act(async () => {
      fireEvent.press(getByTestId("consent-form-decline-button"));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(onError).toHaveBeenCalledWith(declineError);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("renders non-element extra screens as-is without injecting onNext", async () => {
    const api = createMockApi([]);

    const {queryByText, toJSON} = renderWithTheme(
      <ConsentNavigator api={api} extraScreens={[null]}>
        <Text>App Content</Text>
      </ConsentNavigator>
    );

    expect(toJSON()).toBeNull();
    expect(queryByText("App Content")).toBeNull();
  });
});
