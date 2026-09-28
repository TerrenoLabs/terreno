import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, render, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
// DropdownPanel.tsx reads `Platform.OS` through this ESM binding, so the web branch tests must mutate
// the same object the component observes.
import {Dimensions, Platform as ImportedPlatform, Pressable} from "react-native";

import {DropdownPanel} from "./DropdownPanel";
import {PortalContext} from "./PortalHost";
import {Text} from "./Text";
import {ThemeProvider} from "./Theme";
import {renderWithTheme} from "./test-utils";

describe("DropdownPanel", () => {
  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(
      <DropdownPanel>
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders the trigger label", () => {
    const {getByText} = renderWithTheme(
      <DropdownPanel label="Filters">
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(getByText("Filters")).toBeTruthy();
  });

  it("renders a compact icon-only trigger without the label", () => {
    const {getByTestId, queryByText} = renderWithTheme(
      <DropdownPanel iconOnly label="Filters" testID="f" triggerAccessibilityLabel="Filter Name">
        <Text>Body</Text>
      </DropdownPanel>
    );
    const trigger = getByTestId("f.trigger");
    expect(queryByText("Filters")).toBeNull();
    expect(trigger.props.accessibilityLabel).toBe("Filter Name");
    expect(trigger.props.accessibilityRole).toBe("button");
    expect(trigger.props.style.height).toBe(24);
    expect(trigger.props.style.width).toBe(24);
  });

  it("opens the panel from the icon-only trigger", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DropdownPanel iconOnly testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(queryByTestId("f.panel")).toBeNull();
    fireEvent.press(getByTestId("f.trigger"));
    expect(getByTestId("f.panel")).toBeTruthy();
  });

  it("keeps the panel closed by default and open with defaultOpen", () => {
    const closed = renderWithTheme(
      <DropdownPanel testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(closed.queryByTestId("f.panel")).toBeNull();

    const open = renderWithTheme(
      <DropdownPanel defaultOpen testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(open.queryByTestId("f.panel")).toBeTruthy();
    expect(open.getByText("Body")).toBeTruthy();
  });

  it("hides the footer when action buttons are disabled", () => {
    const {queryByTestId} = renderWithTheme(
      <DropdownPanel defaultOpen showActionButtons={false} testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(queryByTestId("f.apply")).toBeNull();
    expect(queryByTestId("f.clear")).toBeNull();
    expect(queryByTestId("f.cancel")).toBeNull();
  });

  it("closes on outside click and calls onCancel", () => {
    const onCancel = mock();
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DropdownPanel defaultOpen onCancel={onCancel} testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    fireEvent.press(getByTestId("f.backdrop"));
    expect(onCancel).toHaveBeenCalled();
    expect(queryByTestId("f.panel")).toBeNull();
  });

  it("calls onClear and keeps the panel open when Clear is pressed", () => {
    const onClear = mock();
    const {getByTestId} = renderWithTheme(
      <DropdownPanel defaultOpen onClear={onClear} testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    fireEvent.press(getByTestId("f.clear"));
    expect(onClear).toHaveBeenCalled();
    expect(getByTestId("f.panel")).toBeTruthy();
  });

  it("calls onApply and closes when Apply is pressed", async () => {
    const onApply = mock();
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DropdownPanel defaultOpen onApply={onApply} testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    await act(async () => {
      fireEvent.press(getByTestId("f.apply"));
    });
    await waitFor(() => {
      expect(onApply).toHaveBeenCalled();
    });
    expect(queryByTestId("f.panel")).toBeNull();
  });

  it("toggles the panel from the trigger when uncontrolled", async () => {
    const onOpenChange = mock();
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DropdownPanel onOpenChange={onOpenChange} testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );

    await act(async () => {
      fireEvent.press(getByTestId("f.trigger"));
    });
    expect(queryByTestId("f.panel")).toBeTruthy();
    expect(onOpenChange).toHaveBeenCalledWith(true);

    await act(async () => {
      fireEvent.press(getByTestId("f.trigger"));
    });
    expect(queryByTestId("f.panel")).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("defers open state to the parent when controlled", async () => {
    const onOpenChange = mock();
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DropdownPanel isOpen onOpenChange={onOpenChange} testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );

    // A controlled DropdownPanel must stay open until the parent flips `isOpen`, even after a
    // dismissal that would close an uncontrolled panel.
    await act(async () => {
      fireEvent.press(getByTestId("f.cancel"));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(queryByTestId("f.panel")).toBeTruthy();
  });

  it("renders only the requested footer buttons", () => {
    const {queryByTestId, getByTestId} = renderWithTheme(
      <DropdownPanel defaultOpen showApplyButton={false} showClearButton={false} testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(queryByTestId("f.clear")).toBeNull();
    expect(queryByTestId("f.apply")).toBeNull();
    expect(getByTestId("f.cancel")).toBeTruthy();
  });

  it("hides the footer when every button is disabled", () => {
    const {queryByTestId} = renderWithTheme(
      <DropdownPanel
        defaultOpen
        showApplyButton={false}
        showCancelButton={false}
        showClearButton={false}
        testID="f"
      >
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(queryByTestId("f.clear")).toBeNull();
    expect(queryByTestId("f.apply")).toBeNull();
    expect(queryByTestId("f.cancel")).toBeNull();
  });

  it("uses custom footer button labels", () => {
    const {getByText} = renderWithTheme(
      <DropdownPanel
        applyButtonText="Save"
        cancelButtonText="Dismiss"
        clearButtonText="Reset"
        defaultOpen
        testID="f"
      >
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(getByText("Save")).toBeTruthy();
    expect(getByText("Dismiss")).toBeTruthy();
    expect(getByText("Reset")).toBeTruthy();
  });

  it("omits testIDs on the panel internals when no testID is provided", () => {
    const {queryByTestId, getByText} = renderWithTheme(
      <DropdownPanel defaultOpen>
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(getByText("Apply")).toBeTruthy();
    expect(queryByTestId("f.panel")).toBeNull();
  });
});

describe("DropdownPanel web platform", () => {
  const globalScope = globalThis as {document?: unknown; HTMLElement?: unknown};
  const originalDocument = globalScope.document;
  const originalHTMLElement = globalScope.HTMLElement;
  const originalPlatformOS = ImportedPlatform.OS;

  // The web branch requires `Platform.OS === "web"`, a `document`, and an `HTMLElement`
  // constructor (it checks `document.body instanceof HTMLElement` before portaling). The stub
  // body is intentionally not an HTMLElement so the overlay renders inline in the test tree
  // instead of going through a react-dom portal, which react-test-renderer cannot host.
  beforeEach(() => {
    (ImportedPlatform as {OS: string}).OS = "web";
    globalScope.HTMLElement = class FakeHTMLElement {};
    globalScope.document = {body: {}};
  });

  afterEach(() => {
    (ImportedPlatform as {OS: string}).OS = originalPlatformOS;
    globalScope.document = originalDocument;
    globalScope.HTMLElement = originalHTMLElement;
  });

  it("renders the fixed-position overlay once the trigger is measured", async () => {
    const {getByTestId, getByText} = renderWithTheme(
      <DropdownPanel defaultOpen testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );

    await waitFor(() => {
      expect(getByTestId("f.panel")).toBeTruthy();
    });
    const panelStyle = getByTestId("f.panel").props.style as {position?: string};
    assert.strictEqual(panelStyle.position, "fixed");
    expect(getByText("Body")).toBeTruthy();
  });

  it("closes from the web backdrop", async () => {
    const onCancel = mock();
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DropdownPanel defaultOpen onCancel={onCancel} testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );

    await waitFor(() => {
      expect(getByTestId("f.backdrop")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId("f.backdrop"));
    });
    expect(onCancel).toHaveBeenCalled();
    expect(queryByTestId("f.panel")).toBeNull();
  });
});

describe("DropdownPanel trigger", () => {
  it("renders a custom trigger and toggles the panel from it", async () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DropdownPanel
        renderTrigger={({isOpen, toggle}) => (
          <Pressable onPress={toggle} testID="custom-trigger">
            <Text>{isOpen ? "Close" : "Open"}</Text>
          </Pressable>
        )}
        testID="f"
      >
        <Text>Body</Text>
      </DropdownPanel>
    );

    expect(queryByTestId("f.trigger")).toBeNull();
    await act(async () => {
      fireEvent.press(getByTestId("custom-trigger"));
    });
    expect(getByTestId("f.panel")).toBeTruthy();
  });

  it("stretches the trigger wrapper when fullWidth is set", () => {
    const {getByTestId} = renderWithTheme(
      <DropdownPanel fullWidth testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect((getByTestId("f").props.style as {width?: string}).width).toBe("100%");
  });
});

describe("DropdownPanel portal host", () => {
  const manager = {mount: () => {}, unmount: () => {}, update: () => {}};

  it("teleports the panel to the portal host when one is mounted", async () => {
    const {getByTestId} = render(
      <ThemeProvider>
        <PortalContext.Provider value={manager as never}>
          <DropdownPanel defaultOpen testID="f">
            <Text>Body</Text>
          </DropdownPanel>
        </PortalContext.Provider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(getByTestId("f.panel")).toBeTruthy();
    });
    expect(getByTestId("portal")).toBeTruthy();
  });

  it("renders inline when no portal host is mounted", async () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DropdownPanel defaultOpen testID="f">
        <Text>Body</Text>
      </DropdownPanel>
    );
    expect(getByTestId("f.panel")).toBeTruthy();
    expect(queryByTestId("portal")).toBeNull();
  });
});

describe("DropdownPanel viewport clamping", () => {
  const originalGet = Dimensions.get;

  afterEach(() => {
    (Dimensions as {get: typeof originalGet}).get = originalGet;
  });

  it("keeps a panel wider than the viewport inside the screen margin", () => {
    (Dimensions as {get: unknown}).get = () => ({fontScale: 1, height: 600, scale: 1, width: 240});
    const {getByTestId} = renderWithTheme(
      <DropdownPanel defaultOpen testID="f" width={320}>
        <Text>Body</Text>
      </DropdownPanel>
    );
    const style = getByTestId("f.panel").props.style as {maxHeight?: number; width?: number};
    // A 320px panel cannot fit a 240px screen, so it renders at the margin-to-margin width.
    expect(style.width).toBe(224);
    expect(style.maxHeight).toBeGreaterThan(0);
  });
});
