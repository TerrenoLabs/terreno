import {afterEach, beforeAll, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {act, render, waitFor} from "@testing-library/react-native";
import type {ReactElement} from "react";
import {
  Platform as ImportedPlatform,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import type {ReactTestInstance} from "react-test-renderer";

import {Modal} from "./Modal";
import {ToastProvider, type ToastType, useToastNotifications} from "./ToastNotifications";
import {renderWithTheme} from "./test-utils";
import * as Utilities from "./Utilities";

// react-native-web ModalAnimation paints the dialog layer at this z-index on document.body.
const REACT_NATIVE_WEB_MODAL_Z_INDEX = 9999;

const TOAST_MESSAGE = "Saved above the modal";

interface PortalFiber {
  return: PortalFiber | null;
  stateNode: {containerInfo?: unknown} | null;
  tag: number;
}

const HOST_PORTAL_TAG = 4;

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
  push(ImportedPlatform);
  const rn = require("react-native") as {Platform?: unknown; default?: {Platform?: unknown}};
  push(rn.Platform);
  push(rn.default?.Platform);
  try {
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

const setPlatformOS = (os: string): void => {
  for (const platform of platformObjects) {
    try {
      platform.OS = os;
    } catch {
      // Skip any binding that is not writable.
    }
  }
};

const restorePlatformOS = (): void => {
  platformObjects.forEach((platform, index) => {
    try {
      platform.OS = originalPlatformOS[index] ?? "ios";
    } catch {
      // Skip any binding that is not writable.
    }
  });
};

const globalScope = globalThis as {document?: unknown; HTMLElement?: unknown};
const originalDocument = globalScope.document;
const originalHTMLElement = globalScope.HTMLElement;

class TestHTMLElement {
  nodeType = 1;
  // react-test-renderer commits a portal by appending host nodes onto `container.children`
  // and reads `createNodeMock` from that container when attaching refs.
  children: unknown[] = [];
  createNodeMock = (): Record<string, never> => ({});
}

const installDocumentBody = (): TestHTMLElement => {
  const body = new TestHTMLElement();
  globalScope.HTMLElement = TestHTMLElement;
  globalScope.document = {activeElement: null, body};
  return body;
};

const restoreDocument = (): void => {
  globalScope.document = originalDocument;
  globalScope.HTMLElement = originalHTMLElement;
};

const flattenStyle = (style: unknown): {pointerEvents?: string; zIndex?: number} => {
  return StyleSheet.flatten(style) as {pointerEvents?: string; zIndex?: number};
};

const portalContainerFor = (node: ReactTestInstance): unknown => {
  let fiber = (node as unknown as {_fiber?: PortalFiber})._fiber ?? null;
  while (fiber) {
    if (fiber.tag === HOST_PORTAL_TAG) {
      return fiber.stateNode?.containerInfo;
    }
    fiber = fiber.return;
  }
  return undefined;
};

const isInside = (node: ReactTestInstance, ancestor: ReactTestInstance): boolean => {
  let current: ReactTestInstance | null = node;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const findBackdrop = (pressables: ReactTestInstance[]): ReactTestInstance | undefined => {
  return pressables.find((node) => {
    const style = node.props.style as {backgroundColor?: string} | {backgroundColor?: string}[];
    if (Array.isArray(style)) {
      return style.some((entry) => entry?.backgroundColor?.includes("rgba"));
    }
    return style?.backgroundColor?.includes("rgba");
  });
};

const flushFrames = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

beforeAll(() => {
  global.requestAnimationFrame = (callback: FrameRequestCallback) => {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  };
  global.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
});

describe("Toast above an open web modal", () => {
  let isNativeSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    setPlatformOS("web");
    isNativeSpy = spyOn(Utilities, "isNative").mockReturnValue(false);
    installDocumentBody();
  });

  afterEach(() => {
    isNativeSpy?.mockRestore();
    restorePlatformOS();
    restoreDocument();
  });

  it("portals the toast onto document.body above the modal backdrop", async () => {
    const body = globalScope.document
      ? (globalScope.document as {body: TestHTMLElement}).body
      : undefined;
    let toastRef: ToastType | null = null;

    const Harness = (): ReactElement => {
      toastRef = useToastNotifications();
      return (
        <Modal onDismiss={() => {}} title="Confirm" visible>
          <Text>Modal body</Text>
        </Modal>
      );
    };

    const {getByText, UNSAFE_getAllByType} = renderWithTheme(
      <ToastProvider swipeEnabled={false}>
        <Harness />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(toastRef?.show).toBeDefined();
    });

    await act(async () => {
      toastRef?.show(TOAST_MESSAGE, {duration: 0, id: "above-modal"});
    });
    await flushFrames();

    const toastText = getByText(TOAST_MESSAGE);
    const toastHost = UNSAFE_getAllByType(KeyboardAvoidingView).find((node) =>
      isInside(toastText, node)
    );
    expect(toastHost).toBeTruthy();

    const hostStyle = flattenStyle(toastHost?.props.style);
    expect(hostStyle.pointerEvents).toBe("box-none");
    expect(hostStyle.zIndex).toBeGreaterThan(REACT_NATIVE_WEB_MODAL_Z_INDEX);

    expect(portalContainerFor(toastText)).toBe(body);

    const backdrop = findBackdrop(UNSAFE_getAllByType(Pressable));
    expect(backdrop).toBeTruthy();
    expect(isInside(toastText, backdrop as ReactTestInstance)).toBe(false);
  });
});

describe("Toast container on native", () => {
  afterEach(() => {
    restorePlatformOS();
    restoreDocument();
  });

  it("keeps the toast in the tree when a document body exists", async () => {
    setPlatformOS("ios");
    installDocumentBody();

    let toastRef: ToastType | null = null;
    const Harness = (): ReactElement => {
      toastRef = useToastNotifications();
      return <Text>App</Text>;
    };

    const {getByText} = render(
      <ToastProvider swipeEnabled={false}>
        <Harness />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(toastRef?.show).toBeDefined();
    });

    await act(async () => {
      toastRef?.show(TOAST_MESSAGE, {duration: 0, id: "native-toast"});
    });
    await flushFrames();

    const toastText = getByText(TOAST_MESSAGE);
    expect(portalContainerFor(toastText)).toBeUndefined();
  });
});
