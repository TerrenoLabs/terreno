import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act} from "@testing-library/react-native";
import {assert} from "chai";
import {createRef, forwardRef, useImperativeHandle, useRef} from "react";
import {Platform, Modal as RNModal, Text, View} from "react-native";

import {SimpleContent, useCombinedRefs} from "./ModalSheet";
import {renderWithTheme} from "./test-utils";
import * as Utilities from "./Utilities";

const openMock = mock(() => {});
const closeMock = mock(() => {});

mock.module("react-native-modalize", () => ({
  Modalize: forwardRef<React.ElementRef<typeof View>, {children: React.ReactNode}>(
    ({children}, ref) => {
      // The Modalize double exposes only the open/close handle ModalSheet calls.
      useImperativeHandle(
        ref,
        () => ({close: closeMock, open: openMock}) as unknown as React.ElementRef<typeof View>
      );
      return (
        <View ref={ref} testID="modalize">
          {children}
        </View>
      );
    }
  ),
}));

describe("ModalSheet", () => {
  it("renders correctly with children", () => {
    const {toJSON} = renderWithTheme(
      <SimpleContent>
        <Text>Test Content</Text>
      </SimpleContent>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("SimpleContent is defined", () => {
    expect(SimpleContent).toBeDefined();
  });

  it("useCombinedRefs is defined", () => {
    expect(useCombinedRefs).toBeDefined();
    expect(typeof useCombinedRefs).toBe("function");
  });

  it("useCombinedRefs combines multiple refs", () => {
    const TestComponent = () => {
      const ref1 = useRef<View>(null);
      const ref2 = useRef<View>(null);
      const combinedRef = useCombinedRefs(ref1, ref2);
      return <View ref={combinedRef} testID="combined-ref-view" />;
    };

    const {getByTestId} = renderWithTheme(<TestComponent />);
    expect(getByTestId("combined-ref-view")).toBeTruthy();
  });

  it("exposes open and close on the forwarded ref", () => {
    const sheetRef = createRef<{close: () => void; open: () => void}>();
    renderWithTheme(
      <SimpleContent ref={sheetRef}>
        <Text>Sheet body</Text>
      </SimpleContent>
    );
    sheetRef.current?.open();
    sheetRef.current?.close();
    expect(openMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });

  it("useCombinedRefs forwards the node to callback refs, object refs, and skips undefined", () => {
    const callbackRef = mock((_node: View | null) => {});
    const objectRef: {current: View | null} = {current: null};
    const TestComponent = () => {
      const combinedRef = useCombinedRefs<View>(callbackRef, undefined, objectRef);
      return <View ref={combinedRef} testID="combined-ref-view" />;
    };

    const {getByTestId} = renderWithTheme(<TestComponent />);
    expect(getByTestId("combined-ref-view")).toBeTruthy();
    expect(callbackRef).toHaveBeenCalledTimes(1);
    expect(objectRef.current).toBe(callbackRef.mock.calls[0][0]);
  });

  it("SimpleContent forwards open and close through a callback ref", () => {
    const forwarded = mock((_handle: {close: () => void; open: () => void} | null) => {});
    renderWithTheme(
      <SimpleContent ref={forwarded}>
        <Text>Test Content</Text>
      </SimpleContent>
    );
    expect(forwarded).toHaveBeenCalledTimes(1);
  });
});

describe("ModalSheet on web", () => {
  const globalScope = globalThis as {document?: unknown; HTMLElement?: unknown};
  const originalOS = Platform.OS;
  const originalDocument = globalScope.document;
  const originalHTMLElement = globalScope.HTMLElement;

  class FakeHTMLElement {
    blur = mock(() => {});
  }

  let isNativeSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    Platform.OS = "web";
    isNativeSpy = spyOn(Utilities, "isNative").mockReturnValue(false);
    globalScope.HTMLElement = FakeHTMLElement;
    globalScope.document = {activeElement: null};
    openMock.mockClear();
    closeMock.mockClear();
  });

  afterEach(() => {
    isNativeSpy?.mockRestore();
    isNativeSpy = undefined;
    Platform.OS = originalOS;
    globalScope.document = originalDocument;
    globalScope.HTMLElement = originalHTMLElement;
  });

  it("renders a hidden Modal instead of Modalize", () => {
    const {queryByTestId, UNSAFE_getAllByType} = renderWithTheme(
      <SimpleContent>
        <Text>Web body</Text>
      </SimpleContent>
    );
    assert.isNull(queryByTestId("modalize"));
    const modals = UNSAFE_getAllByType(RNModal);
    assert.lengthOf(modals, 1);
    assert.isFalse(modals[0].props.visible);
  });

  it("toggles the Modal visibility through the forwarded open and close handles", () => {
    const sheetRef = createRef<{close: () => void; open: () => void}>();
    const {UNSAFE_getAllByType} = renderWithTheme(
      <SimpleContent ref={sheetRef}>
        <Text>Web body</Text>
      </SimpleContent>
    );

    act(() => {
      sheetRef.current?.open();
    });
    assert.isTrue(UNSAFE_getAllByType(RNModal)[0].props.visible);

    act(() => {
      sheetRef.current?.close();
    });
    assert.isFalse(UNSAFE_getAllByType(RNModal)[0].props.visible);

    assert.equal(openMock.mock.calls.length, 0);
    assert.equal(closeMock.mock.calls.length, 0);
  });
});
