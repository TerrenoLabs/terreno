# @terreno/ui

React Native UI component library (88+ components). Layout (Box, Page, Card), forms (TextField, SelectField), display (Text, DataTable), actions (Button), feedback (Modal, Toast), and theming via TerrenoProvider.

## Key exports

- Layout: `Box`, `Page`, `SplitPage`, `Card`
- Forms: `TextField`, `SelectField`, `DateTimeField`, `CheckBox`
- Display: `Text`, `Heading`, `Badge`, `DataTable`
- Actions: `Button`, `IconButton`, `Link`
- Feedback: `Spinner`, `Modal`, `Toast`
- Authentication: `SocialLoginButton`, `LoginScreen`, `SignUpScreen`
- Theming: `TerrenoProvider`, `useTheme`, custom icon registry (`icons` prop)
- **Type re-exports:** `StyleProp`, `ViewStyle` (re-exported from react-native to avoid version conflicts)

## Type Re-exports

@terreno/ui re-exports commonly-used React Native types to help consumers avoid version conflicts:

``````typescript
import {StyleProp, ViewStyle} from "@terreno/ui";

// Use these instead of importing from react-native directly
const customStyle: StyleProp<ViewStyle> = {
  flex: 1,
  backgroundColor: "#fff",
};
``````

**Benefits:**
- Avoids version mismatches between your app's react-native and @terreno/ui's react-native
- Ensures type compatibility when passing styles to @terreno/ui components
- Simplifies imports (one package instead of two)

## Component Behaviors

### Button Layout Behavior

Buttons automatically size to their content unless `fullWidth` is specified:

``````typescript
// Button takes only the space it needs
<Box direction="column">
  <Button text="Save" onClick={handleSave} />  {/* Auto-sized */}
</Box>

// Button stretches to full width
<Box direction="column">
  <Button text="Save" onClick={handleSave} fullWidth />  {/* Full width */}
</Box>
``````

Internally, Button sets `alignSelf: 'flex-start'` when `fullWidth={false}` to prevent stretching in column layouts.

## Authentication Components

### SocialLoginButton

Branded social login buttons for OAuth authentication with Google, GitHub, and Apple.

``````typescript
import {SocialLoginButton} from "@terreno/ui";
import {authClient} from "@/store/authClient";

<SocialLoginButton
  provider="google"  // "google" | "github" | "apple"
  variant="primary"  // "primary" | "outline"
  onPress={async () => {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "yourapp://auth/callback",
    });
  }}
  loading={isLoading}
  fullWidth
/>
``````

**Features:**
- Proper brand colors for each provider (follows brand guidelines)
- Built-in icons (FontAwesome 6)
- Primary and outline variants
- Loading states with spinner
- Automatic text: "Continue with {Provider}"

### LoginScreen

Complete login screen with email/password and optional social providers.

``````typescript
import {LoginScreen} from "@terreno/ui";
import {authClient} from "@/store/authClient";

<LoginScreen
  onEmailLogin={async ({email, password}) => {
    await authClient.signIn.email({email, password});
  }}
  onSocialLogin={async (provider) => {
    await authClient.signIn.social({provider, callbackURL: "yourapp://auth"});
  }}
  socialProviders={["google", "github", "apple"]}
  onForgotPassword={() => navigation.navigate("ForgotPassword")}
  onSignUp={() => navigation.navigate("SignUp")}
/>
``````

### SignUpScreen

Complete signup screen with email/password and optional social providers.

``````typescript
import {SignUpScreen} from "@terreno/ui";
import {authClient} from "@/store/authClient";

<SignUpScreen
  onEmailSignUp={async ({email, password, name}) => {
    await authClient.signUp.email({email, password, name});
  }}
  onSocialLogin={async (provider) => {
    await authClient.signIn.social({provider, callbackURL: "yourapp://auth"});
  }}
  socialProviders={["google", "github"]}
  onSignIn={() => navigation.navigate("Login")}
  requireName
  requireTermsAcceptance
/>
``````

**Learn more:** [Configure Better Auth](../how-to/configure-better-auth.md)

## Testing Utilities

@terreno/ui provides test helpers for writing component tests with @testing-library/react-native.

### renderWithTheme

Wraps components in ThemeProvider for testing.

``````typescript
import {renderWithTheme} from "@terreno/ui";
import {describe, it, expect} from "bun:test";

describe("MyComponent", () => {
  it("renders correctly", () => {
    const {getByTestId} = renderWithTheme(<MyComponent testID="my-comp" />);
    expect(getByTestID("my-comp")).toBeTruthy();
  });
});
``````

**Why:** Most @terreno/ui components require ThemeProvider context to access theme values.

### createCommonMocks

Creates mock functions for common component callbacks.

``````typescript
import {createCommonMocks} from "@terreno/ui";

const mocks = createCommonMocks();
// Returns: {onBlur, onChange, onEnter, onFocus, onIconClick, onSubmitEditing}

<TextField
  value="test"
  onChange={mocks.onChange}
  onBlur={mocks.onBlur}
  onFocus={mocks.onFocus}
/>

// Assert mock was called
expect(mocks.onChange).toHaveBeenCalledWith("new value");
``````

### setupComponentTest / teardownComponentTest

Lifecycle helpers for test setup and cleanup.

``````typescript
import {setupComponentTest, teardownComponentTest} from "@terreno/ui";

describe("MyForm", () => {
  let mocks;

  beforeEach(() => {
    mocks = setupComponentTest(); // Returns createCommonMocks()
  });

  afterEach(() => {
    teardownComponentTest(); // No-op in Bun (auto-cleanup)
  });

  it("submits form", () => {
    // Test with mocks
  });
});
``````

## Date Utilities

Luxon-based helpers for date comparison and formatting.

``````typescript
import {
  isToday,
  isTomorrow,
  isYesterday,
  isThisYear,
  isWithinWeek,
  getIsoDate,
} from "@terreno/ui";

const date = DateTime.now();

if (isToday(date)) console.log("Today!");
if (isTomorrow(date)) console.log("Tomorrow!");
if (isYesterday(date)) console.log("Yesterday!");
if (isThisYear(date)) console.log("This year!");
if (isWithinWeek(date)) console.log("Within 7 days!");

// Convert to ISO date string
const isoString = getIsoDate(date); // "2026-02-15"
``````

### Timezone Utilities

``````typescript
import {getTimezoneOptions} from "@terreno/ui";

// Get USA timezones only
const usaTimezones = getTimezoneOptions("usa");
// Returns: [{label: "Pacific Time", value: "America/Los_Angeles"}, ...]

// Get worldwide timezones
const allTimezones = getTimezoneOptions("worldwide");
// Returns: [{label: "UTC", value: "UTC"}, {label: "New York", value: "America/New_York"}, ...]
``````

**Use case:** Populate SelectField with timezone choices.

## Address Utilities

Google Places API integration helpers for address handling.

### formatAddress

``````typescript
import {formatAddress} from "@terreno/ui";

const address = {
  street: "123 Main St",
  city: "San Francisco",
  state: "CA",
  zipCode: "94102",
};

const formatted = formatAddress(address);
// "123 Main St, San Francisco, CA 94102"
``````

### processAddressComponents

Parses Google Places API address_components into structured data.

``````typescript
import {processAddressComponents} from "@terreno/ui";

// From Google Places API response
const components = place.address_components;

const parsed = processAddressComponents(components);
// Returns: {street, city, state, zipCode, country, county}
``````

### findAddressComponent

``````typescript
import {findAddressComponent} from "@terreno/ui";

const city = findAddressComponent(components, "locality");
const state = findAddressComponent(components, "administrative_area_level_1", "short_name");
``````

### Validation

``````typescript
import {isValidGoogleApiKey, formattedCountyCode} from "@terreno/ui";

if (!isValidGoogleApiKey(apiKey)) {
  console.error("Invalid Google API key");
}

// Format US county codes
const county = formattedCountyCode("6075"); // "6075" (Santa Cruz County, CA)
``````

## Media Query Helpers

Responsive design utilities for breakpoints and device detection.

``````typescript
import {
  mediaQuery,
  mediaQueryLargerThan,
  mediaQuerySmallerThan,
  isMobileDevice,
} from "@terreno/ui";

// Check if matches breakpoint
if (mediaQuery("md")) {
  console.log("Medium or larger");
}

// Greater than breakpoint
if (mediaQueryLargerThan("sm")) {
  console.log("Larger than small");
}

// Smaller than breakpoint
if (mediaQuerySmallerThan("lg")) {
  console.log("Smaller than large");
}

// Detect mobile
if (isMobileDevice()) {
  console.log("Running on mobile device");
}
``````

**Breakpoints:**
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px

## Icons

Terreno uses **FontAwesome 6** by default. Pass icon names via `iconName` on `Icon`, `Button`, `IconButton`, form fields, `Badge`, and other icon-aware components.

### FontAwesome Icons

All 2000+ FontAwesome 6 icons are available:

``````typescript
import {Icon, Button} from "@terreno/ui";

<Icon iconName="check" size="md" color="primary" />
<Icon iconName="user" size="lg" color="secondaryDark" />
<Icon iconName="chevron-right" size="sm" color="primary" />

<Button text="Save" iconName="check" onClick={handleSave} />
``````

**Sizes:** `xs`, `sm`, `md`, `lg`, `xl`, `2xl`

**Types:** `solid` (default), `regular`, `brand`, `light`, `thin`, `duotone`, `sharp`, and related variants.

### Custom Icons

Register your own icons (SVGs, etc.) on `TerrenoProvider` and use them by name anywhere `iconName` is accepted. Registered names take precedence over FontAwesome.

**1. Create a custom icon component** that accepts `color`, `size` (pixels), and optional `testID`:

``````typescript
import type {CustomIconProps} from "@terreno/ui";
import Svg, {Path} from "react-native-svg";

export const SparkleIcon = ({color, size, testID}: CustomIconProps): React.ReactElement => (
  <Svg fill="none" height={size} testID={testID} viewBox="0 0 24 24" width={size}>
    <Path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill={color} />
  </Svg>
);
``````

Terreno resolves theme colors and size tokens before passing them to your component.

**2. Register icons** via the `icons` prop on `TerrenoProvider`:

``````typescript
import {TerrenoProvider} from "@terreno/ui";
import {SparkleIcon} from "./components/SparkleIcon";

<TerrenoProvider icons={{sparkle: SparkleIcon}}>
  {children}
</TerrenoProvider>
``````

**3. Use by name** like any built-in icon:

``````typescript
<Icon iconName="sparkle" color="accent" size="lg" />
<Button text="Sparkle" iconName="sparkle" onClick={handleClick} />
<IconButton accessibilityLabel="Sparkle" iconName="sparkle" onClick={handleClick} />
``````

**TypeScript:** extend `CustomIconRegistry` via declaration merging for autocomplete and type-safe `iconName` values:

``````typescript
declare module "@terreno/ui" {
  interface CustomIconRegistry {
    sparkle: true;
  }
}
``````

See [`demo/components/customIcons.tsx`](https://github.com/TerrenoLabs/terreno/blob/master/demo/components/customIcons.tsx) for a full working example.

### Built-in Status Icons

@terreno/ui also ships status indicator SVGs as standalone components (not registered via `TerrenoProvider`):

``````typescript
import {MobileIcon, OnlineIcon, OfflineIcon, OutOfOfficeIcon} from "@terreno/ui";

<MobileIcon width={20} height={20} fill="#007AFF" />
<OnlineIcon width={16} height={16} />
<OfflineIcon width={16} height={16} />
<OutOfOfficeIcon width={16} height={16} />
``````

**Use case:** User status indicators, device type badges.

## Style Utilities

### Unifier Class

Color manipulation helper:

``````typescript
import {Unifier} from "@terreno/ui";

// Darken/lighten colors
const darkColor = Unifier.changeColorLuminance("#007AFF", -0.2); // Darker
const lightColor = Unifier.changeColorLuminance("#007AFF", 0.2); // Lighter
``````

### Style Helpers

``````typescript
import {identity, concat, fromClassName, toggle, binding, union} from "@terreno/ui";

// Compose style objects
const styles = concat(baseStyles, conditionalStyles);

// Toggle styles
const buttonStyles = toggle(isPressed, pressedStyles, defaultStyles);
``````

**Note:** Most use cases are better served by Box props (`padding`, `color`, etc.).

## Environment Variables

@terreno/ui components do not require environment variables. All configuration is done at runtime via:

- **TerrenoProvider props** — Theme customization, custom icon registry (`icons`), OpenAPI spec URL
- **Theme hooks** — `useTheme()`, `setTheme()`, `setPrimitives()`
- **Component props** — Direct prop overrides for individual components

**Example configuration:**

``````typescript
import {TerrenoProvider} from "@terreno/ui";

<TerrenoProvider
  baseUrl="https://api.example.com"
  theme={{
    surface: {primary: "secondary500"},
  }}
  onError={(error) => console.error(error)}
>
  {children}
</TerrenoProvider>
``````

## Related Documentation

See the [ui package source](../../ui/src/) and [.cursor/rules/ui/](../../.cursor/rules/ui/) for props and conventions.
