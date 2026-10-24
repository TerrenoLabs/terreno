import {afterEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, render, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import {DateTime} from "luxon";
import {Platform} from "react-native";

import {ConsentFormScreen} from "./ConsentFormScreen";
import {SignatureField} from "./SignatureField";
import {ThemeProvider} from "./Theme";
import {renderWithTheme} from "./test-utils";
import type {ConsentFormPublic} from "./useConsentForms";

const baseForm: ConsentFormPublic = {
  active: true,
  agreeButtonText: "I agree",
  allowDecline: true,
  captureSignature: false,
  checkboxes: [],
  content: {en: "Consent body", es: "Cuerpo de consentimiento"},
  declineButtonText: "Decline",
  defaultLocale: "en",
  id: "consent-1",
  order: 0,
  required: true,
  requireScrollToBottom: false,
  slug: "consent",
  title: "Consent",
  type: "tos",
  version: 1,
};

const waitForConsentMarkdown = async (getByText: (text: string) => unknown): Promise<void> => {
  await waitFor(() => {
    expect(getByText("Consent body")).toBeTruthy();
  });
};

describe("ConsentFormScreen", () => {
  describe("provisional signature notice", () => {
    const signedAt = "2026-10-20T15:30:00.000Z";

    it("shows who signed on the user's behalf and when", () => {
      const {getByTestId} = renderWithTheme(
        <ConsentFormScreen
          form={{...baseForm, provisionalSignature: {signedAt, signedByName: "Dana Rivera"}}}
          locale="en"
          onAgree={() => {}}
        />
      );
      const expectedDate = DateTime.fromISO(signedAt)
        .setLocale("en")
        .toLocaleString(DateTime.DATETIME_MED);
      const notice = getByTestId("consent-form-provisional-notice");
      expect(notice).toBeTruthy();
      expect(getByTestId("consent-form-provisional-notice-text").props.children).toBe(
        `Signed on your behalf by Dana Rivera on ${expectedDate}`
      );
    });

    it("leaves the date off when the signing date cannot be parsed", () => {
      const {getByTestId} = renderWithTheme(
        <ConsentFormScreen
          form={{...baseForm, provisionalSignature: {signedAt: "bad", signedByName: "Dana Rivera"}}}
          locale="en"
          onAgree={() => {}}
        />
      );
      expect(getByTestId("consent-form-provisional-notice-text").props.children).toBe(
        "Signed on your behalf by Dana Rivera"
      );
    });

    it("shows no notice when the form has no provisional signature", () => {
      const {queryByTestId} = renderWithTheme(
        <ConsentFormScreen form={baseForm} locale="en" onAgree={() => {}} />
      );
      expect(queryByTestId("consent-form-provisional-notice")).toBeNull();
    });

    it("still requires the user's own checkboxes and signature to agree", () => {
      const onAgree = mock(() => {});
      const {getByTestId} = renderWithTheme(
        <ConsentFormScreen
          form={{
            ...baseForm,
            captureSignature: true,
            checkboxes: [{label: "I understand", required: true}],
            provisionalSignature: {signedAt, signedByName: "Dana Rivera"},
          }}
          locale="en"
          onAgree={onAgree}
        />
      );
      expect(getByTestId("consent-form-agree-button").props.accessibilityState?.disabled).toBe(
        true
      );
      expect(getByTestId("consent-footer-checkboxes-hint")).toBeTruthy();
      expect(getByTestId("consent-footer-signature-hint")).toBeTruthy();
      fireEvent.press(getByTestId("consent-form-agree-button"));
      expect(onAgree).not.toHaveBeenCalled();
    });

    it("lets the user decline a provisionally signed form", async () => {
      const onDecline = mock(() => {});
      const {getByTestId} = renderWithTheme(
        <ConsentFormScreen
          form={{...baseForm, provisionalSignature: {signedAt, signedByName: "Dana Rivera"}}}
          locale="en"
          onAgree={() => {}}
          onDecline={onDecline}
        />
      );
      act(() => {
        fireEvent.press(getByTestId("consent-form-decline-button"));
      });
      await waitFor(() => {
        expect(onDecline).toHaveBeenCalledTimes(1);
      });
    });
  });

  it("renders with default state and a locale fallback", () => {
    const onAgree = mock(() => {});
    const {getByTestId, getByText} = renderWithTheme(
      <ConsentFormScreen
        form={{...baseForm, content: {en: "Hello"}}}
        locale="fr"
        onAgree={onAgree}
      />
    );
    expect(getByTestId("consent-form-scroll-view")).toBeTruthy();
    expect(getByText("I agree")).toBeTruthy();
  });

  it("substitutes variables in content and preserves unknown placeholders", () => {
    const {getByText} = renderWithTheme(
      <ConsentFormScreen
        form={{...baseForm, content: {en: "Hello {{name}}, {{missing}} stays"}}}
        locale="en"
        onAgree={() => {}}
        variables={{name: "Ada"}}
      />
    );
    expect(getByText("Hello Ada, {{missing}} stays")).toBeTruthy();
  });

  it("invokes onAgree with signature and checkbox values", () => {
    const onAgree = mock(() => {});
    const form: ConsentFormPublic = {
      ...baseForm,
      captureSignature: false,
      checkboxes: [
        {label: "Required box", required: true},
        {label: "Optional box", required: false},
      ],
    };
    const {getByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={onAgree} />
    );
    // Toggle the required checkbox on and the optional one off/on
    act(() => {
      fireEvent.press(getByTestId("consent-form-checkbox-0"));
      fireEvent.press(getByTestId("consent-form-checkbox-1"));
      fireEvent.press(getByTestId("consent-form-checkbox-1"));
    });
    act(() => {
      fireEvent.press(getByTestId("consent-form-agree-button"));
    });
    // Button has a debounce; wait briefly.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(onAgree).toHaveBeenCalledTimes(1);
        const call = onAgree.mock.calls[0]?.[0] as {
          checkboxValues: Record<string, boolean>;
          signature?: string;
        };
        expect(call.checkboxValues["0"]).toBe(true);
        expect(call.signature).toBeUndefined();
        resolve();
      }, 600);
    });
  });

  it("opens and confirms the confirmation modal before toggling checkbox on", () => {
    const form: ConsentFormPublic = {
      ...baseForm,
      checkboxes: [{confirmationPrompt: "Really?", label: "Tricky", required: true}],
    };
    const {getByTestId, queryByText} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    act(() => {
      fireEvent.press(getByTestId("consent-form-checkbox-0"));
    });
    expect(queryByText("Really?")).toBeTruthy();
  });

  it("fires onDecline when decline is pressed", () => {
    const onDecline = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <ConsentFormScreen form={baseForm} locale="en" onAgree={() => {}} onDecline={onDecline} />
    );
    act(() => {
      fireEvent.press(getByTestId("consent-form-decline-button"));
    });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(onDecline).toHaveBeenCalled();
        resolve();
      }, 600);
    });
  });

  it("keeps decline and agree buttons in equal-width columns when both are shown", () => {
    const {getAllByTestId, getByTestId} = renderWithTheme(
      <ConsentFormScreen form={baseForm} locale="en" onAgree={() => {}} onDecline={() => {}} />
    );

    const actionRow = getByTestId("consent-form-action-row");
    const actionColumns = getAllByTestId("consent-form-action-column");

    expect(actionRow.props.style).toMatchObject({flexDirection: "row"});
    expect(actionColumns.length).toBe(2);
    for (const column of actionColumns) {
      expect(column.props.style).toMatchObject({flexBasis: 0, minWidth: 0});
    }
  });

  it("fires scroll handlers without crashing", () => {
    const form = {...baseForm, requireScrollToBottom: true};
    const {getByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    const scroll = getByTestId("consent-form-scroll-view");
    act(() => {
      fireEvent(scroll, "contentSizeChange", 0, 300);
      fireEvent(scroll, "layout", {nativeEvent: {layout: {height: 400}}});
      fireEvent(scroll, "scroll", {
        nativeEvent: {
          contentOffset: {y: 100},
          contentSize: {height: 300},
          layoutMeasurement: {height: 210},
        },
      });
    });
    expect(scroll).toBeTruthy();
  });

  it("shows the scroll hint when content is still scrollable", () => {
    const form = {...baseForm, requireScrollToBottom: true};
    const {getByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    expect(getByTestId("consent-form-scroll-hint")).toBeTruthy();
  });

  it("shows footer scroll hint when scroll to bottom is required but not done", () => {
    const form = {...baseForm, requireScrollToBottom: true};
    const {getByTestId, queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    expect(getByTestId("consent-footer-scroll-hint")).toBeTruthy();
    expect(queryByTestId("consent-footer-signature-hint")).toBeNull();
  });

  it("hides footer scroll hint when scroll to bottom is not required", () => {
    const {queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={baseForm} locale="en" onAgree={() => {}} />
    );
    expect(queryByTestId("consent-footer-scroll-hint")).toBeNull();
  });

  it("shows footer signature hint when signature is required but not provided", () => {
    const form = {...baseForm, captureSignature: true};
    const {getByTestId, queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    expect(getByTestId("consent-footer-signature-hint")).toBeTruthy();
    expect(queryByTestId("consent-footer-scroll-hint")).toBeNull();
  });

  it("hides footer signature hint when signature is not required", () => {
    const {queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={baseForm} locale="en" onAgree={() => {}} />
    );
    expect(queryByTestId("consent-footer-signature-hint")).toBeNull();
  });

  it("shows both footer hints when scroll and signature are both required", () => {
    const form = {...baseForm, captureSignature: true, requireScrollToBottom: true};
    const {getByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    expect(getByTestId("consent-footer-scroll-hint")).toBeTruthy();
    expect(getByTestId("consent-footer-signature-hint")).toBeTruthy();
  });

  it("shows the required-items legend when any checkbox is required", () => {
    const form: ConsentFormPublic = {
      ...baseForm,
      checkboxes: [{label: "Required box", required: true}],
    };
    const {getByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    expect(getByTestId("consent-form-required-legend")).toBeTruthy();
  });

  it("hides the required-items legend when no checkbox is required", () => {
    const form: ConsentFormPublic = {
      ...baseForm,
      checkboxes: [{label: "Optional box", required: false}],
    };
    const {queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    expect(queryByTestId("consent-form-required-legend")).toBeNull();
  });

  it("confirms the modal and toggles the checkbox on", () => {
    const form: ConsentFormPublic = {
      ...baseForm,
      checkboxes: [{confirmationPrompt: "Are you sure?", label: "Tricky", required: true}],
    };
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    act(() => {
      fireEvent.press(getByTestId("consent-form-checkbox-0"));
    });
    expect(getByText("Are you sure?")).toBeTruthy();
    // Press the "Confirm" button inside the modal
    act(() => {
      fireEvent.press(getByText("Confirm"));
    });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Checkbox hint should be gone because the required checkbox was toggled on
        expect(queryByTestId("consent-footer-checkboxes-hint")).toBeNull();
        resolve();
      }, 600);
    });
  });

  it("dismisses the modal without toggling the checkbox", () => {
    const form: ConsentFormPublic = {
      ...baseForm,
      checkboxes: [{confirmationPrompt: "Are you sure?", label: "Tricky", required: true}],
    };
    const {getByTestId, getByText} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    act(() => {
      fireEvent.press(getByTestId("consent-form-checkbox-0"));
    });
    expect(getByText("Are you sure?")).toBeTruthy();
    // Press the "Cancel" button inside the modal
    act(() => {
      fireEvent.press(getByText("Cancel"));
    });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // The checkbox hint should still show because the checkbox was not toggled
        expect(getByTestId("consent-footer-checkboxes-hint")).toBeTruthy();
        resolve();
      }, 600);
    });
  });

  it("auto-satisfies scroll requirement when content fits the viewport via contentSizeChange", async () => {
    const form = {...baseForm, requireScrollToBottom: true};
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    await waitForConsentMarkdown(getByText);
    const scroll = getByTestId("consent-form-scroll-view");
    act(() => {
      fireEvent(scroll, "layout", {nativeEvent: {layout: {height: 500}}});
    });
    act(() => {
      fireEvent(scroll, "contentSizeChange", 0, 400);
    });
    expect(queryByTestId("consent-form-scroll-hint")).toBeNull();
  });

  it("auto-satisfies scroll requirement when content fits the viewport via layout", async () => {
    const form = {...baseForm, requireScrollToBottom: true};
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    await waitForConsentMarkdown(getByText);
    const scroll = getByTestId("consent-form-scroll-view");
    act(() => {
      fireEvent(scroll, "contentSizeChange", 0, 300);
    });
    act(() => {
      fireEvent(scroll, "layout", {nativeEvent: {layout: {height: 500}}});
    });
    expect(queryByTestId("consent-form-scroll-hint")).toBeNull();
  });

  it("re-requires scroll when lazy content grows past the viewport", async () => {
    const form = {...baseForm, requireScrollToBottom: true};
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    await waitForConsentMarkdown(getByText);
    const scroll = getByTestId("consent-form-scroll-view");
    act(() => {
      fireEvent(scroll, "layout", {nativeEvent: {layout: {height: 500}}});
    });
    act(() => {
      fireEvent(scroll, "contentSizeChange", 0, 80);
    });
    expect(queryByTestId("consent-form-scroll-hint")).toBeNull();
    act(() => {
      fireEvent(scroll, "contentSizeChange", 0, 2000);
    });
    expect(getByTestId("consent-form-scroll-hint")).toBeTruthy();
  });

  it("keeps a completed scroll when content shrinks after the in-list hint unmounts", async () => {
    const form = {...baseForm, requireScrollToBottom: true};
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    await waitForConsentMarkdown(getByText);
    const scroll = getByTestId("consent-form-scroll-view");
    act(() => {
      fireEvent(scroll, "layout", {nativeEvent: {layout: {height: 500}}});
    });
    act(() => {
      fireEvent(scroll, "contentSizeChange", 0, 2000);
    });
    expect(getByTestId("consent-form-scroll-hint")).toBeTruthy();
    act(() => {
      fireEvent(scroll, "scroll", {
        nativeEvent: {
          contentOffset: {y: 1480},
          contentSize: {height: 2000},
          layoutMeasurement: {height: 500},
        },
      });
    });
    expect(queryByTestId("consent-form-scroll-hint")).toBeNull();
    act(() => {
      fireEvent(scroll, "contentSizeChange", 0, 1900);
    });
    expect(queryByTestId("consent-form-scroll-hint")).toBeNull();
    expect(getByTestId("consent-form-agree-button")).toBeTruthy();
  });

  it("handleScroll returns early when already scrolled to bottom", () => {
    const form = {...baseForm, requireScrollToBottom: false};
    const {getByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    const scroll = getByTestId("consent-form-scroll-view");
    // requireScrollToBottom is false so hasScrolledToBottom starts as true.
    // Firing scroll should hit the early return at line 81.
    act(() => {
      fireEvent(scroll, "scroll", {
        nativeEvent: {
          contentOffset: {y: 0},
          contentSize: {height: 1000},
          layoutMeasurement: {height: 500},
        },
      });
    });
    expect(scroll).toBeTruthy();
  });

  it("shows the checkbox footer hint when a required checkbox is unchecked", () => {
    const form: ConsentFormPublic = {
      ...baseForm,
      checkboxes: [{label: "Required box", required: true}],
    };
    const {getByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    expect(getByTestId("consent-footer-checkboxes-hint")).toBeTruthy();
  });

  it("hides the checkbox footer hint once required checkboxes are checked", () => {
    const form: ConsentFormPublic = {
      ...baseForm,
      checkboxes: [{label: "Required box", required: true}],
    };
    const {getByTestId, queryByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    act(() => {
      fireEvent.press(getByTestId("consent-form-checkbox-0"));
    });
    expect(queryByTestId("consent-footer-checkboxes-hint")).toBeNull();
  });

  it("toggles scrolling with the signature touch handlers on iOS", () => {
    const form: ConsentFormPublic = {
      ...baseForm,
      captureSignature: true,
    };
    const {getByTestId} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    const signature = getByTestId("consent-form-signature");
    const scroll = getByTestId("consent-form-scroll-view");

    act(() => {
      fireEvent(signature, "touchStart");
    });
    expect(scroll.props.scrollEnabled).toBe(false);

    act(() => {
      fireEvent(signature, "touchEnd");
    });
    expect(scroll.props.scrollEnabled).toBe(true);
  });

  it("exercises SignatureField onChange, onStart, and onEnd callbacks", () => {
    const form: ConsentFormPublic = {
      ...baseForm,
      captureSignature: true,
    };
    const {UNSAFE_getByType} = renderWithTheme(
      <ConsentFormScreen form={form} locale="en" onAgree={() => {}} />
    );
    const sig = UNSAFE_getByType(SignatureField);
    act(() => {
      sig.props.onChange("data:image/png;base64,abc");
    });
    act(() => {
      sig.props.onStart();
    });
    act(() => {
      sig.props.onEnd();
    });
    expect(sig).toBeTruthy();
  });
});

describe("ConsentFormScreen web scroll measurement", () => {
  const originalOS = Platform.OS;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  let frames: FrameRequestCallback[] = [];

  const renderOnWeb = (scrollNode: {clientHeight?: number; scrollHeight?: number} | null) => {
    Platform.OS = "web";
    frames = [];
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    }) as typeof globalThis.requestAnimationFrame;

    return render(
      <ConsentFormScreen
        form={{...baseForm, requireScrollToBottom: true}}
        locale="en"
        onAgree={() => {}}
      />,
      {
        createNodeMock: () => ({getScrollableNode: () => scrollNode}),
        wrapper: ThemeProvider,
      }
    );
  };

  const flushFrames = (): void => {
    act(() => {
      for (const frame of frames.splice(0)) {
        frame(0);
      }
    });
  };

  afterEach(() => {
    Platform.OS = originalOS;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it("unlocks the gate when the loaded content fits the viewport", async () => {
    const {getByText, queryByTestId} = renderOnWeb({clientHeight: 500, scrollHeight: 200});
    await waitForConsentMarkdown(getByText);

    flushFrames();

    assert.isNull(queryByTestId("consent-form-scroll-hint"));
    assert.isNull(queryByTestId("consent-footer-scroll-hint"));
  });

  it("keeps the gate when the loaded content overflows the viewport", async () => {
    const {getByTestId, getByText} = renderOnWeb({clientHeight: 200, scrollHeight: 900});
    await waitForConsentMarkdown(getByText);

    flushFrames();

    assert.isNotNull(getByTestId("consent-form-scroll-hint"));
  });

  it("keeps the gate when the scroll node has no measurements", async () => {
    const {getByTestId, getByText} = renderOnWeb({});
    await waitForConsentMarkdown(getByText);

    flushFrames();

    assert.isNotNull(getByTestId("consent-form-scroll-hint"));
  });

  it("keeps the gate when the scroll view has no node", async () => {
    const {getByTestId, getByText} = renderOnWeb(null);
    await waitForConsentMarkdown(getByText);

    flushFrames();

    assert.isNotNull(getByTestId("consent-form-scroll-hint"));
  });
});
