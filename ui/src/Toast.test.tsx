import {beforeAll, describe, expect, it, mock} from "bun:test";
import {render} from "@testing-library/react-native";
import {Text as RNText} from "react-native";

import {Toast, useToast} from "./Toast";
import {ToastProvider} from "./ToastNotifications";
import {renderWithTheme} from "./test-utils";

interface RafGlobal {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
}

beforeAll(() => {
  const g = globalThis as unknown as RafGlobal;
  g.requestAnimationFrame = (callback: FrameRequestCallback) => {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  };
  g.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
});

describe("Toast", () => {
  it("lets clicks pass through the layout wrapper beside the toast", () => {
    const {toJSON} = renderWithTheme(<Toast title="Pass through" />);
    const wrapper = toJSON() as {props: {style: unknown}};
    const style = Object.assign({}, ...[wrapper.props.style].flat()) as {pointerEvents?: string};
    expect(style.pointerEvents).toBe("box-none");
  });

  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(<Toast title="Test message" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders title correctly", () => {
    const {getByText} = renderWithTheme(<Toast title="Success!" />);
    expect(getByText("Success!")).toBeTruthy();
  });

  it("renders info variant (default)", () => {
    const {toJSON} = renderWithTheme(<Toast title="Info message" variant="info" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders success variant", () => {
    const {toJSON} = renderWithTheme(<Toast title="Success!" variant="success" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders warning variant", () => {
    const {toJSON} = renderWithTheme(<Toast title="Warning!" variant="warning" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders error variant", () => {
    const {toJSON} = renderWithTheme(<Toast title="Error!" variant="error" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with small size (default)", () => {
    const {toJSON} = renderWithTheme(<Toast size="sm" title="Small toast" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with large size", () => {
    const {toJSON} = renderWithTheme(<Toast size="lg" title="Large toast" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with subtitle when size is large", () => {
    const {getByText, toJSON} = renderWithTheme(
      <Toast size="lg" subtitle="Additional details here" title="Main message" />
    );
    expect(getByText("Main message")).toBeTruthy();
    expect(getByText("Additional details here")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders persistent toast with dismiss button", () => {
    const handleDismiss = mock(() => {});
    const {toJSON} = renderWithTheme(
      <Toast onDismiss={handleDismiss} persistent title="Persistent toast" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders dismiss button when persistent with onDismiss", () => {
    const handleDismiss = mock(() => {});
    const {toJSON} = renderWithTheme(
      <Toast onDismiss={handleDismiss} persistent title="Dismissible" />
    );
    // Verify dismiss button is rendered
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders action button when buttonText and buttonOnClick are provided", () => {
    const handleClick = mock(() => {});
    const {getByTestId, getByText} = renderWithTheme(
      <Toast
        buttonOnClick={handleClick}
        buttonText="Resolve"
        persistent
        title="Sync needs attention"
        variant="warning"
      />
    );
    expect(getByText("Resolve")).toBeTruthy();
    const button = getByTestId("toast-action-button");
    expect(button).toBeTruthy();
    button.props.onClick?.();
    button.props.onPress?.();
    expect(handleClick).toHaveBeenCalled();
  });

  it("suffixes the action button testID with the toast id so stacked toasts do not collide", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <>
        <Toast
          buttonOnClick={() => {}}
          buttonText="Resolve"
          id="sync-conflicts-todos"
          persistent
          title="Todos need attention"
          variant="warning"
        />
        <Toast
          buttonOnClick={() => {}}
          buttonText="Retry"
          id="sync-failed-notes"
          persistent
          title="Notes need attention"
          variant="warning"
        />
      </>
    );
    // getByTestId throws on multiple matches — the shared testID would fail here.
    expect(getByTestId("toast-action-button-sync-conflicts-todos")).toBeTruthy();
    expect(getByTestId("toast-action-button-sync-failed-notes")).toBeTruthy();
    expect(queryByTestId("toast-action-button")).toBeNull();
  });

  it("gives the action button an accessibilityRole of button", () => {
    const {getByTestId} = renderWithTheme(
      <Toast buttonOnClick={() => {}} buttonText="Resolve" persistent title="Sync" />
    );
    expect(getByTestId("toast-action-button").props.accessibilityRole).toBe("button");
  });

  it("does not render action button when only buttonText is provided", () => {
    const {queryByTestId} = renderWithTheme(
      <Toast buttonText="Resolve" title="Sync needs attention" variant="warning" />
    );
    expect(queryByTestId("toast-action-button")).toBeNull();
  });

  it("renders all variants with large size correctly", () => {
    const variants = ["info", "success", "warning", "error"] as const;
    variants.forEach((variant) => {
      const {toJSON} = renderWithTheme(
        <Toast size="lg" subtitle="Details" title={`${variant} toast`} variant={variant} />
      );
      expect(toJSON()).toMatchSnapshot();
    });
  });
});

describe("useToast", () => {
  const renderHookWithProvider = (callback: (toast: ReturnType<typeof useToast>) => void) => {
    let hookResult: ReturnType<typeof useToast> | null = null;
    const Harness = () => {
      const toast = useToast();
      hookResult = toast;
      return <RNText>harness</RNText>;
    };
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    );
    if (hookResult) {
      callback(hookResult);
    }
    return hookResult!;
  };

  it("returns an object with expected methods", () => {
    const hook = renderHookWithProvider(() => {});
    expect(typeof hook.show).toBe("function");
    expect(typeof hook.success).toBe("function");
    expect(typeof hook.info).toBe("function");
    expect(typeof hook.warn).toBe("function");
    expect(typeof hook.error).toBe("function");
    expect(typeof hook.catch).toBe("function");
    expect(typeof hook.hide).toBe("function");
  });

  it("returns empty string from show when provider is not ready", () => {
    const originalWarn = console.warn;
    console.warn = mock(() => {});
    const Harness = () => {
      const toast = useToast();
      const result = toast.show("No provider");
      return <RNText>{result}</RNText>;
    };
    // Render without ToastProvider, so useToastNotifications returns no ref
    const {getByText} = renderWithTheme(<Harness />);
    expect(getByText("")).toBeTruthy();
    console.warn = originalWarn;
  });

  it("calls success, info, warn, error, show via hook without throwing", () => {
    const hook = renderHookWithProvider(() => {});
    expect(() => hook.success("success!")).not.toThrow();
    expect(() => hook.info("info!")).not.toThrow();
    expect(() => hook.warn("warn!")).not.toThrow();
    expect(() => hook.error("error!")).not.toThrow();
    expect(() => hook.show("plain", {variant: "info"})).not.toThrow();
    expect(() => hook.show("persistent", {persistent: true})).not.toThrow();
  });

  it("catch handles plain errors by printing the message", () => {
    const originalError = console.error;
    console.error = mock(() => {});
    const hook = renderHookWithProvider(() => {});
    expect(() => hook.catch(new Error("boom"), "Failed")).not.toThrow();
    expect(() => hook.catch("string error", "Failed")).not.toThrow();
    expect(() => hook.catch({error: "something"}, "Failed")).not.toThrow();
    console.error = originalError;
  });

  it("catch handles APIError by calling printAPIError", () => {
    const originalError = console.error;
    console.error = mock(() => {});
    const hook = renderHookWithProvider(() => {});
    const apiError = {
      errors: [{detail: "Something bad", status: "500", title: "API Error"}],
    };
    expect(() => hook.catch(apiError, "Request failed")).not.toThrow();
    console.error = originalError;
  });

  it("hide does not throw when id is valid", () => {
    const hook = renderHookWithProvider(() => {});
    expect(() => hook.hide("some-id")).not.toThrow();
  });
});
