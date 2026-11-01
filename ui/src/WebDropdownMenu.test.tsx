import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, renderHook} from "@testing-library/react-native";
import {assert} from "chai";
import type {ComponentProps} from "react";
import {Dimensions} from "react-native";

import {findAllByHostType, renderWithTheme} from "./test-utils";
import {
  resolveDocumentBodyPortalTarget,
  scheduleAfterPaint,
  useWebDropdownAnchor,
  type WebDropdownAnchor,
  WebDropdownMenu,
} from "./WebDropdownMenu";

describe("WebDropdownMenu", () => {
  const anchor = {height: 40, width: 200, x: 16, y: 32};
  const options = [
    {label: "Option A", value: "a"},
    {label: "Option B", value: "b"},
    {label: "Option C", value: "c"},
  ];

  it("marks the underlying Modal hidden when not visible", () => {
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible={false}
      />
    );
    expect(getByTestId("web_dropdown_modal").props.visible).toBe(false);
  });

  it("marks the underlying Modal visible when open", () => {
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );
    expect(getByTestId("web_dropdown_modal").props.visible).toBe(true);
  });

  it("renders every option when visible", () => {
    const {getByText} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        selectedValue="b"
        visible
      />
    );
    expect(getByText("Option A")).toBeTruthy();
    expect(getByText("Option B")).toBeTruthy();
    expect(getByText("Option C")).toBeTruthy();
  });

  it("invokes onSelect with value and index when an option is pressed", () => {
    const onSelect = mock((_value: string, _index: number) => {});
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={onSelect}
        options={options}
        visible
      />
    );
    fireEvent.press(getByTestId("web_dropdown_option_b"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]).toEqual(["b", 1]);
  });

  it("invokes onClose when the backdrop is pressed", () => {
    const onClose = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={onClose}
        onSelect={() => {}}
        options={options}
        visible
      />
    );
    fireEvent.press(getByTestId("web_dropdown_backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("anchors the menu below the trigger using the provided anchor", () => {
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );
    const menu = getByTestId("web_dropdown_menu");
    const style = Array.isArray(menu.props.style)
      ? Object.assign({}, ...menu.props.style)
      : menu.props.style;
    expect(style.left).toBe(anchor.x);
    expect(style.top).toBe(anchor.y + anchor.height + 4);
    expect(style.width).toBe(anchor.width);
  });

  it("uses the custom testID prefix when provided", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        testIDPrefix="badge_menu"
        visible
      />
    );
    expect(getByTestId("badge_menu_menu")).toBeTruthy();
    expect(getByTestId("badge_menu_backdrop")).toBeTruthy();
    expect(getByTestId("badge_menu_option_a")).toBeTruthy();
    expect(queryByTestId("web_dropdown_menu")).toBeNull();
  });

  it("highlights the option matched by selectedIndex regardless of duplicated values", () => {
    const dupOptions = [
      {label: "Placeholder", value: ""},
      {label: "Blank option", value: ""},
      {label: "Real", value: "real"},
    ];
    const {getByText} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={dupOptions}
        selectedIndex={1}
        visible
      />
    );
    expect(getByText("Blank option").props.style.fontWeight).toBe("600");
    expect(getByText("Placeholder").props.style.fontWeight).toBe("400");
    expect(getByText("Real").props.style.fontWeight).toBe("400");
  });

  it("applies dynamic background via the Pressable style callback", () => {
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        selectedValue="b"
        visible
      />
    );
    const optionPressable = getByTestId("web_dropdown_option_a");
    const styleFn = optionPressable.props.style;
    expect(typeof styleFn).toBe("function");
    const defaultStyle = styleFn({hovered: false, pressed: false});
    const hoveredStyle = styleFn({hovered: true, pressed: false});
    const pressedStyle = styleFn({hovered: false, pressed: true});
    expect(defaultStyle.paddingHorizontal).toBe(12);
    expect(defaultStyle.paddingVertical).toBe(10);
    expect(hoveredStyle.backgroundColor).toBeDefined();
    expect(pressedStyle.backgroundColor).toBeDefined();
  });

  it("renders option helper text under the label", () => {
    const optsWithHelper = [
      {helperText: "Extra detail", label: "Alpha", value: "a"},
      {label: "Beta", value: "b"},
    ];
    const {getByText} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        disableSearch
        onClose={() => {}}
        onSelect={() => {}}
        options={optsWithHelper}
        visible
      />
    );
    expect(getByText("Extra detail")).toBeTruthy();
    expect(getByText("Alpha")).toBeTruthy();
  });

  it("filters options by helper text in the menu search", async () => {
    const optsWithHelper = [
      {helperText: "red berry", label: "Apple", value: "apple"},
      {label: "Banana", value: "banana"},
    ];
    const {getByText, getByTestId, queryByText} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={optsWithHelper}
        visible
      />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("web_dropdown_search"), "berry");
    });
    expect(getByText("Apple")).toBeTruthy();
    expect(queryByText("Banana")).toBeNull();
  });
});

describe("WebDropdownMenu positioning", () => {
  const options = [
    {label: "Option A", value: "a"},
    {label: "Option B", value: "b"},
  ];

  it("positions the menu above the trigger when near the bottom of the screen", () => {
    // Window height is mocked to 812. Place the trigger near the bottom so
    // there is not enough room (< 300px) below it.
    const bottomAnchor = {height: 40, width: 200, x: 16, y: 750};
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={bottomAnchor}
        disableSearch
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );
    const menu = getByTestId("web_dropdown_menu");
    const style = Array.isArray(menu.props.style)
      ? Object.assign({}, ...menu.props.style)
      : menu.props.style;
    // Menu should open above: bottom-anchored so it sits flush above the trigger.
    expect(style.bottom).toBe(812 - bottomAnchor.y + 4);
    expect(style.top).toBeUndefined();
  });

  it("positions the menu below the trigger when there is room below", () => {
    const topAnchor = {height: 40, width: 200, x: 16, y: 32};
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={topAnchor}
        disableSearch
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );
    const menu = getByTestId("web_dropdown_menu");
    const style = Array.isArray(menu.props.style)
      ? Object.assign({}, ...menu.props.style)
      : menu.props.style;
    expect(style.top).toBe(topAnchor.y + topAnchor.height + 4);
    expect(style.bottom).toBeUndefined();
    expect(style.maxHeight).toBe(300);
  });

  it("clamps maxHeight to available space when opening above", () => {
    const originalGet = Dimensions.get;
    Dimensions.get = () => ({fontScale: 1, height: 400, scale: 1, width: 375});
    try {
      // windowHeight=400, anchor y=200 + height=40 + gap=4 => spaceBelow=156.
      // Opens above because 156 < 300 and 200 > 156.
      const midAnchor = {height: 40, width: 200, x: 16, y: 200};
      const {getByTestId} = renderWithTheme(
        <WebDropdownMenu
          anchor={midAnchor}
          disableSearch
          onClose={() => {}}
          onSelect={() => {}}
          options={options}
          visible
        />
      );
      const menu = getByTestId("web_dropdown_menu");
      const style = Array.isArray(menu.props.style)
        ? Object.assign({}, ...menu.props.style)
        : menu.props.style;
      expect(style.bottom).toBe(400 - midAnchor.y + 4);
      expect(style.top).toBeUndefined();
      expect(style.maxHeight).toBe(midAnchor.y - 4);
    } finally {
      Dimensions.get = originalGet;
    }
  });
});

describe("WebDropdownMenu disableSearch", () => {
  const anchor = {height: 40, width: 200, x: 16, y: 32};
  const options = [
    {label: "Apple", value: "apple"},
    {label: "Banana", value: "banana"},
    {label: "Cherry", value: "cherry"},
    {label: "Avocado", value: "avocado"},
  ];

  it("renders a search input by default (search is enabled when disableSearch is omitted)", () => {
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );
    expect(getByTestId("web_dropdown_search")).toBeTruthy();
  });

  it("does not render a search input when disableSearch is true", () => {
    const {queryByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        disableSearch
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );
    expect(queryByTestId("web_dropdown_search")).toBeNull();
  });

  it("filters options by label when the user types in the search input", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );

    fireEvent.changeText(getByTestId("web_dropdown_search"), "a");
    expect(getByTestId("web_dropdown_option_apple")).toBeTruthy();
    expect(getByTestId("web_dropdown_option_banana")).toBeTruthy();
    expect(getByTestId("web_dropdown_option_avocado")).toBeTruthy();
    expect(queryByTestId("web_dropdown_option_cherry")).toBeNull();
  });

  it("shows 'No matching options' when filter matches nothing", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );

    fireEvent.changeText(getByTestId("web_dropdown_search"), "zzz");
    expect(getByTestId("web_dropdown_no_results")).toBeTruthy();
    expect(queryByTestId("web_dropdown_option_apple")).toBeNull();
  });

  it("reports the original index when selecting a filtered option", () => {
    const onSelect = mock((_value: string, _index: number) => {});
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={onSelect}
        options={options}
        visible
      />
    );

    fireEvent.changeText(getByTestId("web_dropdown_search"), "cherry");
    fireEvent.press(getByTestId("web_dropdown_option_cherry"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]).toEqual(["cherry", 2]);
  });

  it("performs case-insensitive filtering", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );

    fireEvent.changeText(getByTestId("web_dropdown_search"), "BANANA");
    expect(getByTestId("web_dropdown_option_banana")).toBeTruthy();
    expect(queryByTestId("web_dropdown_option_apple")).toBeNull();
  });

  it("shows all options when search input is empty", () => {
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );

    fireEvent.changeText(getByTestId("web_dropdown_search"), "ban");
    fireEvent.changeText(getByTestId("web_dropdown_search"), "");
    expect(getByTestId("web_dropdown_option_apple")).toBeTruthy();
    expect(getByTestId("web_dropdown_option_banana")).toBeTruthy();
    expect(getByTestId("web_dropdown_option_cherry")).toBeTruthy();
    expect(getByTestId("web_dropdown_option_avocado")).toBeTruthy();
  });

  it("shows empty state when options are empty and showEmptyStateWhenNoOptions is true", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        disableSearch
        onClose={() => {}}
        onSelect={() => {}}
        options={[]}
        showEmptyStateWhenNoOptions
        visible
      />
    );
    expect(getByTestId("web_dropdown_no_results")).toBeTruthy();
    expect(queryByTestId("web_dropdown_search")).toBeNull();
  });
});

describe("WebDropdownMenu keepTriggerFocus portal overlay", () => {
  const PlatformModule = require("react-native").Platform;
  const anchor = {height: 40, width: 200, x: 16, y: 32};
  const options = [
    {label: "Option A", value: "a"},
    {label: "Option B", value: "b"},
  ];

  let savedOS: string;
  let hadDocument = false;
  let savedDocument: Document | undefined;
  let keyupListeners: Array<(event: KeyboardEvent) => void> = [];

  const ensureWebDocument = (): void => {
    hadDocument = "document" in globalThis;
    savedDocument = (globalThis as {document?: Document}).document;
    keyupListeners = [];

    if (typeof (globalThis as {HTMLElement?: typeof HTMLElement}).HTMLElement === "undefined") {
      (globalThis as {HTMLElement: typeof HTMLElement}).HTMLElement =
        class HTMLElement {} as typeof HTMLElement;
    }

    const activeElement = new (globalThis as {HTMLElement: typeof HTMLElement}).HTMLElement();
    (activeElement as HTMLElement & {blur: () => void}).blur = () => {};

    const body = {appendChild: () => {}, removeChild: () => {}};

    (globalThis as {document: Document}).document = {
      activeElement,
      addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
        if (type === "keyup") {
          keyupListeners.push(listener);
        }
      },
      body: body as unknown as HTMLElement,
      removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
        if (type === "keyup") {
          keyupListeners = keyupListeners.filter((registered) => registered !== listener);
        }
      },
    } as unknown as Document;
  };

  const restoreWebDocument = (): void => {
    if (hadDocument) {
      (globalThis as {document: Document}).document = savedDocument as Document;
    } else {
      delete (globalThis as {document?: Document}).document;
    }
    keyupListeners = [];
  };

  const dispatchEscapeKey = (): void => {
    const event = {key: "Escape", stopPropagation: mock(() => {})} as unknown as KeyboardEvent;
    for (const listener of keyupListeners) {
      listener(event);
    }
  };

  const renderKeepFocusMenu = (
    props: Partial<ComponentProps<typeof WebDropdownMenu>> = {}
  ): ReturnType<typeof renderWithTheme> => {
    return renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        disableSearch
        keepTriggerFocus
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
        {...props}
      />
    );
  };

  it("resolves document.body as the portal target when it is an HTMLElement", () => {
    ensureWebDocument();
    const body = new (globalThis as {HTMLElement: typeof HTMLElement}).HTMLElement();
    Object.defineProperty((globalThis as {document: Document}).document, "body", {
      configurable: true,
      value: body,
    });
    try {
      assert.strictEqual(resolveDocumentBodyPortalTarget(), body);
    } finally {
      restoreWebDocument();
    }
  });

  it("renders fixed-position overlay instead of Modal when keepTriggerFocus is true on web", () => {
    ensureWebDocument();
    savedOS = PlatformModule.OS;
    try {
      PlatformModule.OS = "web";
      const {getByTestId, queryByTestId, root} = renderKeepFocusMenu();
      expect(getByTestId("web_dropdown_backdrop")).toBeTruthy();
      expect(getByTestId("web_dropdown_menu")).toBeTruthy();
      expect(queryByTestId("web_dropdown_modal")).toBeNull();

      const menu = getByTestId("web_dropdown_menu");
      const style = Array.isArray(menu.props.style)
        ? Object.assign({}, ...menu.props.style)
        : menu.props.style;
      expect(style.position).toBe("fixed");
      expect(style.left).toBe(anchor.x);

      const modals = findAllByHostType(root, "Modal");
      expect(modals.length).toBe(0);
    } finally {
      PlatformModule.OS = savedOS;
      restoreWebDocument();
    }
  });

  it("renders in the body portal without requiring trigger focus retention", () => {
    ensureWebDocument();
    savedOS = PlatformModule.OS;
    try {
      PlatformModule.OS = "web";
      const {getByTestId, queryByTestId, root} = renderKeepFocusMenu({
        keepTriggerFocus: false,
        renderInBodyPortal: true,
      });

      assert.isOk(getByTestId("web_dropdown_menu"));
      assert.isNull(queryByTestId("web_dropdown_modal"));
      assert.equal(findAllByHostType(root, "Modal").length, 0);
    } finally {
      PlatformModule.OS = savedOS;
      restoreWebDocument();
    }
  });

  it("renders a placeholder view when keepTriggerFocus menu is closed on web", () => {
    ensureWebDocument();
    savedOS = PlatformModule.OS;
    try {
      PlatformModule.OS = "web";
      const {getByTestId, root} = renderKeepFocusMenu({visible: false});
      const placeholder = getByTestId("web_dropdown_modal");
      expect(placeholder.props.visible).toBeUndefined();

      const modals = findAllByHostType(root, "Modal");
      expect(modals.length).toBe(0);
    } finally {
      PlatformModule.OS = savedOS;
      restoreWebDocument();
    }
  });

  it("invokes onClose when the portal backdrop is pressed on web", () => {
    ensureWebDocument();
    savedOS = PlatformModule.OS;
    try {
      PlatformModule.OS = "web";
      const onClose = mock(() => {});
      const {getByTestId} = renderKeepFocusMenu({onClose});
      fireEvent.press(getByTestId("web_dropdown_backdrop"));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      PlatformModule.OS = savedOS;
      restoreWebDocument();
    }
  });

  it("invokes onClose when Escape is pressed in keepTriggerFocus mode on web", () => {
    ensureWebDocument();
    savedOS = PlatformModule.OS;
    try {
      PlatformModule.OS = "web";
      const onClose = mock(() => {});
      renderKeepFocusMenu({onClose});
      act(() => {
        dispatchEscapeKey();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      PlatformModule.OS = savedOS;
      restoreWebDocument();
    }
  });
});

describe("WebDropdownMenu centered presentation", () => {
  const anchor = {height: 40, width: 200, x: 16, y: 32};
  const options = [
    {label: "Option A", value: "a"},
    {label: "Option B", value: "b"},
  ];

  it("renders a centered dialog without anchor-based left/top positioning", () => {
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        disableSearch
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        presentation="centered"
        visible
      />
    );
    const menu = getByTestId("web_dropdown_menu");
    const style = Array.isArray(menu.props.style)
      ? Object.assign({}, ...menu.props.style)
      : menu.props.style;
    expect(style.borderRadius).toBe(8);
    expect(style.left).toBeUndefined();
    expect(style.top).toBeUndefined();
    expect(style.maxHeight).toBe(Math.round(812 * 0.55));
  });

  it("uses elevation without boxShadow on Android", () => {
    const PlatformModule = require("react-native").Platform;
    const savedOS = PlatformModule.OS;
    try {
      PlatformModule.OS = "android";
      const {getByTestId} = renderWithTheme(
        <WebDropdownMenu
          anchor={anchor}
          disableSearch
          onClose={() => {}}
          onSelect={() => {}}
          options={options}
          presentation="centered"
          visible
        />
      );
      const menu = getByTestId("web_dropdown_menu");
      const style = Array.isArray(menu.props.style)
        ? Object.assign({}, ...menu.props.style)
        : menu.props.style;
      expect(style.elevation).toBe(8);
      expect(style.boxShadow).toBeUndefined();
    } finally {
      PlatformModule.OS = savedOS;
    }
  });

  it("uses boxShadow without elevation on iOS", () => {
    const PlatformModule = require("react-native").Platform;
    const savedOS = PlatformModule.OS;
    try {
      PlatformModule.OS = "ios";
      const {getByTestId} = renderWithTheme(
        <WebDropdownMenu
          anchor={anchor}
          disableSearch
          onClose={() => {}}
          onSelect={() => {}}
          options={options}
          presentation="centered"
          visible
        />
      );
      const menu = getByTestId("web_dropdown_menu");
      const style = Array.isArray(menu.props.style)
        ? Object.assign({}, ...menu.props.style)
        : menu.props.style;
      expect(style.elevation).toBeUndefined();
      expect(style.boxShadow).toBe("0px 4px 12px rgba(0, 0, 0, 0.25)");
    } finally {
      PlatformModule.OS = savedOS;
    }
  });
});

describe("useWebDropdownAnchor", () => {
  it("exposes a default zero-sized anchor before measuring", () => {
    const {result} = renderHook(() => useWebDropdownAnchor());
    expect(result.current.anchor).toEqual({height: 0, width: 0, x: 0, y: 0});
    expect(result.current.triggerRef.current).toBeNull();
  });

  it("invokes the callback synchronously with the existing anchor when the ref is empty", () => {
    const {result} = renderHook(() => useWebDropdownAnchor());
    const onMeasured = mock((_anchor: WebDropdownAnchor) => {});
    act(() => {
      result.current.measure(onMeasured);
    });
    expect(onMeasured).toHaveBeenCalledTimes(1);
    expect(onMeasured.mock.calls[0][0]).toEqual({height: 0, width: 0, x: 0, y: 0});
  });

  it("measures the trigger and updates anchor state when the ref has measureInWindow", () => {
    const {result} = renderHook(() => useWebDropdownAnchor());
    const measureInWindow = mock((cb: (x: number, y: number, w: number, h: number) => void) => {
      cb(10, 20, 100, 40);
    });
    (result.current.triggerRef as {current: unknown}).current = {measureInWindow};
    const onMeasured = mock((_anchor: WebDropdownAnchor) => {});
    act(() => {
      result.current.measure(onMeasured);
    });
    expect(measureInWindow).toHaveBeenCalledTimes(1);
    expect(onMeasured).toHaveBeenCalledTimes(1);
    expect(onMeasured.mock.calls[0][0]).toEqual({height: 40, width: 100, x: 10, y: 20});
    expect(result.current.anchor).toEqual({height: 40, width: 100, x: 10, y: 20});
  });

  it("ignores an older measurement that completes after a newer request", () => {
    const {result} = renderHook(() => useWebDropdownAnchor());
    const callbacks: Array<(x: number, y: number, width: number, height: number) => void> = [];
    const measureInWindow = mock(
      (callback: (x: number, y: number, width: number, height: number) => void): void => {
        callbacks.push(callback);
      }
    );
    (result.current.triggerRef as {current: unknown}).current = {measureInWindow};
    const onFirstMeasured = mock(() => {});
    const onSecondMeasured = mock(() => {});

    act(() => {
      result.current.measure(onFirstMeasured);
      result.current.measure(onSecondMeasured);
    });
    act(() => {
      callbacks[1](20, 30, 120, 50);
      callbacks[0](10, 15, 100, 40);
    });

    assert.deepEqual(result.current.anchor, {height: 50, width: 120, x: 20, y: 30});
    assert.equal(onFirstMeasured.mock.calls.length, 0);
    assert.equal(onSecondMeasured.mock.calls.length, 1);
  });

  it("ignores a pending measurement after cancellation", () => {
    const {result} = renderHook(() => useWebDropdownAnchor());
    let completeMeasurement = (_x: number, _y: number, _width: number, _height: number): void => {};
    const measureInWindow = mock(
      (callback: (x: number, y: number, width: number, height: number) => void): void => {
        completeMeasurement = callback;
      }
    );
    (result.current.triggerRef as {current: unknown}).current = {measureInWindow};
    const onMeasured = mock(() => {});

    act(() => {
      result.current.measure(onMeasured);
      result.current.cancelPendingMeasurement();
      completeMeasurement(10, 20, 100, 40);
    });

    assert.deepEqual(result.current.anchor, {height: 0, width: 0, x: 0, y: 0});
    assert.equal(onMeasured.mock.calls.length, 0);
  });

  it("exercises the Pressable style callback for hover/pressed states", () => {
    const {root} = renderWithTheme(
      <WebDropdownMenu
        anchor={{height: 40, width: 100, x: 0, y: 50}}
        onClose={() => {}}
        onSelect={() => {}}
        options={[
          {label: "A", value: "a"},
          {label: "B", value: "b"},
        ]}
        visible
      />
    );
    // Find a Pressable with the style callback
    const pressables = root.findAll(
      (n) => typeof n.props.style === "function" && n.props["aria-role"] === "button"
    );
    expect(pressables.length).toBeGreaterThan(0);
    // Call the style function with different states to exercise all branches
    const styleFn = pressables[0].props.style;
    const normalStyle = styleFn({hovered: false, pressed: false});
    expect(normalStyle).toHaveProperty("paddingHorizontal");
    const hoveredStyle = styleFn({hovered: true, pressed: false});
    expect(hoveredStyle).toHaveProperty("paddingHorizontal");
    const pressedStyle = styleFn({hovered: false, pressed: true});
    expect(pressedStyle).toHaveProperty("paddingHorizontal");
  });
});

describe("scheduleAfterPaint", () => {
  it("uses requestAnimationFrame when it is available", () => {
    const original = globalThis.requestAnimationFrame;
    const raf = mock((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    (globalThis as {requestAnimationFrame?: typeof requestAnimationFrame}).requestAnimationFrame =
      raf as unknown as typeof requestAnimationFrame;
    try {
      const callback = mock(() => {});
      scheduleAfterPaint(callback);
      expect(raf).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      if (original) {
        globalThis.requestAnimationFrame = original;
      } else {
        (
          globalThis as {requestAnimationFrame?: typeof requestAnimationFrame}
        ).requestAnimationFrame = undefined;
      }
    }
  });

  it("falls back to setTimeout when requestAnimationFrame is unavailable", () => {
    const original = globalThis.requestAnimationFrame;
    (globalThis as {requestAnimationFrame?: typeof requestAnimationFrame}).requestAnimationFrame =
      undefined;
    try {
      const callback = mock(() => {});
      scheduleAfterPaint(callback);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      if (original) {
        globalThis.requestAnimationFrame = original;
      }
    }
  });
});

describe("WebDropdownMenu layout callbacks", () => {
  // scheduleAfterPaint defers to requestAnimationFrame; run callbacks synchronously so
  // scrolling happens inside the act() block that fires the layout events.
  const runAnimationFramesSynchronously = (): (() => void) => {
    const globals = globalThis as {requestAnimationFrame?: typeof requestAnimationFrame};
    const originalRaf = globals.requestAnimationFrame;
    globals.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as unknown as typeof requestAnimationFrame;
    return () => {
      globals.requestAnimationFrame = originalRaf;
    };
  };
  const anchor = {height: 40, width: 200, x: 16, y: 32};
  const options = [
    {label: "Option A", value: "a"},
    {label: "Option B", value: "b"},
    {label: "Option C", value: "c"},
  ];

  it("handles ScrollView onLayout without throwing", () => {
    const {root} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        disableSearch
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        selectedIndex={1}
        visible
      />
    );
    const scrollView = findAllByHostType(root, "ScrollView")[0];
    expect(scrollView).toBeTruthy();
    act(() => {
      fireEvent(scrollView, "layout", {nativeEvent: {layout: {height: 200, width: 200}}});
    });
    // The list viewport height is recorded and a scroll is scheduled; the
    // component should remain mounted and functional.
    expect(findAllByHostType(root, "ScrollView").length).toBeGreaterThan(0);
  });

  it("records option layout and schedules a scroll for the selected option", () => {
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        disableSearch
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        selectedIndex={1}
        visible
      />
    );
    act(() => {
      fireEvent(getByTestId("web_dropdown_option_a"), "layout", {
        nativeEvent: {layout: {height: 40, width: 200, x: 0, y: 0}},
      });
      // The selected option (index 1) triggers the scroll-into-view branch.
      fireEvent(getByTestId("web_dropdown_option_b"), "layout", {
        nativeEvent: {layout: {height: 40, width: 200, x: 0, y: 40}},
      });
    });
    expect(getByTestId("web_dropdown_option_b")).toBeTruthy();
  });

  it("centers the selected option once its layout and the viewport height are known", () => {
    const restoreRaf = runAnimationFramesSynchronously();

    try {
      const {getByTestId, root} = renderWithTheme(
        <WebDropdownMenu
          anchor={anchor}
          disableSearch
          onClose={() => {}}
          onSelect={() => {}}
          options={options}
          selectedIndex={2}
          visible
        />
      );

      const scrollView = findAllByHostType(root, "ScrollView")[0];
      const scrollCalls: Array<{animated?: boolean; y?: number}> = [];
      const scrollRef = scrollView.props.ref as {current: unknown};
      scrollRef.current = {
        scrollTo: (options: {animated?: boolean; y?: number}) => {
          scrollCalls.push(options);
        },
      };

      act(() => {
        fireEvent(getByTestId("web_dropdown_option_c"), "layout", {
          nativeEvent: {layout: {height: 40, width: 200, x: 0, y: 80}},
        });
        fireEvent(scrollView, "layout", {nativeEvent: {layout: {height: 60, width: 200}}});
      });

      // offset 80 - viewport 60 / 2 + height 40 / 2 = 70
      assert.deepEqual(scrollCalls, [{animated: false, y: 70}]);
    } finally {
      restoreRaf();
    }
  });

  it("clamps the centered scroll offset at the top of the list", () => {
    const restoreRaf = runAnimationFramesSynchronously();

    try {
      const {getByTestId, root} = renderWithTheme(
        <WebDropdownMenu
          anchor={anchor}
          disableSearch
          onClose={() => {}}
          onSelect={() => {}}
          options={options}
          selectedIndex={0}
          visible
        />
      );

      const scrollView = findAllByHostType(root, "ScrollView")[0];
      const scrollCalls: Array<{animated?: boolean; y?: number}> = [];
      const scrollRef = scrollView.props.ref as {current: unknown};
      scrollRef.current = {
        scrollTo: (options: {animated?: boolean; y?: number}) => {
          scrollCalls.push(options);
        },
      };

      act(() => {
        fireEvent(scrollView, "layout", {nativeEvent: {layout: {height: 200, width: 200}}});
        fireEvent(getByTestId("web_dropdown_option_a"), "layout", {
          nativeEvent: {layout: {height: 40, width: 200, x: 0, y: 0}},
        });
      });

      assert.deepEqual(scrollCalls, [{animated: false, y: 0}]);
    } finally {
      restoreRaf();
    }
  });

  it("does not scroll when the list viewport height has not been measured yet", () => {
    const restoreRaf = runAnimationFramesSynchronously();

    try {
      const {getByTestId, root} = renderWithTheme(
        <WebDropdownMenu
          anchor={anchor}
          disableSearch
          onClose={() => {}}
          onSelect={() => {}}
          options={options}
          selectedIndex={1}
          visible
        />
      );

      const scrollView = findAllByHostType(root, "ScrollView")[0];
      const scrollCalls: Array<{animated?: boolean; y?: number}> = [];
      const scrollRef = scrollView.props.ref as {current: unknown};
      scrollRef.current = {
        scrollTo: (options: {animated?: boolean; y?: number}) => {
          scrollCalls.push(options);
        },
      };

      act(() => {
        fireEvent(getByTestId("web_dropdown_option_b"), "layout", {
          nativeEvent: {layout: {height: 40, width: 200, x: 0, y: 40}},
        });
      });

      assert.lengthOf(scrollCalls, 0);
    } finally {
      restoreRaf();
    }
  });

  it("does not schedule a scroll for option layout when nothing is selected", () => {
    const {getByTestId} = renderWithTheme(
      <WebDropdownMenu
        anchor={anchor}
        disableSearch
        onClose={() => {}}
        onSelect={() => {}}
        options={options}
        visible
      />
    );
    act(() => {
      fireEvent(getByTestId("web_dropdown_option_a"), "layout", {
        nativeEvent: {layout: {height: 40, width: 200, x: 0, y: 0}},
      });
    });
    expect(getByTestId("web_dropdown_option_a")).toBeTruthy();
  });
});
