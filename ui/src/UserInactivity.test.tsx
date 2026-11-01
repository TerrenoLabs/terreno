import {describe, expect, it, mock, spyOn} from "bun:test";
import {act} from "@testing-library/react-native";
import {
  type EmitterSubscription,
  type GestureResponderEvent,
  Keyboard,
  type KeyboardEventListener,
  PanResponder,
  type PanResponderCallbacks,
  type PanResponderGestureState,
  type PanResponderInstance,
} from "react-native";

import {Text} from "./Text";
import {renderWithTheme} from "./test-utils";
import {UserInactivity} from "./UserInactivity";

describe("UserInactivity", () => {
  it("renders children correctly", () => {
    const onAction = mock((_active: boolean) => {});
    const {getByText} = renderWithTheme(
      <UserInactivity onAction={onAction}>
        <Text>Test Content</Text>
      </UserInactivity>
    );
    expect(getByText("Test Content")).toBeTruthy();
  });

  it("renders with custom style", () => {
    const onAction = mock((_active: boolean) => {});
    const {toJSON} = renderWithTheme(
      <UserInactivity onAction={onAction} style={{backgroundColor: "red", flex: 2}}>
        <Text>Test Content</Text>
      </UserInactivity>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with default style when no style provided", () => {
    const onAction = mock((_active: boolean) => {});
    const {toJSON} = renderWithTheme(
      <UserInactivity onAction={onAction}>
        <Text>Test Content</Text>
      </UserInactivity>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls onAction with false after timeout", async () => {
    const onAction = mock((_active: boolean) => {});

    renderWithTheme(
      <UserInactivity onAction={onAction} timeForInactivity={50}>
        <Text>Test Content</Text>
      </UserInactivity>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(onAction).toHaveBeenCalledWith(false);
  });

  it("accepts timeForInactivity prop", () => {
    const onAction = mock((_active: boolean) => {});
    const {toJSON} = renderWithTheme(
      <UserInactivity onAction={onAction} timeForInactivity={5000}>
        <Text>Test Content</Text>
      </UserInactivity>
    );
    expect(toJSON()).toBeTruthy();
  });

  it("accepts isActive prop", () => {
    const onAction = mock((_active: boolean) => {});
    const {toJSON} = renderWithTheme(
      <UserInactivity isActive={true} onAction={onAction}>
        <Text>Test Content</Text>
      </UserInactivity>
    );
    expect(toJSON()).toBeTruthy();
  });

  it("renders multiple children", () => {
    const onAction = mock((_active: boolean) => {});
    const {getByText} = renderWithTheme(
      <UserInactivity onAction={onAction}>
        <Text>First Child</Text>
        <Text>Second Child</Text>
      </UserInactivity>
    );
    expect(getByText("First Child")).toBeTruthy();
    expect(getByText("Second Child")).toBeTruthy();
  });

  it("accepts skipKeyboard prop", () => {
    const onAction = mock((_active: boolean) => {});
    const {toJSON} = renderWithTheme(
      <UserInactivity onAction={onAction} skipKeyboard={true}>
        <Text>Test Content</Text>
      </UserInactivity>
    );
    expect(toJSON()).toBeTruthy();
  });

  it("clears any pending timer when unmounted before the timeout fires", () => {
    const onAction = mock((_active: boolean) => {});
    const {unmount} = renderWithTheme(
      <UserInactivity onAction={onAction} timeForInactivity={10_000}>
        <Text>Test Content</Text>
      </UserInactivity>
    );

    act(() => {
      unmount();
    });

    expect(onAction).not.toHaveBeenCalled();
  });

  it("removes keyboard listeners on unmount", () => {
    const onAction = mock((_active: boolean) => {});
    const removeHide = mock(() => {});
    const removeShow = mock(() => {});
    const addListenerSpy = spyOn(Keyboard, "addListener")
      .mockReturnValueOnce({remove: removeHide} as unknown as EmitterSubscription)
      .mockReturnValueOnce({remove: removeShow} as unknown as EmitterSubscription);

    const {unmount} = renderWithTheme(
      <UserInactivity onAction={onAction}>
        <Text>Test Content</Text>
      </UserInactivity>
    );

    act(() => {
      unmount();
    });

    expect(addListenerSpy).toHaveBeenCalled();
    expect(removeHide).toHaveBeenCalled();
    expect(removeShow).toHaveBeenCalled();
    addListenerSpy.mockRestore();
  });

  it("calls onAction with true when activity occurs after inactivity", async () => {
    const onAction = mock((_active: boolean) => {});
    let capturedHideCallback: (() => void) | undefined;
    const addListenerSpy = spyOn(Keyboard, "addListener").mockImplementation(
      (event: string, callback: KeyboardEventListener) => {
        if (event === "keyboardDidHide") {
          // UserInactivity's keyboard handler ignores the event payload.
          capturedHideCallback = callback as () => void;
        }
        return {remove: mock(() => {})} as unknown as EmitterSubscription;
      }
    );

    renderWithTheme(
      <UserInactivity onAction={onAction} timeForInactivity={30}>
        <Text>Test Content</Text>
      </UserInactivity>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(onAction).toHaveBeenCalledWith(false);

    await act(async () => {
      capturedHideCallback?.();
    });

    expect(onAction).toHaveBeenCalledWith(true);
    addListenerSpy.mockRestore();
  });

  it("resets the inactivity timer when a pan responder capture handler fires", () => {
    const onAction = mock((_active: boolean) => {});
    let capturedConfig: PanResponderCallbacks | undefined;
    const originalCreate = PanResponder.create;
    PanResponder.create = (config: PanResponderCallbacks): PanResponderInstance => {
      capturedConfig = config;
      return originalCreate(config);
    };

    try {
      const {unmount} = renderWithTheme(
        <UserInactivity onAction={onAction} skipKeyboard={true}>
          <Text>Test Content</Text>
        </UserInactivity>
      );

      expect(capturedConfig).toBeDefined();

      let shouldSet: boolean | undefined;
      act(() => {
        shouldSet = capturedConfig?.onStartShouldSetPanResponderCapture?.(
          {} as unknown as GestureResponderEvent,
          {} as unknown as PanResponderGestureState
        );
      });

      expect(shouldSet).toBe(false);
      act(() => {
        unmount();
      });
    } finally {
      PanResponder.create = originalCreate;
    }
  });
});
