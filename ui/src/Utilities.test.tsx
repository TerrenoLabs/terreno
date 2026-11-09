import {describe, expect, it} from "bun:test";

import type {APIError, BaseProfile} from "./Common";
import {
  applyColorOpacity,
  bind,
  concat,
  createBoxShadow,
  findAddressComponent,
  formattedCountyCode,
  fromClassName,
  fromInlineStyle,
  iconNumberToSize,
  identity,
  isAPIError,
  isNative,
  isTestUser,
  isValidGoogleApiKey,
  mapClassName,
  mapping,
  mergeInlineStyles,
  printAPIError,
  processAddressComponents,
  range,
  rangeWithoutZero,
  toggle,
  toProps,
  union,
} from "./Utilities";

describe("Utilities", () => {
  describe("mergeInlineStyles", () => {
    it("merges inline styles", () => {
      const existing = {__style: {color: "red"}};
      const newStyle = {backgroundColor: "blue"};
      const result = mergeInlineStyles(existing, newStyle);
      expect(result.__style).toEqual({backgroundColor: "blue", color: "red"});
    });

    it("handles undefined existing style", () => {
      const result = mergeInlineStyles(undefined, {color: "red"});
      expect(result.__style).toEqual({color: "red"});
    });

    it("handles undefined new style", () => {
      const result = mergeInlineStyles({__style: {color: "red"}}, undefined);
      expect(result.__style).toEqual({color: "red"});
    });
  });

  describe("isTestUser", () => {
    it("returns true for nang.io email", () => {
      expect(isTestUser({email: "test@nang.io"} as unknown as BaseProfile)).toBe(true);
    });

    it("returns true for example.com email", () => {
      expect(isTestUser({email: "test@example.com"} as unknown as BaseProfile)).toBe(true);
    });

    it("returns false for regular email", () => {
      expect(isTestUser({email: "user@company.com"} as unknown as BaseProfile)).toBe(false);
    });

    it("returns falsy for undefined profile", () => {
      expect(isTestUser(undefined)).toBeFalsy();
    });

    it("returns true for a subdomain of a test domain", () => {
      expect(isTestUser({email: "qa@mail.example.com"} as unknown as BaseProfile)).toBe(true);
      expect(isTestUser({email: "QA@NANG.IO"} as unknown as BaseProfile)).toBe(true);
    });

    it("returns false when a test domain only appears as a substring", () => {
      expect(isTestUser({email: "user@evil-example.com"} as unknown as BaseProfile)).toBe(false);
      expect(isTestUser({email: "user@example.com.evil.net"} as unknown as BaseProfile)).toBe(
        false
      );
      expect(isTestUser({email: "example.com@company.com"} as unknown as BaseProfile)).toBe(false);
      expect(isTestUser({email: "user@notnang.io"} as unknown as BaseProfile)).toBe(false);
    });

    it("returns falsy for profile without email", () => {
      expect(isTestUser({} as unknown as BaseProfile)).toBeFalsy();
    });
  });

  describe("iconNumberToSize", () => {
    it("returns xs for size less than 8", () => {
      expect(iconNumberToSize(5)).toBe("xs");
    });

    it("returns sm for size 8-11", () => {
      expect(iconNumberToSize(10)).toBe("sm");
    });

    it("returns md for size 12-13", () => {
      expect(iconNumberToSize(12)).toBe("md");
    });

    it("returns lg for size 14-19", () => {
      expect(iconNumberToSize(16)).toBe("lg");
    });

    it("returns xl for size 20+", () => {
      expect(iconNumberToSize(24)).toBe("xl");
    });

    it("returns lg for default size (16)", () => {
      expect(iconNumberToSize()).toBe("lg");
    });

    it("returns xs for zero", () => {
      expect(iconNumberToSize(0)).toBe("xs");
    });
  });

  describe("Style utilities", () => {
    describe("identity", () => {
      it("returns empty style", () => {
        const result = identity();
        expect(result.className.size).toBe(0);
        expect(Object.keys(result.inlineStyle).length).toBe(0);
      });
    });

    describe("fromClassName", () => {
      it("creates style from classnames", () => {
        const result = fromClassName("class1", "class2");
        expect(result.className.has("class1")).toBe(true);
        expect(result.className.has("class2")).toBe(true);
      });

      it("supports empty className list", () => {
        const result = fromClassName();
        expect(result.className.size).toBe(0);
      });
    });

    describe("fromInlineStyle", () => {
      it("creates style from inline styles", () => {
        const result = fromInlineStyle({color: "red", fontSize: 14});
        expect(result.inlineStyle).toEqual({color: "red", fontSize: 14});
      });
    });

    describe("concat", () => {
      it("concatenates multiple styles", () => {
        const style1 = fromClassName("class1");
        const style2 = fromClassName("class2");
        const style3 = fromInlineStyle({color: "red"});
        const result = concat([style1, style2, style3]);
        expect(result.className.has("class1")).toBe(true);
        expect(result.className.has("class2")).toBe(true);
        expect(result.inlineStyle.color).toBe("red");
      });

      it("concatenates with identity element", () => {
        const style = fromClassName("a");
        const result = concat([identity(), style]);
        expect(result.className.has("a")).toBe(true);
      });
    });

    describe("mapClassName", () => {
      it("maps class names through a function", () => {
        const prefix = mapClassName((name: string) => `prefix-${name}`);
        const style = fromClassName("foo", "bar");
        const result = prefix(style);
        expect(result.className.has("prefix-foo")).toBe(true);
        expect(result.className.has("prefix-bar")).toBe(true);
      });

      it("preserves inline styles", () => {
        const prefix = mapClassName((name: string) => `prefix-${name}`);
        const style = fromInlineStyle({color: "red"});
        const result = prefix(style);
        expect(result.inlineStyle.color).toBe("red");
      });
    });

    describe("toProps", () => {
      it("converts style to props object", () => {
        const style = concat([fromClassName("a", "b"), fromInlineStyle({color: "red"})]);
        const props = toProps(style);
        expect(props.className).toBe("a b");
        expect(props.style).toEqual({color: "red"});
      });

      it("omits empty className", () => {
        const style = fromInlineStyle({color: "red"});
        const props = toProps(style);
        expect(props.className).toBeUndefined();
      });

      it("omits empty style", () => {
        const style = fromClassName("class1");
        const props = toProps(style);
        expect(props.style).toBeUndefined();
      });
    });

    describe("toggle", () => {
      it("returns style with classnames when val is true", () => {
        const toggleFn = toggle("active", "enabled");
        const result = toggleFn(true);
        expect(result.className.has("active")).toBe(true);
        expect(result.className.has("enabled")).toBe(true);
      });

      it("returns identity when val is false", () => {
        const toggleFn = toggle("active");
        const result = toggleFn(false);
        expect(result.className.size).toBe(0);
      });

      it("returns identity when val is undefined", () => {
        const toggleFn = toggle("active");
        const result = toggleFn();
        expect(result.className.size).toBe(0);
      });
    });

    describe("mapping", () => {
      it("maps string to classname", () => {
        const map = mapping({large: "size-large", small: "size-small"});
        const result = map("small");
        expect(result.className.has("size-small")).toBe(true);
      });

      it("returns identity for unknown key", () => {
        const map = mapping({small: "size-small"});
        const result = map("unknown");
        expect(result.className.size).toBe(0);
      });
    });

    describe("range", () => {
      it("creates classname from positive number", () => {
        const result = range("padding")(3);
        expect(result.className.has("padding3")).toBe(true);
      });

      it("creates classname from negative number with N prefix", () => {
        const result = range("margin")(-2);
        expect(result.className.has("marginN2")).toBe(true);
      });

      it("creates classname from zero", () => {
        const result = range("padding")(0);
        expect(result.className.has("padding0")).toBe(true);
      });
    });

    describe("rangeWithoutZero", () => {
      it("creates classname for non-zero", () => {
        const result = rangeWithoutZero("padding")(2);
        expect(result.className.has("padding2")).toBe(true);
      });

      it("returns identity for zero", () => {
        const result = rangeWithoutZero("padding")(0);
        expect(result.className.size).toBe(0);
      });
    });

    describe("bind", () => {
      it("binds a functor to a scope", () => {
        const scope: {[key: string]: string} = {padding2: "scoped-padding"};
        const bound = bind(range("padding"), scope);
        const result = bound(2);
        expect(result.className.has("scoped-padding")).toBe(true);
      });
    });

    describe("union", () => {
      it("combines multiple functors", () => {
        const combined = union(toggle("a"), toggle("b"));
        const result = combined(true);
        expect(result.className.has("a")).toBe(true);
        expect(result.className.has("b")).toBe(true);
      });
    });
  });

  describe("isNative", () => {
    it("returns boolean", () => {
      const result = isNative();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("findAddressComponent", () => {
    const components = [
      {long_name: "123", short_name: "123", types: ["street_number"]},
      {long_name: "Main Street", short_name: "Main St", types: ["route"]},
      {long_name: "New York", short_name: "NY", types: ["locality"]},
    ];

    it("finds component by type", () => {
      expect(findAddressComponent(components, "locality")).toBe("New York");
    });

    it("returns empty string for missing type", () => {
      expect(findAddressComponent(components, "country")).toBe("");
    });

    it("returns empty string when components is empty", () => {
      expect(findAddressComponent([], "locality")).toBe("");
    });
  });

  describe("processAddressComponents", () => {
    const components = [
      {long_name: "123", short_name: "123", types: ["street_number"]},
      {long_name: "Main Street", short_name: "Main St", types: ["route"]},
      {long_name: "Boston", short_name: "Boston", types: ["locality"]},
      {long_name: "Massachusetts", short_name: "MA", types: ["administrative_area_level_1"]},
      {long_name: "Suffolk County", short_name: "Suffolk", types: ["administrative_area_level_2"]},
      {long_name: "02101", short_name: "02101", types: ["postal_code"]},
    ];

    it("processes address components correctly", () => {
      const result = processAddressComponents(components);
      expect(result.address1).toBe("123 Main Street");
      expect(result.city).toBe("Boston");
      expect(result.state).toBe("Massachusetts");
      expect(result.zipcode).toBe("02101");
    });

    it("handles empty components", () => {
      const result = processAddressComponents([]);
      expect(result.address1).toBe("");
    });

    it("handles undefined components", () => {
      const result = processAddressComponents(undefined);
      expect(result.address1).toBe("");
    });

    it("handles empty components with includeCounty", () => {
      const result = processAddressComponents([], {includeCounty: true});
      expect(result.countyName).toBe("");
      expect(result.countyCode).toBe("");
    });

    it("handles components with includeCounty when county is present", () => {
      const result = processAddressComponents(components, {includeCounty: true});
      expect(result.countyName).toBe("Suffolk County");
    });

    it("handles components with includeCounty when county is missing", () => {
      const componentsWithoutCounty = components.filter(
        (c) => !c.types.includes("administrative_area_level_2")
      );
      const result = processAddressComponents(componentsWithoutCounty, {
        includeCounty: true,
      });
      expect(result.countyName).toBe("");
    });
  });

  describe("isValidGoogleApiKey", () => {
    it("returns true for valid-looking API key", () => {
      expect(isValidGoogleApiKey("test-dummy-key-not-real-0123456789")).toBe(true);
    });

    it("returns false for empty string", () => {
      expect(isValidGoogleApiKey("")).toBe(false);
    });

    it("returns false for too short key", () => {
      expect(isValidGoogleApiKey("short")).toBe(false);
    });

    it("returns false for too long key", () => {
      expect(isValidGoogleApiKey("a".repeat(51))).toBe(false);
    });

    it("returns false for key with invalid characters", () => {
      expect(isValidGoogleApiKey("invalid key with spaces and special!!!!")).toBe(false);
    });

    it("returns false when passed a non-string value", () => {
      expect(isValidGoogleApiKey(123 as unknown as string)).toBe(false);
    });

    it("returns false for whitespace-only key", () => {
      expect(isValidGoogleApiKey("                                  ")).toBe(false);
    });
  });

  describe("formattedCountyCode", () => {
    it("returns empty string for unknown state/county", () => {
      expect(formattedCountyCode("Nowhere", "Nothing")).toBe("");
    });

    it("handles missing county data gracefully", () => {
      expect(formattedCountyCode("Massachusetts", "Fake County")).toBe("");
    });
  });

  describe("isAPIError", () => {
    it("returns truthy for API error object", () => {
      const error = {data: {detail: "Something went wrong", title: "Error"}};
      expect(isAPIError(error)).toBeTruthy();
    });

    it("returns falsy for non-API error", () => {
      expect(isAPIError({message: "error"})).toBeFalsy();
    });

    it("returns falsy for null", () => {
      expect(isAPIError(null)).toBeFalsy();
    });

    it("returns falsy for undefined", () => {
      expect(isAPIError(undefined)).toBeFalsy();
    });
  });

  describe("printAPIError", () => {
    it("prints error title", () => {
      const error = {data: {title: "Not Found"}};
      expect(printAPIError(error as unknown as APIError)).toBe("Not Found");
    });

    it("prints error title and detail", () => {
      const error = {data: {detail: "Resource does not exist", title: "Not Found"}};
      expect(printAPIError(error as unknown as APIError)).toBe(
        "Not Found: Resource does not exist"
      );
    });

    it("omits detail when details is false", () => {
      const error = {data: {detail: "Resource does not exist", title: "Not Found"}};
      expect(printAPIError(error as unknown as APIError, false)).toBe("Not Found");
    });

    it("prints title when detail is missing", () => {
      const error = {data: {title: "Not Found"}};
      expect(printAPIError(error as unknown as APIError, true)).toBe("Not Found");
    });
  });

  describe("applyColorOpacity", () => {
    it("converts six digit hex colors", () => {
      expect(applyColorOpacity({color: "#1C1C1C", opacity: 0.15})).toBe("rgba(28, 28, 28, 0.15)");
    });

    it("expands shorthand hex colors", () => {
      expect(applyColorOpacity({color: "#abc", opacity: 1})).toBe("rgba(170, 187, 204, 1)");
    });

    it("multiplies an existing alpha channel by the opacity", () => {
      expect(applyColorOpacity({color: "#00000080", opacity: 0.5})).toBe("rgba(0, 0, 0, 0.251)");
    });

    it("converts rgb and rgba colors", () => {
      expect(applyColorOpacity({color: "rgb(10, 20, 30)", opacity: 0.4})).toBe(
        "rgba(10, 20, 30, 0.4)"
      );
      expect(applyColorOpacity({color: "rgba(10, 20, 30, 0.5)", opacity: 0.5})).toBe(
        "rgba(10, 20, 30, 0.25)"
      );
    });

    it("clamps opacity to the 0-1 range", () => {
      expect(applyColorOpacity({color: "#000000", opacity: 5})).toBe("rgba(0, 0, 0, 1)");
      expect(applyColorOpacity({color: "#000000", opacity: -1})).toBe("rgba(0, 0, 0, 0)");
    });

    it("returns unparseable colors unchanged", () => {
      expect(applyColorOpacity({color: "papayawhip", opacity: 0.5})).toBe("papayawhip");
      expect(applyColorOpacity({color: "#12345", opacity: 0.5})).toBe("#12345");
    });
  });

  describe("createBoxShadow", () => {
    it("builds a box shadow value with defaults", () => {
      expect(createBoxShadow({blurRadius: 8})).toBe("0px 0px 8px rgba(0, 0, 0, 1)");
    });

    it("applies offsets, color, and opacity", () => {
      expect(
        createBoxShadow({blurRadius: 12, color: "#1C1C1C", offsetX: 1, offsetY: 4, opacity: 0.15})
      ).toBe("1px 4px 12px rgba(28, 28, 28, 0.15)");
    });
  });
});
