// Originally based on https://github.com/pinterest/gestalt
// Forked, updated to Typescript, and added features.
import get from "lodash/get";
import {Platform} from "react-native";

import type {APIError, BaseProfile, IconSize} from "./Common";
import {COUNTY_AND_COUNTY_EQUIVALENT_ENTITIES} from "./Constants";

export const mergeInlineStyles = (
  inlineStyle?: {__style?: Record<string, unknown>} | undefined,
  newStyle?: Record<string, unknown> | undefined
) => {
  const inline = get(inlineStyle, "__style");
  return {
    __style: {
      ...inline,
      ...newStyle,
    },
  };
};

const TEST_EMAIL_DOMAINS = ["nang.io", "example.com"];

/** True when the profile's email domain is a test domain or one of its subdomains. */
export const isTestUser = (profile?: BaseProfile): boolean => {
  const email = profile?.email;
  if (!email) {
    return false;
  }
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return TEST_EMAIL_DOMAINS.some(
    (testDomain) => domain === testDomain || domain.endsWith(`.${testDomain}`)
  );
};

export const iconNumberToSize = (size = 16): IconSize => {
  let iconSize: IconSize;
  if (size < 8) {
    iconSize = "xs";
  } else if (size < 12) {
    iconSize = "sm";
  } else if (size < 14) {
    iconSize = "md";
  } else if (size < 20) {
    iconSize = "lg";
  } else {
    iconSize = "xl";
  }
  return iconSize;
};

/*

Style is a monoid that capture the "to-be-applied" styles (inline and classes)
for a Box. It's basically set that is closed under an associative binary
operation and has an identity element such that for all HA HA HA. Yes, it's a
monoid, which sounds scary but it's not really and actually super useful. All
that means is that basically you can do two things with it:

    1. concat(concat(a, b), c) === concat(a, concat(b, c));
    2. concat(identity(), a) === concat(a, identity()) === a;

What that means is that it's really easy to compose styles together and the
order in which you do so doesn't really matter.

*/

interface InlineStyle {
  [key: string]: string | number | undefined;
}

// TODO: This type should be opaque, however the Babel parser doesn't support
//       the opaque syntax yet.
export interface Style {
  className: Set<string>;
  inlineStyle: InlineStyle;
}

export const identity = (): Style => ({
  className: new Set(),
  inlineStyle: {},
});

export const fromClassName = (...classNames: string[]): Style => ({
  className: new Set(classNames),
  inlineStyle: {},
});

export const fromInlineStyle = (inlineStyle: InlineStyle): Style => ({
  className: new Set(),
  inlineStyle,
});

export const concat = (styles: Style[]): Style =>
  styles.reduce(
    (
      {className: classNameA, inlineStyle: inlineStyleA},
      {className: classNameB, inlineStyle: inlineStyleB}
    ) => ({
      className: new Set([...classNameA, ...classNameB]),
      inlineStyle: {...inlineStyleA, ...inlineStyleB},
    }),
    identity()
  );

export const mapClassName =
  (fn: (x: string) => string) =>
  ({className, inlineStyle}: Style): Style => ({
    className: new Set(Array.from(className).map(fn)),
    inlineStyle,
  });

export const toProps = ({
  className,
  inlineStyle,
}: Style): {className: string; style: InlineStyle} => {
  const props: {className?: string; style?: InlineStyle} = {};

  if (className.size > 0) {
    // Sorting here ensures that classNames are always stable, reducing diff
    // churn. Box usually has a small number of properties so it's not a perf
    // concern.
    props.className = Array.from(className).sort().join(" ");
  }

  if (Object.keys(inlineStyle).length > 0) {
    props.style = inlineStyle;
  }

  return props as {className: string; style: InlineStyle};
};

/*

Transforms

  These are a collection of a few functors that take values and returns Style's. OMG,
  I used the word functor - it's really just a fancy word for function.

*/
type Functor<T> = (n: T) => Style;

// Adds a classname when a property is present.
//
//     <Box top />
//
export const toggle =
  (...classNames: string[]) =>
  (val?: boolean) =>
    val ? fromClassName(...classNames) : identity();

// Maps string values to classes
//
//     <Box alignItems="center" />
//
export const mapping = (map: {[key: string]: string}) => (val: string) =>
  Object.hasOwn(map, val) ? fromClassName(map[val]) : identity();

// Maps a range of integers to a range of classnames
//
//     <Box padding={1} />
//
export const range =
  (scale: string) =>
  (n: number): Style =>
    fromClassName(`${scale}${n < 0 ? `N${Math.abs(n)}` : n}`);

// Like `range`, maps a range of integers to a range of classnames, excluding
// zero values.
//
//     <Box padding={0} />
export const rangeWithoutZero =
  (scale: string) =>
  (n: number): Style =>
    n === 0 ? identity() : range(scale)(n);

// Binds a string classname to the value in an object. Useful when interacting
// with ranges that need to come dynamically from a style object. This is
// similar to the NPM package 'classnames/bind'.
export const bind = <T,>(
  fn: Functor<T>,
  scope:
    | {
        readonly [key: string]: string;
      }
    | Record<string, string>
): ((val: T) => Style) => {
  const map = mapClassName((name) => scope[name]);
  return (val: T): Style => map(fn(val));
};

// This takes a series of the previously defined functors, runs them all
// against a value and returns the set of their classnames.
export const union =
  <T,>(...fns: Functor<T>[]) =>
  (val: T) =>
    concat(fns.map((fn) => fn(val)));

export const isNative = (): boolean => {
  return ["android", "ios"].includes(Platform.OS);
};

interface ColorWithOpacityOptions {
  color: string;
  opacity: number;
}

/**
 * Applies an opacity to a color, returning an `rgba()` string. Supports `#rgb`,
 * `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, and `rgba()` inputs. Colors that
 * can't be parsed (e.g. named CSS colors) are returned unchanged.
 */
export const applyColorOpacity = ({color, opacity}: ColorWithOpacityOptions): string => {
  const clampedOpacity = Math.max(0, Math.min(1, opacity));

  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const isShorthand = hex.length === 3 || hex.length === 4;
    if (!isShorthand && hex.length !== 6 && hex.length !== 8) {
      return color;
    }
    const expanded = isShorthand
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;
    const red = Number.parseInt(expanded.slice(0, 2), 16);
    const green = Number.parseInt(expanded.slice(2, 4), 16);
    const blue = Number.parseInt(expanded.slice(4, 6), 16);
    if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) {
      return color;
    }
    // An alpha channel on the input color multiplies with the requested opacity,
    // matching how react-native-web combined a shadow's color and opacity.
    const alphaChannel =
      expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
    const alpha = Number.isNaN(alphaChannel) ? clampedOpacity : alphaChannel * clampedOpacity;
    return `rgba(${red}, ${green}, ${blue}, ${roundOpacity(alpha)})`;
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (!rgbMatch) {
    return color;
  }
  const parts = rgbMatch[1].split(",").map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) {
    return color;
  }
  const existingAlpha = parts.length === 4 ? Number.parseFloat(parts[3]) : 1;
  const alpha = Number.isNaN(existingAlpha) ? clampedOpacity : existingAlpha * clampedOpacity;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${roundOpacity(alpha)})`;
};

const roundOpacity = (alpha: number): number => Math.round(alpha * 1000) / 1000;

interface BoxShadowOptions {
  blurRadius: number;
  /** Shadow color. Defaults to black, matching the platform shadow default. */
  color?: string;
  offsetX?: number;
  offsetY?: number;
  /** Shadow alpha, folded into the color since `boxShadow` has no opacity field. */
  opacity?: number;
}

/**
 * Builds a CSS `box-shadow` value for the `boxShadow` style prop, which replaces
 * the deprecated `shadow*` style props (color, offset, opacity, and radius).
 */
export const createBoxShadow = ({
  blurRadius,
  color = "#000000",
  offsetX = 0,
  offsetY = 0,
  opacity = 1,
}: BoxShadowOptions): string => {
  return `${offsetX}px ${offsetY}px ${blurRadius}px ${applyColorOpacity({color, opacity})}`;
};

// Find more information about the address component types here: https://developers.google.com/maps/documentation/javascript/place-autocomplete
export type AddressComponentType = {
  long_name: string;
  short_name: string;
  types: string[];
};

export const findAddressComponent = (components: AddressComponentType[], type: string): string => {
  return (
    components.find((component: AddressComponentType) => component.types.includes(type))
      ?.long_name ?? ""
  );
};

interface ProcessAddressComponentOptions {
  includeCounty?: boolean;
}

export const processAddressComponents = (
  addressComponents: AddressComponentType[] | undefined,
  options?: ProcessAddressComponentOptions
) => {
  let processedAddressComponents: {
    address1: string;
    city: string;
    state: string;
    zipcode: string;
    countyName?: string;
    countyCode?: string;
  } = {
    address1: "",
    city: "",
    state: "",
    zipcode: "",
  };

  if (!addressComponents || addressComponents.length === 0) {
    console.warn("Invalid address components");
    if (options?.includeCounty) {
      return {
        ...processedAddressComponents,
        countyCode: "",
        countyName: "",
      };
    } else {
      return processedAddressComponents;
    }
  }

  const streetNumber = findAddressComponent(addressComponents, "street_number");
  const streetName = findAddressComponent(addressComponents, "route");
  const city = findAddressComponent(addressComponents, "locality");
  const state = findAddressComponent(addressComponents, "administrative_area_level_1");
  const zipcode = findAddressComponent(addressComponents, "postal_code");

  processedAddressComponents = {
    address1: `${streetNumber} ${streetName}`.trim(),
    city,
    state,
    zipcode,
  };

  if (options?.includeCounty) {
    const countyName = findAddressComponent(addressComponents, "administrative_area_level_2");
    if (state && countyName) {
      const countyCode = formattedCountyCode(state, countyName);
      processedAddressComponents = {
        ...processedAddressComponents,
        countyCode,
        countyName,
      };
    } else {
      processedAddressComponents = {
        ...processedAddressComponents,
        countyName,
      };
    }
  }
  return processedAddressComponents;
};

// Google does not provide a way to validate API keys, so we have to do it ourselves
export const isValidGoogleApiKey = (apiKey: string): boolean => {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    console.warn("Google API key validation failed: key is not a string or is empty");
    return false;
  }
  // Typical Google API keys are around 39 characters
  if (apiKey.length < 30 || apiKey.length > 50) {
    console.warn("Google API key validation failed: key is invalid length");
    return false;
  }
  // Check the presence of alphanumeric characters and dashes
  const apiKeyRegex = /^[A-Za-z0-9-_]+$/;
  if (!apiKeyRegex.test(apiKey)) {
    console.warn("Google API key validation failed: key contains invalid characters");
    return false;
  }
  return true;
};

export const formattedCountyCode = (state: string, countyName: string): string => {
  const stateKey = state
    .replace(/\s+/g, "")
    .toLowerCase() as keyof typeof COUNTY_AND_COUNTY_EQUIVALENT_ENTITIES;

  const stateData = COUNTY_AND_COUNTY_EQUIVALENT_ENTITIES[stateKey];

  const countyKey = countyName
    .trim()
    .toLowerCase()
    .replace(/[\s.'-]/g, "") as keyof typeof stateData;

  const countyData: {
    stateFP: string;
    countyFP: string;
  } = stateData?.[countyKey];
  if (!countyData) {
    return "";
  }

  return `${countyData.stateFP}${countyData.countyFP}`;
};

export const isAPIError = (error: unknown): error is APIError => {
  return Boolean((error as {data?: {title?: unknown}} | null | undefined)?.data?.title);
};

export const printAPIError = (error: APIError, details = true): string => {
  let message = error.data?.title;
  if (error.data?.detail && details) {
    message = `${message}: ${error.data?.detail}`;
  }
  return message;
};
