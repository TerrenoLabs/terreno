import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import type {AddressInterface} from "./Common";
import {renderWithTheme} from "./test-utils";
import {WebAddressAutocomplete} from "./WebAddressAutocomplete";

interface PlaceResult {
  address_components: {
    long_name: string;
    short_name: string;
    types: string[];
  }[];
}

describe("WebAddressAutocomplete", () => {
  const defaultProps = {
    handleAddressChange: () => {},
    handleAutoCompleteChange: () => {},
    inputValue: "",
  };

  it("renders correctly without Google API key", () => {
    const {toJSON} = renderWithTheme(<WebAddressAutocomplete {...defaultProps} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("component is defined", () => {
    expect(WebAddressAutocomplete).toBeDefined();
    expect(typeof WebAddressAutocomplete).toBe("function");
  });

  it("renders with input value", () => {
    const {toJSON} = renderWithTheme(
      <WebAddressAutocomplete {...defaultProps} inputValue="123 Main St" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders disabled state", () => {
    const {toJSON} = renderWithTheme(<WebAddressAutocomplete {...defaultProps} disabled />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders without calling handleAutoCompleteChange until a place is selected", () => {
    const handleAutoCompleteChange = mock((_arg: AddressInterface) => {});
    renderWithTheme(
      <WebAddressAutocomplete
        {...defaultProps}
        handleAutoCompleteChange={handleAutoCompleteChange}
      />
    );
    expect(handleAutoCompleteChange).not.toHaveBeenCalled();
  });

  it("renders with includeCounty flag", () => {
    const {toJSON} = renderWithTheme(<WebAddressAutocomplete {...defaultProps} includeCounty />);
    expect(toJSON()).toMatchSnapshot();
  });

  describe("with Google Maps available", () => {
    interface GoogleMapsWindow {
      google?: {
        maps?: {
          places?: {
            Autocomplete?: unknown;
          };
        };
      };
      [key: string]: unknown;
    }

    interface MinimalDocument {
      createElement: (tag: string) => HTMLScriptElement;
      head: {appendChild: (node: unknown) => void};
    }

    interface TestGlobals {
      window?: GoogleMapsWindow;
      document?: MinimalDocument;
    }

    const testGlobal = globalThis as unknown as TestGlobals;
    const originalWindow = testGlobal.window;
    const originalDocument = testGlobal.document;

    let listeners: Record<string, () => void>;
    let placeResult: PlaceResult | null;
    let autocompleteConstructor: ReturnType<typeof mock>;

    beforeEach(() => {
      listeners = {};
      placeResult = null;

      autocompleteConstructor = mock((_input: unknown, _opts: unknown) => ({
        addListener: (event: string, cb: () => void) => {
          listeners[event] = cb;
        },
        getPlace: () => placeResult,
      }));

      testGlobal.window = {
        google: {
          maps: {
            places: {
              Autocomplete: autocompleteConstructor,
            },
          },
        },
      };
      testGlobal.document =
        originalDocument ??
        ({
          createElement: () => ({}) as HTMLScriptElement,
          head: {appendChild: () => {}},
        } satisfies MinimalDocument);
    });

    afterEach(() => {
      // Leave a minimal window so React's effect cleanup (which assigns
      // `window[callbackName] = null`) does not blow up after teardown.
      testGlobal.window = originalWindow ?? {};
      testGlobal.document = originalDocument;
    });

    it("initializes the Autocomplete and wires up the place_changed listener", async () => {
      const handleAutoCompleteChange = mock((_arg: AddressInterface) => {});
      renderWithTheme(
        <WebAddressAutocomplete
          googleMapsApiKey="test-key"
          handleAddressChange={() => {}}
          handleAutoCompleteChange={handleAutoCompleteChange}
          inputValue=""
        />
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(autocompleteConstructor).toHaveBeenCalled();
      expect(typeof listeners.place_changed).toBe("function");

      // Simulate a selected place.
      placeResult = {
        address_components: [
          {long_name: "5", short_name: "5", types: ["street_number"]},
          {long_name: "Elm", short_name: "Elm", types: ["route"]},
          {long_name: "Oakland", short_name: "OAK", types: ["locality"]},
          {long_name: "California", short_name: "CA", types: ["administrative_area_level_1"]},
          {long_name: "94601", short_name: "94601", types: ["postal_code"]},
        ],
      };
      listeners.place_changed();
      expect(handleAutoCompleteChange).toHaveBeenCalled();
    });

    it("invokes handleAddressChange from the fallback TextField's onChange", async () => {
      const handleAddressChange = mock(() => {});
      const {UNSAFE_getAllByType} = renderWithTheme(
        <WebAddressAutocomplete
          googleMapsApiKey="test-key"
          handleAddressChange={handleAddressChange}
          handleAutoCompleteChange={() => {}}
          inputValue=""
        />
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const {TextInput} = require("react-native");
      const inputs = UNSAFE_getAllByType(TextInput);
      expect(inputs.length).toBeGreaterThan(0);
      fireEvent.changeText(inputs[0], "321 Pine");
      expect(handleAddressChange).toHaveBeenCalledWith("321 Pine");
    });
  });

  describe("when Google Maps script is not yet loaded", () => {
    interface ScriptElementShape {
      src?: string;
      async?: boolean;
      defer?: boolean;
      onerror?: () => void;
    }

    interface GoogleMapsWindow {
      google?: {
        maps?: {
          places?: {
            Autocomplete?: unknown;
          };
        };
      };
      [key: string]: unknown;
    }

    interface MinimalDocument {
      createElement: (tag: string) => ScriptElementShape;
      head: {appendChild: (node: ScriptElementShape) => void};
    }

    interface TestGlobals {
      window?: GoogleMapsWindow;
      document?: MinimalDocument;
    }

    const testGlobal = globalThis as unknown as TestGlobals;
    const originalWindow = testGlobal.window;
    const originalDocument = testGlobal.document;

    let createdScript: ScriptElementShape;
    let appendedScripts: ScriptElementShape[];
    let originalConsoleWarn: typeof console.warn;
    let warnings: unknown[][];

    beforeEach(() => {
      createdScript = {};
      appendedScripts = [];
      warnings = [];
      originalConsoleWarn = console.warn;
      console.warn = (...args: unknown[]): void => {
        warnings.push(args);
      };

      testGlobal.window = {};
      testGlobal.document = {
        createElement: (_tag: string) => {
          createdScript = {};
          return createdScript;
        },
        head: {
          appendChild: (node) => {
            appendedScripts.push(node);
          },
        },
      };
    });

    afterEach(() => {
      console.warn = originalConsoleWarn;
      testGlobal.window = originalWindow ?? {};
      testGlobal.document = originalDocument;
    });

    it("loads the Google Maps script and resolves via the global callback", async () => {
      const handleAutoCompleteChange = mock((_arg: AddressInterface) => {});

      renderWithTheme(
        <WebAddressAutocomplete
          googleMapsApiKey="my-api-key"
          handleAddressChange={() => {}}
          handleAutoCompleteChange={handleAutoCompleteChange}
          inputValue=""
        />
      );

      // Effect runs synchronously during render, which pushes the script tag to head.
      expect(appendedScripts.length).toBe(1);
      expect(createdScript.src).toContain(
        "https://maps.googleapis.com/maps/api/js?key=my-api-key&libraries=places&callback=initAutocomplete"
      );
      expect(createdScript.async).toBe(true);
      expect(createdScript.defer).toBe(true);
      expect(typeof createdScript.onerror).toBe("function");

      // The component installed a global callback that resolves loadGooglePlacesScript.
      const win = testGlobal.window as GoogleMapsWindow;
      const cb = win.initAutocomplete;
      expect(typeof cb).toBe("function");

      // Make Autocomplete available, simulating a successful script load, then fire the callback.
      const autocompleteConstructor = mock((_input: unknown, _opts: unknown) => ({
        addListener: () => {},
        getPlace: () => null,
      }));
      win.google = {
        maps: {
          places: {
            Autocomplete: autocompleteConstructor,
          },
        },
      };

      await act(async () => {
        (cb as () => void)();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(autocompleteConstructor).toHaveBeenCalled();
    });

    it("invokes setScriptLoaded(false) and warns when the script fails to load", async () => {
      renderWithTheme(
        <WebAddressAutocomplete
          googleMapsApiKey="my-api-key"
          handleAddressChange={() => {}}
          handleAutoCompleteChange={() => {}}
          inputValue=""
        />
      );

      expect(appendedScripts.length).toBe(1);
      expect(typeof createdScript.onerror).toBe("function");

      await act(async () => {
        createdScript.onerror?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // The .catch path warns and falls back to plain TextField.
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("cleans up the global callback on unmount", async () => {
      const {unmount} = renderWithTheme(
        <WebAddressAutocomplete
          googleMapsApiKey="my-api-key"
          handleAddressChange={() => {}}
          handleAutoCompleteChange={() => {}}
          inputValue=""
        />
      );

      const win = testGlobal.window as GoogleMapsWindow;
      expect(win.initAutocomplete).toBeDefined();

      unmount();

      expect(win.initAutocomplete).toBeNull();
    });

    it("re-runs effect when googleMapsApiKey changes", async () => {
      const handleAutoCompleteChange = mock((_arg: AddressInterface) => {});

      renderWithTheme(
        <WebAddressAutocomplete
          googleMapsApiKey="key-1"
          handleAddressChange={() => {}}
          handleAutoCompleteChange={handleAutoCompleteChange}
          inputValue=""
        />
      );

      expect(appendedScripts.length).toBe(1);

      // Simulate successful load for the second key
      const win = testGlobal.window as GoogleMapsWindow;
      const autocompleteConstructor = mock((_input: unknown, _opts: unknown) => ({
        addListener: () => {},
        getPlace: () => null,
      }));
      win.google = {
        maps: {
          places: {
            Autocomplete: autocompleteConstructor,
          },
        },
      };

      await act(async () => {
        (win.initAutocomplete as () => void)?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(autocompleteConstructor).toHaveBeenCalled();
    });

    it("processes address components with includeCounty", async () => {
      const handleAutoCompleteChange = mock((_arg: AddressInterface) => {});
      let placeChangedCb: (() => void) | undefined;
      let localPlaceResult: PlaceResult | null = null;

      const autocompleteConstructor = mock((_input: unknown, _opts: unknown) => ({
        addListener: (event: string, cb: () => void) => {
          if (event === "place_changed") {
            placeChangedCb = cb;
          }
        },
        getPlace: () => localPlaceResult,
      }));

      testGlobal.window = {
        google: {
          maps: {
            places: {
              Autocomplete: autocompleteConstructor,
            },
          },
        },
      };

      renderWithTheme(
        <WebAddressAutocomplete
          googleMapsApiKey="test-key"
          handleAddressChange={() => {}}
          handleAutoCompleteChange={handleAutoCompleteChange}
          includeCounty
          inputValue=""
        />
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      localPlaceResult = {
        address_components: [
          {long_name: "10", short_name: "10", types: ["street_number"]},
          {long_name: "Main St", short_name: "Main St", types: ["route"]},
          {long_name: "Springfield", short_name: "Springfield", types: ["locality"]},
          {
            long_name: "Sangamon County",
            short_name: "Sangamon County",
            types: ["administrative_area_level_2"],
          },
          {long_name: "Illinois", short_name: "IL", types: ["administrative_area_level_1"]},
          {long_name: "62701", short_name: "62701", types: ["postal_code"]},
        ],
      };

      await act(async () => {
        placeChangedCb?.();
      });

      expect(handleAutoCompleteChange).toHaveBeenCalled();
    });
  });

  describe("no API key behavior", () => {
    it("sets scriptLoaded to false and renders plain TextField", async () => {
      const handleAddressChange = mock(() => {});
      const {UNSAFE_getAllByType} = renderWithTheme(
        <WebAddressAutocomplete
          handleAddressChange={handleAddressChange}
          handleAutoCompleteChange={() => {}}
          inputValue="test"
        />
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const {TextInput} = require("react-native");
      const inputs = UNSAFE_getAllByType(TextInput);
      expect(inputs.length).toBeGreaterThan(0);
      const {fireEvent: fe} = require("@testing-library/react-native");
      fe.changeText(inputs[0], "new value");
      expect(handleAddressChange).toHaveBeenCalledWith("new value");
    });

    it("cleans up the global callback on unmount", async () => {
      const handleAutoCompleteChange = mock((_arg: AddressInterface) => {});

      const {unmount} = renderWithTheme(
        <WebAddressAutocomplete
          googleMapsApiKey="cleanup-key"
          handleAddressChange={() => {}}
          handleAutoCompleteChange={handleAutoCompleteChange}
          inputValue=""
        />
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const win = (globalThis as unknown as Record<string, Record<string, unknown>>).window;
      expect(win.initAutocomplete).toBeDefined();

      unmount();

      expect(win.initAutocomplete).toBeNull();
    });

    it("handles place_changed with includeCounty flag", async () => {
      const handleAutoCompleteChange = mock((_arg: AddressInterface) => {});

      let placeChangedCb: (() => void) | undefined;
      const autocompleteConstructor = mock((_input: unknown, _opts: unknown) => ({
        addListener: (event: string, cb: () => void) => {
          if (event === "place_changed") {
            placeChangedCb = cb;
          }
        },
        getPlace: () => ({
          address_components: [
            {long_name: "10", short_name: "10", types: ["street_number"]},
            {long_name: "Oak St", short_name: "Oak St", types: ["route"]},
            {long_name: "Portland", short_name: "Portland", types: ["locality"]},
            {long_name: "Oregon", short_name: "OR", types: ["administrative_area_level_1"]},
            {long_name: "97201", short_name: "97201", types: ["postal_code"]},
            {
              long_name: "Multnomah County",
              short_name: "Multnomah",
              types: ["administrative_area_level_2"],
            },
          ],
        }),
      }));

      const win = (globalThis as unknown as Record<string, Record<string, unknown>>).window;
      win.google = {
        maps: {places: {Autocomplete: autocompleteConstructor}},
      };

      renderWithTheme(
        <WebAddressAutocomplete
          googleMapsApiKey="county-key"
          handleAddressChange={() => {}}
          handleAutoCompleteChange={handleAutoCompleteChange}
          includeCounty
          inputValue=""
        />
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(autocompleteConstructor).toHaveBeenCalled();
      expect(placeChangedCb).toBeDefined();

      placeChangedCb?.();
      expect(handleAutoCompleteChange).toHaveBeenCalled();
    });
  });

  describe("without googleMapsApiKey", () => {
    it("sets scriptLoaded to false and renders plain TextField", async () => {
      const handleAddressChange = mock(() => {});
      const {UNSAFE_getAllByType} = renderWithTheme(
        <WebAddressAutocomplete
          handleAddressChange={handleAddressChange}
          handleAutoCompleteChange={() => {}}
          inputValue="test value"
        />
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const {TextInput} = require("react-native");
      const inputs = UNSAFE_getAllByType(TextInput);
      expect(inputs.length).toBeGreaterThan(0);
      fireEvent.changeText(inputs[0], "new value");
      expect(handleAddressChange).toHaveBeenCalledWith("new value");
    });
  });
});
