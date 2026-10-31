import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
// Import Platform the same way the source modules do (ESM named import) so the web blur effect
// (which reads Platform.OS directly in Modal.tsx) observes the value the test sets.
import {Platform as ImportedPlatform, type ScaledSize, useWindowDimensions} from "react-native";
import {Gesture} from "react-native-gesture-handler";

import {Modal} from "./Modal";
import {Text} from "./Text";
import {renderWithTheme} from "./test-utils";
import * as Utilities from "./Utilities";

// Minimal shape of a test instance returned by UNSAFE_getAllByType that we rely on here.
interface PressableTestInstance {
  props: {
    style?:
      | {backgroundColor?: string; cursor?: string}
      | {backgroundColor?: string; cursor?: string}[];
    onPress?: (event?: {stopPropagation?: () => void}) => void;
  };
}

interface ViewTestInstance {
  props: {
    style?: {cursor?: string} | {cursor?: string}[];
    onClick?: (event: {stopPropagation: () => void}) => void;
  };
}

/**
 * Finds the web-only translucent backdrop Pressable in a rendered Modal tree.
 *
 * The web branch renders a full-screen Pressable whose style sets a semi-transparent
 * `rgba(...)` backgroundColor; the native ActionSheet branch has no such element. Tests use
 * its presence/absence to assert which presentation branch rendered.
 *
 * @param pressables - All Pressable test instances found in the rendered tree.
 * @returns The backdrop Pressable if present, otherwise undefined.
 */
const findBackdropPressable = (
  pressables: PressableTestInstance[]
): PressableTestInstance | undefined => {
  return pressables.find((node) => {
    const style = node.props.style;
    if (Array.isArray(style)) {
      return style.some((s) => s?.backgroundColor?.includes?.("rgba"));
    }
    return style?.backgroundColor?.includes?.("rgba");
  });
};

/**
 * Collects every reachable react-native `Platform` mock object.
 *
 * `Platform.OS` is read through `import {Platform} from "react-native"` in more than one source
 * module (`Modal.tsx` directly, and `Utilities.tsx#isNative`). Depending on module resolution
 * those bindings can map to either the top-level react-native mock or the internal
 * `Libraries/Utilities/Platform` mock, and CI has shown them diverging (mutating one left the
 * other untouched). Gathering all of them lets a single setter drive the platform branch
 * deterministically regardless of which object a given module captured.
 */
const collectPlatformObjects = (): {OS: string}[] => {
  const objects: {OS: string}[] = [];
  const push = (candidate: unknown): void => {
    if (
      candidate &&
      typeof candidate === "object" &&
      "OS" in (candidate as Record<string, unknown>) &&
      !objects.includes(candidate as {OS: string})
    ) {
      objects.push(candidate as {OS: string});
    }
  };
  // The ESM binding the source files use must come first.
  push(ImportedPlatform);
  const rn = require("react-native") as {Platform?: unknown; default?: {Platform?: unknown}};
  push(rn.Platform);
  push(rn.default?.Platform);
  try {
    // Only the module's `default` object is mutable; the namespace's own `OS` binding is a
    // readonly ES module export and must not be pushed.
    const libPlatform = require("react-native/Libraries/Utilities/Platform") as {
      default?: unknown;
    };
    push(libPlatform.default);
  } catch {
    // The internal Platform module may not be resolvable; the top-level mock still covers it.
  }
  return objects;
};

const platformObjects = collectPlatformObjects();
const originalPlatformOS = platformObjects.map((platform) => platform.OS);

/**
 * Sets `Platform.OS` on every reachable Platform mock so both `Modal` and `isNative` observe it.
 *
 * @param os - The platform value to apply (e.g. "web", "ios", "android").
 */
const setPlatformOS = (os: string): void => {
  for (const platform of platformObjects) {
    try {
      platform.OS = os;
    } catch {
      // Skip any binding that is not writable; other bindings still drive the branch.
    }
  }
};

/**
 * Restores `Platform.OS` on every reachable Platform mock to the value captured at load time.
 */
const restorePlatformOS = (): void => {
  platformObjects.forEach((platform, index) => {
    try {
      platform.OS = originalPlatformOS[index] ?? "ios";
    } catch {
      // Skip any binding that is not writable.
    }
  });
};

let isNativeSpy: ReturnType<typeof spyOn> | undefined;

type WindowDimensionsImpl = () => ScaledSize;
type MockableUseWindowDimensions = WindowDimensionsImpl & {
  mockImplementation?: (impl: WindowDimensionsImpl) => void;
};

const setWindowWidth = (width: number): (() => void) => {
  const windowDimensions = useWindowDimensions as MockableUseWindowDimensions;
  if (typeof windowDimensions.mockImplementation !== "function") {
    return (): void => {};
  }
  windowDimensions.mockImplementation(
    (): ScaledSize => ({fontScale: 1, height: 924, scale: 1, width})
  );
  // Back to bunSetup's phone-sized default (375x812), so later suites in the process do not
  // inherit a desktop width.
  return (): void => {
    windowDimensions.mockImplementation?.(
      (): ScaledSize => ({fontScale: 1, height: 812, scale: 2, width: 375})
    );
  };
};

/**
 * Forces `isNative()` to a fixed value so the Modal's platform branch is deterministic.
 *
 * Spying on the `Utilities.isNative` export drives the exact live binding `Modal.tsx` calls,
 * which is reliable across environments (unlike mutating react-native's Platform.OS, whose mock
 * object identity can diverge per module on CI).
 *
 * @param value - true to render the native ActionSheet branch, false for the web dialog branch.
 */
const forceIsNative = (value: boolean): void => {
  isNativeSpy = spyOn(Utilities, "isNative").mockReturnValue(value);
};

/**
 * Restores the real `isNative()` implementation after a forced value.
 */
const restoreIsNative = (): void => {
  isNativeSpy?.mockRestore();
  isNativeSpy = undefined;
};

describe("Modal", () => {
  // These tests exercise the default native (ActionSheet) presentation; pin the platform and
  // force isNative() so the branch is deterministic and not left to ambient Platform.OS state.
  beforeEach(() => {
    setPlatformOS("ios");
    forceIsNative(true);
  });

  afterEach(() => {
    restorePlatformOS();
    restoreIsNative();
  });

  it("renders correctly when visible", () => {
    const {toJSON} = renderWithTheme(
      <Modal onDismiss={() => {}} title="Test Modal" visible>
        <Text>Modal content</Text>
      </Modal>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("does not show content when not visible", () => {
    const {toJSON} = renderWithTheme(
      <Modal onDismiss={() => {}} title="Test Modal" visible={false}>
        <Text>Modal content</Text>
      </Modal>
    );
    // When not visible, the modal should not display content
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with title", () => {
    const {getByText} = renderWithTheme(
      <Modal onDismiss={() => {}} title="Modal Title" visible>
        <Text>Content</Text>
      </Modal>
    );
    expect(getByText("Modal Title")).toBeTruthy();
  });

  it("renders with subtitle", () => {
    const {getByText} = renderWithTheme(
      <Modal onDismiss={() => {}} subtitle="Modal Subtitle" title="Title" visible>
        <Text>Content</Text>
      </Modal>
    );
    expect(getByText("Modal Subtitle")).toBeTruthy();
  });

  it("renders with text", () => {
    const {getByText} = renderWithTheme(
      <Modal onDismiss={() => {}} text="This is the modal body text" title="Title" visible>
        <Text>Content</Text>
      </Modal>
    );
    expect(getByText("This is the modal body text")).toBeTruthy();
  });

  it("renders children", () => {
    const {getByText} = renderWithTheme(
      <Modal onDismiss={() => {}} title="Title" visible>
        <Text>Custom children content</Text>
      </Modal>
    );
    expect(getByText("Custom children content")).toBeTruthy();
  });

  it("renders with primary button", () => {
    const handleClick = mock(() => {});
    const {getByText} = renderWithTheme(
      <Modal
        onDismiss={() => {}}
        primaryButtonOnClick={handleClick}
        primaryButtonText="Confirm"
        title="Title"
        visible
      >
        <Text>Content</Text>
      </Modal>
    );
    expect(getByText("Confirm")).toBeTruthy();
  });

  it("renders with secondary button", () => {
    const handleClick = mock(() => {});
    const {getByText} = renderWithTheme(
      <Modal
        onDismiss={() => {}}
        secondaryButtonOnClick={handleClick}
        secondaryButtonText="Cancel"
        title="Title"
        visible
      >
        <Text>Content</Text>
      </Modal>
    );
    expect(getByText("Cancel")).toBeTruthy();
  });

  it("renders with both buttons", () => {
    const {getByText, toJSON} = renderWithTheme(
      <Modal
        onDismiss={() => {}}
        primaryButtonOnClick={() => {}}
        primaryButtonText="Save"
        secondaryButtonOnClick={() => {}}
        secondaryButtonText="Cancel"
        title="Confirm Action"
        visible
      >
        <Text>Are you sure?</Text>
      </Modal>
    );
    expect(getByText("Save")).toBeTruthy();
    expect(getByText("Cancel")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with disabled primary button", () => {
    const {toJSON} = renderWithTheme(
      <Modal
        onDismiss={() => {}}
        primaryButtonDisabled
        primaryButtonOnClick={() => {}}
        primaryButtonText="Save"
        title="Title"
        visible
      >
        <Text>Content</Text>
      </Modal>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls onDismiss when close button is pressed", () => {
    const handleDismiss = mock(() => {});
    const {getByLabelText} = renderWithTheme(
      <Modal onDismiss={handleDismiss} title="Title" visible>
        <Text>Content</Text>
      </Modal>
    );

    fireEvent.press(getByLabelText("Close modal"));
    expect(handleDismiss).toHaveBeenCalled();
  });

  it("renders with small size", () => {
    const {toJSON} = renderWithTheme(
      <Modal onDismiss={() => {}} size="sm" title="Small Modal" visible>
        <Text>Content</Text>
      </Modal>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with medium size", () => {
    const {toJSON} = renderWithTheme(
      <Modal onDismiss={() => {}} size="md" title="Medium Modal" visible>
        <Text>Content</Text>
      </Modal>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with large size", () => {
    const {toJSON} = renderWithTheme(
      <Modal onDismiss={() => {}} size="lg" title="Large Modal" visible>
        <Text>Content</Text>
      </Modal>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders primary button with click handler", () => {
    const handlePrimary = mock(() => {});
    const {getByText} = renderWithTheme(
      <Modal
        onDismiss={() => {}}
        primaryButtonOnClick={handlePrimary}
        primaryButtonText="Confirm"
        title="Title"
        visible
      >
        <Text>Content</Text>
      </Modal>
    );
    expect(getByText("Confirm")).toBeTruthy();
  });

  it("renders secondary button with click handler", () => {
    const handleSecondary = mock(() => {});
    const {getByText} = renderWithTheme(
      <Modal
        onDismiss={() => {}}
        secondaryButtonOnClick={handleSecondary}
        secondaryButtonText="Cancel"
        title="Title"
        visible
      >
        <Text>Content</Text>
      </Modal>
    );
    expect(getByText("Cancel")).toBeTruthy();
  });

  it("does not call primaryButtonOnClick when not visible", () => {
    const handlePrimary = mock(() => {});
    renderWithTheme(
      <Modal
        onDismiss={() => {}}
        primaryButtonOnClick={handlePrimary}
        primaryButtonText="Confirm"
        title="Title"
        visible={false}
      >
        <Text>Content</Text>
      </Modal>
    );
    expect(handlePrimary).not.toHaveBeenCalled();
  });

  it("renders with persistOnBackgroundClick", () => {
    const {toJSON} = renderWithTheme(
      <Modal onDismiss={() => {}} persistOnBackgroundClick title="Persistent" visible>
        <Text>Content</Text>
      </Modal>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("does not call onDismiss when visible is false and close is pressed", () => {
    const handleDismiss = mock(() => {});
    renderWithTheme(
      <Modal onDismiss={handleDismiss} title="Hidden" visible={false}>
        <Text>Content</Text>
      </Modal>
    );
    expect(handleDismiss).not.toHaveBeenCalled();
  });

  it("renders transitioning from hidden to visible", () => {
    const {rerender, toJSON} = renderWithTheme(
      <Modal onDismiss={() => {}} title="Toggle" visible={false}>
        <Text>Content</Text>
      </Modal>
    );
    rerender(
      <Modal onDismiss={() => {}} title="Toggle" visible>
        <Text>Content</Text>
      </Modal>
    );
    expect(toJSON()).toBeTruthy();
  });

  it("invokes primaryButtonOnClick when primary button pressed while visible", async () => {
    const handlePrimary = mock(() => {});
    const {getByText} = renderWithTheme(
      <Modal
        onDismiss={() => {}}
        primaryButtonOnClick={handlePrimary}
        primaryButtonText="Submit"
        title="Title"
        visible
      >
        <Text>Content</Text>
      </Modal>
    );

    await new Promise((resolve) => {
      fireEvent.press(getByText("Submit"));
      setTimeout(resolve, 600);
    });

    expect(handlePrimary).toHaveBeenCalled();
  });

  it("invokes secondaryButtonOnClick when secondary button pressed while visible", async () => {
    const handleSecondary = mock(() => {});
    const {getByText} = renderWithTheme(
      <Modal
        onDismiss={() => {}}
        secondaryButtonOnClick={handleSecondary}
        secondaryButtonText="Cancel"
        title="Title"
        visible
      >
        <Text>Content</Text>
      </Modal>
    );

    await new Promise((resolve) => {
      fireEvent.press(getByText("Cancel"));
      setTimeout(resolve, 600);
    });

    expect(handleSecondary).toHaveBeenCalled();
  });
});

describe("Modal web platform", () => {
  const globalScope = globalThis as {document?: unknown; HTMLElement?: unknown};
  const originalDocument = globalScope.document;
  const originalHTMLElement = globalScope.HTMLElement;

  class FakeHTMLElement {
    blur = mock(() => {});
  }

  // The web branch runs a blur useEffect that reads `document.activeElement` and checks
  // `instanceof HTMLElement`, so every web test needs Platform.OS === "web" (across every
  // Platform binding, see setPlatformOS) plus a document and HTMLElement stub before rendering.
  beforeEach(() => {
    setPlatformOS("web");
    forceIsNative(false);
    globalScope.HTMLElement = FakeHTMLElement;
    globalScope.document = {activeElement: null};
  });

  afterEach(() => {
    restorePlatformOS();
    restoreIsNative();
    globalScope.document = originalDocument;
    globalScope.HTMLElement = originalHTMLElement;
  });

  it("renders the web RNModal backdrop on web", () => {
    const {UNSAFE_getAllByType} = renderWithTheme(
      <Modal onDismiss={() => {}} title="Web Modal" visible>
        <Text>Content</Text>
      </Modal>
    );
    const {Pressable} = require("react-native");
    const pressables: PressableTestInstance[] = UNSAFE_getAllByType(Pressable);
    expect(findBackdropPressable(pressables)).toBeTruthy();
  });

  it("stacks long modal actions at narrow web widths", () => {
    const restoreWindowWidth = setWindowWidth(400);
    try {
      const {getByText, UNSAFE_root} = renderWithTheme(
        <Modal
          onDismiss={() => {}}
          primaryButtonOnClick={() => {}}
          primaryButtonText="Got it"
          secondaryButtonOnClick={() => {}}
          secondaryButtonText="Read the announcement docs"
          title="Announcement"
          visible
        >
          <Text>Launch details</Text>
        </Modal>
      );

      assert.exists(getByText("Read the announcement docs"));
      assert.exists(getByText("Got it"));
      const stackedActionRows = UNSAFE_root.findAll(
        (node) =>
          node.props?.style?.alignSelf === "stretch" &&
          node.props?.style?.flexDirection === "column" &&
          node.props?.style?.gap === 12
      );
      assert.isAtLeast(stackedActionRows.length, 1);
    } finally {
      restoreWindowWidth();
    }
  });

  it("dismisses when the backdrop is pressed and persistOnBackgroundClick is false", () => {
    const handleDismiss = mock(() => {});
    const {UNSAFE_getAllByType} = renderWithTheme(
      <Modal onDismiss={handleDismiss} title="Title" visible>
        <Text>Content</Text>
      </Modal>
    );
    // Find the backdrop Pressable (first Pressable in tree with a style that includes backgroundColor).
    const {Pressable} = require("react-native");
    const pressables: PressableTestInstance[] = UNSAFE_getAllByType(Pressable);
    const backdrop = findBackdropPressable(pressables);
    expect(backdrop).toBeTruthy();
    backdrop?.props.onPress?.();
    expect(handleDismiss).toHaveBeenCalled();
  });

  const findDialogShellView = (views: ViewTestInstance[]): ViewTestInstance | undefined => {
    return views.find((node) => {
      const style = node.props.style;
      if (Array.isArray(style)) {
        return style.some((entry) => entry?.cursor === "auto");
      }
      return style?.cursor === "auto";
    });
  };

  it("stops propagation on the dialog shell click (web)", () => {
    const stopPropagation = mock(() => {});
    const {UNSAFE_getAllByType} = renderWithTheme(
      <Modal onDismiss={() => {}} title="Title" visible>
        <Text>Content</Text>
      </Modal>
    );
    const {View} = require("react-native");
    const views: ViewTestInstance[] = UNSAFE_getAllByType(View);
    const shell = findDialogShellView(views);
    expect(shell).toBeTruthy();
    shell?.props.onClick?.({stopPropagation});
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("still stops dialog shell propagation when persistOnBackgroundClick is true", () => {
    const stopPropagation = mock(() => {});
    const handleDismiss = mock(() => {});
    const {UNSAFE_getAllByType} = renderWithTheme(
      <Modal onDismiss={handleDismiss} persistOnBackgroundClick title="Title" visible>
        <Text>Content</Text>
      </Modal>
    );
    const {Pressable, View} = require("react-native");
    const pressables: PressableTestInstance[] = UNSAFE_getAllByType(Pressable);
    const backdrop = findBackdropPressable(pressables);
    expect(backdrop?.props.onPress).toBeUndefined();

    const views: ViewTestInstance[] = UNSAFE_getAllByType(View);
    const shell = findDialogShellView(views);
    expect(shell).toBeTruthy();
    shell?.props.onClick?.({stopPropagation});
    expect(stopPropagation).toHaveBeenCalled();
    expect(handleDismiss).not.toHaveBeenCalled();
  });

  it("does not dismiss when a nested child action is pressed on web", () => {
    const handleDismiss = mock(() => {});
    const handleAction = mock(() => {});
    const {UNSAFE_getAllByType, getByText} = renderWithTheme(
      <Modal onDismiss={handleDismiss} title="Title" visible>
        <Text onPress={handleAction}>Mark read</Text>
      </Modal>
    );
    fireEvent.press(getByText("Mark read"));
    expect(handleAction).toHaveBeenCalled();
    expect(handleDismiss).not.toHaveBeenCalled();

    const {Pressable} = require("react-native");
    const pressables: PressableTestInstance[] = UNSAFE_getAllByType(Pressable);
    const backdrop = findBackdropPressable(pressables);
    expect(backdrop).toBeTruthy();
    backdrop?.props.onPress?.();
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it("blurs the focused element when opened on web", () => {
    const active = new FakeHTMLElement();
    globalScope.document = {activeElement: active};

    renderWithTheme(
      <Modal onDismiss={() => {}} title="Web Modal" visible>
        <Text>Content</Text>
      </Modal>
    );

    expect(active.blur).toHaveBeenCalled();
  });

  it("does not blur when the active element is not an HTMLElement", () => {
    globalScope.document = {activeElement: {}};

    const {toJSON} = renderWithTheme(
      <Modal onDismiss={() => {}} title="Web Modal" visible>
        <Text>Content</Text>
      </Modal>
    );

    expect(toJSON()).toBeTruthy();
  });
});

// The Modal selects its presentation via isNative() (Platform.OS in ios/android), NOT screen
// size, so these run the native branch explicitly for each native platform. Android is the
// platform where the original tablet bug occurred, so it must be covered directly rather than
// relying on the default "ios" test platform.
describe("Modal native presentation", () => {
  afterEach(() => {
    restorePlatformOS();
    restoreIsNative();
  });

  for (const platform of ["ios", "android"] as const) {
    it(`uses the ActionSheet (no web backdrop) on ${platform}`, () => {
      setPlatformOS(platform);
      forceIsNative(true);
      const {UNSAFE_getAllByType, getByText} = renderWithTheme(
        <Modal
          onDismiss={() => {}}
          primaryButtonOnClick={() => {}}
          primaryButtonText="Save"
          title="Native Modal"
          visible
        >
          <Text>Native Content</Text>
        </Modal>
      );
      // Content mounts via the ActionSheet branch...
      expect(getByText("Native Modal")).toBeTruthy();
      // ...and the web-only translucent backdrop Pressable must NOT be present.
      const {Pressable} = require("react-native");
      const pressables: PressableTestInstance[] = UNSAFE_getAllByType(Pressable);
      expect(findBackdropPressable(pressables)).toBeUndefined();
    });

    it(`renders nothing when not visible on ${platform}`, () => {
      setPlatformOS(platform);
      forceIsNative(true);
      const {queryByText} = renderWithTheme(
        <Modal onDismiss={() => {}} title="Hidden Native Modal" visible={false}>
          <Text>Native Content</Text>
        </Modal>
      );
      // The ActionSheet stays closed (mock tracks setModalVisible), so no content is shown.
      expect(queryByText("Hidden Native Modal")).toBeNull();
      expect(queryByText("Native Content")).toBeNull();
    });
  }
});

interface CapturedGesture {
  onEnd: {mock: {calls: [(event: {translationY: number}) => void][]}};
}

describe("Modal drag-to-close gesture", () => {
  // The drag handle only renders in the native ActionSheet branch, so force native.
  beforeEach(() => {
    setPlatformOS("ios");
    forceIsNative(true);
  });

  afterEach(() => {
    restorePlatformOS();
    restoreIsNative();
  });

  it("dismisses only when dragged down past the threshold", () => {
    const handleDismiss = mock(() => {});
    let capturedGesture: CapturedGesture | undefined;
    const originalPan = Gesture.Pan;
    (Gesture as {Pan: () => unknown}).Pan = () => {
      capturedGesture = originalPan() as unknown as CapturedGesture;
      return capturedGesture;
    };

    try {
      renderWithTheme(
        <Modal onDismiss={handleDismiss} title="Draggable" visible>
          <Text>Body</Text>
        </Modal>
      );

      const onEnd = capturedGesture?.onEnd.mock.calls[0][0];
      assert.isDefined(onEnd);

      // A small drag stays below the threshold and should not dismiss.
      onEnd?.({translationY: 5});
      assert.lengthOf(handleDismiss.mock.calls, 0);

      // A drag past the threshold dismisses via runOnJS(handleDismiss).
      onEnd?.({translationY: 40});
      assert.lengthOf(handleDismiss.mock.calls, 1);
    } finally {
      (Gesture as {Pan: () => unknown}).Pan = originalPan;
    }
  });
});
