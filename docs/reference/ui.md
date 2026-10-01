# @terreno/ui

React Native UI component library (a large component library). Layout (Box, Page, Card), forms (TextField, SelectField), display (Text, DataTable), actions (Button), feedback (Modal, Toast), and theming via TerrenoProvider.

## Key exports

- Layout: `Box`, `Page`, `SplitPage`, `Card`, `DashboardGrid`
- Forms: `TextField`, `SelectField`, `DateTimeField`, `CheckBox`
- Display: `Text`, `Heading`, `Badge`, `DataTable`, `LineChart`, `BarChart`, `AreaChart`, `DonutChart`
- Actions: `Button`, `IconButton`, `Link`
- Feedback: `Spinner`, `Modal`, `Toast`
- Notifications: `NotificationBell`, `NotificationInbox`, `NotificationPreferences`
- Authentication: `SocialLoginButton`, `LoginScreen`, `SignUpScreen`
- Theming: `TerrenoProvider`, `useTheme`, custom icon registry (`icons` prop)
- **Type re-exports:** `StyleProp`, `ViewStyle` (re-exported from react-native to avoid version conflicts)

## Performance-sensitive imports

Use a component subpath when startup parse and evaluation cost matters:

```typescript
import {Box} from "@terreno/ui/Box";
import {DataTable} from "@terreno/ui/DataTable";
import {Icon} from "@terreno/ui/Icon";
```

Every compiled UI module is available through `@terreno/ui/<Module>`. Existing
`@terreno/ui/dist/<file>` imports still resolve to the compiled `.js` / `.d.ts` files. The root import remains fully
supported and is convenient when startup cost is not material:

```typescript
import {Box, DataTable, Icon} from "@terreno/ui";
```

Heavy optional widgets (`GPTChat`, `EmojiSelector`, `MarkdownEditor`, consent flows, `LineChart`, `BarChart`, `AreaChart`, `DonutChart`, and related admin tools) are
re-exported from the root entry through lazy boundaries. Importing them from `@terreno/ui` stays type-compatible, but
their implementation modules load on first render instead of during the initial root import. `DashboardGrid` stays eager.
their implementation modules load on first render instead of during the initial root import. `MarkdownView` and
`DataTable` header info defer `react-native-markdown-display`; `EmojiSelector` defers `emoji-datasource` until open.

For the smallest cold-start graph, keep using subpaths for screens that only need a few primitives (for example
`import {Button} from "@terreno/ui/Button"`).

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

### DashboardGrid

Eager layout-only wrapping grid. Default columns `{sm: 1, md: 2, lg: 3}`. Children stay caller-supplied `Card`s. Cell width is `(rowWidth - gap × (columns - 1)) / columns` so flex `gap` does not wrap extra columns.

```tsx
<DashboardGrid>
  <Card>
    <LineChart data={points} legendLabel="Signups" />
  </Card>
</DashboardGrid>
```

### LineChart

Single-series line chart drawn with `react-native-svg`. Empty data shows `emptyText` (default `"No data"`). `loading` shows a `Spinner`. Press or hover a point for `{label}: {value}`.

```tsx
<LineChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  legendLabel="Signups"
  testID="signups"
/>
```

Hit targets use `Box` `onClick`, so testIDs are `{testID}.point.{index}-clickable`.

### BarChart

Single-series bar chart on the same owned-SVG contract as `LineChart` (empty, loading, legend, tooltip).

```tsx
<BarChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  legendLabel="Signups"
  testID="signups-bar"
/>
```

### AreaChart

Filled area plus line on the same owned-SVG contract as `LineChart`.

```tsx
<AreaChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  legendLabel="Signups"
  testID="signups-area"
/>
```

### DonutChart

One slice per `{label, value}` point. Per-slice `color` overrides the theme paint. Legend is one row per slice (`legendLabel` is ignored).

```tsx
<DonutChart
  data={[{label: "Open", value: 3}, {color: "#112233", label: "Closed", value: 5}]}
  testID="status-donut"
/>
```

### Chart visual regression

`bun run ui:charts:compare` screenshots `http://localhost:8085/demo/chart-visual-gallery`
and diffs each fixture against `demo/rendered-snapshots/<id>.png`.
`bun run ui:charts:update-snapshots` rewrites those goldens. Fixture ids live in
`demo/chartVisual/fixtureCatalog.ts`. Operator steps:
[Compare rendered chart snapshots](../how-to/compare-chart-rendered-snapshots.md).

## Notification components

Presentational only — no syncdb import. Wire data from your app's sync layer.
These components are not in the isolated UI component demo; see `example-frontend`.

### `NotificationBell`

| Prop | Type | Description |
|---|---|---|
| `unreadCount` | `number` | Badge hidden when `0` |
| `onPress` | `() => void` | Opens the inbox (host owns visibility) |
| `renderBadge` | `({unreadCount, testID}) => ReactNode` | Replaces the default unread-count badge |
| `renderIcon` | `({testID}) => ReactNode` | Replaces the default bell icon |
| `testID` | `string` | Default `notification-bell` |

Custom renderers keep the built-in 40×40 tap target, positioning, toggle callback, and
accessible unread-count label. `renderBadge` runs only when `unreadCount > 0`.

### `NotificationInbox`

List-only; wrap in `SideDrawer`, `Modal`, or a sheet in the host screen.

| Prop | Type | Description |
|---|---|---|
| `items` | `NotificationInboxItem[]` | Rows to render |
| `isLoading` | `boolean` | Shows spinner |
| `onMarkRead` / `onMarkUnread` | `(item) => void` | Toggle `readAt` via syncdb |
| `onDismiss` | `(item) => void` | Archive the row (`archivedAt` via syncdb) |
| `onOpen` | `(item) => void` | Tap handler (e.g. Expo Router for `href`) |

`NotificationInboxItem.archived` is optional. Archived rows receive an `Archived` label
and do not expose dismiss or read-state actions.

### `NotificationPreferences`

| Prop | Type | Description |
|---|---|---|
| `preferences` | `{inapp, mail, push, sms}` | Current toggles |
| `onChange` | `(channel, value) => void` | Per-channel updates |

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

### TextField grow and maxHeight

`grow` makes a multiline field expand with its content. Pair it with `maxHeight` (pixels) to cap the expansion; past the cap the content scrolls.

```tsx
<TextArea grow maxHeight={200} onChange={setNotes} value={notes} />
```

### TextField password visibility

`type="password"` masks the value and renders a show/hide eye control at the end of the field.
The control is uncontrolled — the field tracks whether the value is revealed and starts hidden.
A disabled field cannot be revealed.

``````typescript
<TextField
  title="Password"
  type="password"
  value={password}
  onChange={setPassword}
  autoComplete="current-password"
/>
``````

Pass `showVisibilityToggle={false}` where revealing the value is unacceptable, such as a shared or
on-camera screen:

``````typescript
<TextField showVisibilityToggle={false} title="Password" type="password" value={password} onChange={setPassword} />
``````

`Field` with `type="password"` renders the same control, and so do `LoginScreen` and `SignUpScreen`
password fields.

The toggle's test id defaults to `{testID}.visibility-toggle`, and `testIDs.visibilityToggle`
overrides it:

| Element | test id |
| --- | --- |
| Input | `{testID}` |
| Label | `{testID}.label` |
| Error | `{testID}.error` |
| Helper | `{testID}.helper` |
| Show/hide toggle | `{testID}.visibility-toggle` |

### DropdownPanel

`DropdownPanel` is the compositional dropdown behind the DataTable filter popovers. A
trigger opens an anchored panel of arbitrary composed content with an optional
Apply / Clear / Cancel footer, so it also fits non-filter panels (bulk actions, column
pickers, sort menus).

``````typescript
<DropdownPanel
  label="Filters"
  onApply={applyDraft}
  onCancel={resetDraft}
  onClear={clearDraft}
  onOpenChange={(isOpen) => isOpen && seedDraft()}
  width={340}
>
  <FilterSelectMenu title="Due date" options={DUE_DATE_OPTIONS} value={dueDate} onChange={setDueDate} />
  <FilterBoolean title="Urgent tasks only" value={urgentOnly} onChange={setUrgentOnly} />
</DropdownPanel>
``````

> `Filter` is the former name and stays exported as a deprecated alias (with `FilterProps`)
> until Terreno 58. The `FilterSelectMenu` / `FilterBoolean` / `FilterAccordion` /
> `FilterChangesBadge` controls keep their names.

#### Positioning

The panel never renders inside its parent's clipping or stacking context: on web it is
portaled to `document.body` with fixed positioning, and on native it is teleported to the
`TerrenoProvider` portal host (falling back to an inline absolute overlay when no host is
mounted). `computeDropdownPanelLayout` then anchors it to the measured trigger:

| Situation | Behavior |
| --- | --- |
| Panel fits beside the trigger | Left edges line up (`align="start"`) |
| Left-aligned panel would cross the right viewport edge | Right edges line up instead (`align="auto"`, the default) |
| Panel is wider than the viewport | Narrowed to the viewport minus the 8px screen margins |
| Less than 160px below the trigger, and more above | Flipped above the trigger |
| Content taller than the space on screen | Panel body scrolls; the footer stays pinned |

Pass `align="start"` or `align="end"` to pin the side explicitly, and `maxPanelHeight` to
cap the height below what the viewport allows.

#### Trigger

The default trigger is a `Button` (or a compact icon trigger with `iconOnly`). Style it
with `triggerVariant` (any `Button` variant), `triggerSize`, and `fullWidth`, or replace
it entirely with `renderTrigger` when the design needs chrome the button variants do not
cover:

``````typescript
<DropdownPanel
  fullWidth
  renderTrigger={({isOpen, toggle}) => <MyPill active={isOpen} onPress={toggle} />}
  width={300}
>
  {fields}
</DropdownPanel>
``````

`variant` still sets both the trigger and the Apply button; `triggerVariant` and
`applyButtonVariant` override each independently.

### GPTChat

Streaming chat surface for `@terreno/ai`. Histories, messages, submit, and optional MCP/tools stay under consumer control.

Pass `mascot` when the app owns a character. Terreno ships none. The node renders only while `currentMessages` is empty, centered in the chat panel above the suggested prompts. The empty hero uses the message viewport height as a minimum so short content stays centered, while taller mascots still scroll. Streaming feedback shares that centered hero instead of creating a second pane. Omit the prop for the default empty chat.

The composer row (attachment picker, tools, input, Send) is vertically centered, so controls stay aligned with the input as it grows. The composer input grows with its text up to 200px, then scrolls. The attachment cell is omitted when `onAttachFiles` is not provided.

Each history row keeps rename and delete in a three-dot overflow menu (`gpt-history-menu-{id}`), anchored with `DropdownPanel`. Rename uses an outlined pencil in the dark secondary text color. Titles truncate before the menu trigger, so the trigger stays aligned at any sidebar width.

"Scroll to bottom" appears only when content sits more than 100px below the viewport. It never shows in an empty chat.

Image content parts render copy-image and (web) download actions. The message copy button on an image-only reply copies the image, not text. On web the image is written to the clipboard as PNG; on native it uses `expo-clipboard` `setImageAsync` for `data:` URLs.

The attach control (`FilePickerButton`) opens an anchored dropdown with **Photo Library** and **Document**. On web both open a browser file input from the press itself and return `data:` URLs, so attachments survive a reload; on native they use `expo-image-picker` and `expo-document-picker`.

```tsx
<GPTChat
  currentMessages={[]}
  histories={histories}
  mascot={
    <Box alignItems="center">
      <Heading size="lg">🦊</Heading>
    </Box>
  }
  onCreateHistory={onCreateHistory}
  onDeleteHistory={onDeleteHistory}
  onSelectHistory={onSelectHistory}
  onSubmit={onSubmit}
/>
```

Operator steps: [Add a GPT chat mascot](../how-to/add-gpt-chat-mascot.md). Demo story: `GPTChat` → `Mascot`.
The example AI screen demonstrates a consumer selecting one of four bundled mascot
images once per mount.

### SplitPage

Master-detail layout. Pass `listViewData` plus `renderListViewItem` for the list, and
`renderContent` for the detail pane. On large screens both panes stay visible. On small
screens the detail replaces the list until the user goes back.

```typescript
import {SplitPage, Text} from "@terreno/ui";

<SplitPage
  listViewData={[{id: "1", name: "Inbox"}]}
  renderListViewItem={({item}) => <Text>{item.name}</Text>}
  renderContent={(index) => <Text>{index === undefined ? "Select an item" : "Detail"}</Text>}
/>
```

### Page Back Navigation

Set `backButton` to render the standard header back arrow. By default it calls `router.back()`; provide `onBack` when the screen needs a deterministic destination instead of browser history.

```typescript
<Page backButton onBack={() => router.push("/admin")} title="Operations">
  <OperationsDashboard />
</Page>
```

### Button Press Animation

Buttons use a scale animation by default. Set `pressAnimation="opacity"` for an opacity response or
`pressAnimation="none"` when surrounding motion already provides feedback:

``````typescript
<Button text="Save" onClick={handleSave} pressAnimation="opacity" />
``````

Disabled and loading buttons use a non-interactive pressable regardless of the selected animation.

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

### TapToEdit testIDs

Pass `testID` on `TapToEdit`. The Field input uses that id. Action controls suffix it:

| Control | test id |
| --- | --- |
| Edit (pencil) | `{testID}.edit-clickable` |
| Cancel | `{testID}.cancel` |
| Clear | `{testID}.clear` |
| Save | `{testID}.save` |

```typescript
<TapToEdit
  testID="profile.name"
  setValue={setName}
  onSave={saveName}
  title="Name"
  value={name}
/>
// Edit:  profile.name.edit-clickable
// Cancel / Clear / Save: profile.name.cancel, .clear, .save
```

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

// Read the current breakpoint
if (mediaQuery() === "md") {
  console.info("Medium viewport");
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
  console.info("Running on mobile device");
}
``````

**Breakpoints are platform-specific.** `lg` and `xl` do not mean the same width on native and web.

Native (iOS/Android):

| Token | Width (pt) | Use |
| --- | --- | --- |
| Below `sm` | < 320 | Not supported. Accessible, not optimized. |
| `sm` | 320–374 | Small phone. Critical workflows stay usable. |
| `md` | 375–599 | Standard phone. |
| `lg` | 600–1023 | Large mobile / tablet, including Samsung A11. |
| `xl` | ≥ 1024 | Not a supported mobile layout. Use the desktop web experience where available. |

Web (desktop staff):

| Token | Width (pt) | Use |
| --- | --- | --- |
| Below `lg` | < 1024 | Not a supported desktop experience. Accessible, not optimized. |
| `lg` | 1024–1279 | Smaller desktop. Collapse secondary content; keep core workflows. |
| `xl` | ≥ 1280 | Primary desktop (M1/M4 MacBook Air 13"). Full multi-panel layouts. |

On web, `sm` (320) and `md` (375) still classify widths below 1024 so layouts can remain accessible.

`isMobileDevice()` is true below the supported desktop floor: native width < 1024 (`xl`), web width < 1024 (`lg`).

Responsive `Box` direction props update automatically when the window resizes or a device rotates:

``````typescript
<Box
  direction="column"
  smDirection="row"
  mdDirection="column"
  lgDirection="row"
  xlDirection="column"
/>
``````

All responsive Boxes share one dimension listener; non-responsive Boxes do not subscribe.
When multiple direction props match, the largest active breakpoint wins (`xl` over `lg` over `md` over `sm`).

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

## DataTable server-side filtering

`DataTable` is data-layer agnostic. Optional filter and search props emit a
modelRouter-shaped JavaScript object through `onQueryChange`. The parent merges
that object with `page`, `limit`, and `sort` before calling a list endpoint.

Import the pure helper when building params outside the component:

```typescript
import {buildDataTableListQuery} from "@terreno/ui/dataTableListQuery";
```

### Query contract

| UI | Wire param |
| --- | --- |
| Toolbar search (`search` + `searchFields`) | `$or: [{field: {$regex, $options: "i"}}, ...]` (user text escaped) |
| Text column filter | `{field: {$regex, $options: "i"}}` |
| Boolean column filter | `{field: true \| false}`; unset omits the key |
| Date range | `field_gte` / `field_lte` ISO strings; either bound may be sent alone |
| Number range | `{field: {$gte?, $lte?}}` |
| Choice (one value) | `{field: string}` scalar equality |
| Choice (many values) | `{field: {$in: string[]}}` |
| Choice **Empty** (optional fields) | `{field: {$in: ["__empty__"]}}` on the wire; server maps to `null` (matches missing and null) |
| Choice **Empty** + concrete | `{field: {$in: [...values, "__empty__"]}}` |

`onQueryChange` never includes `page`, `limit`, or `sort`. Search is debounced
(250ms, same delay as admin list search).

The server accepts only the documented nested operator keys. Text `$regex` values
must be escaped literals; executable patterns and extra Mongo operators are rejected.

Date range filters collect calendar days, so a range covers whole UTC days: **from**
opens the chosen day (`00:00:00.000Z`) and **to** closes it (`23:59:59.999Z`), which
keeps rows recorded later on the end day inside the range.

Pass `emptyContent` to keep the table header, search, and filter controls mounted
while showing an application-specific empty state below the header.
Use `additionalFilters` for declared server filters whose fields are not visible
columns; web shows one **More filters** popover and native includes them in the same sheet.

### Platform chrome

| Platform | Chrome |
| --- | --- |
| Web | Toolbar search + per-column `DropdownPanel` popovers (`column.filter`) |
| Native | Toolbar search + one **Filters** sheet (`Modal`) with the same fields |

Column headers use `DropdownPanel` with `iconOnly`, which renders a compact icon trigger
(24px at the default `triggerSize="sm"`, 32px with `triggerSize="default"`) instead
of a labeled button. Give it an accessible name with `triggerAccessibilityLabel`.

A single-column popover offers only its own **Clear**, so it needs no per-field clear.
The surfaces that host several filters at once — the **More filters** popover and the
native **Filters** sheet — add a per-field **Clear filter** for booleans, whose toggle
cannot otherwise express "unset".

Omit `column.filter`, `searchFields`, and the related callbacks to keep today's
sort/page-only table.

Demo: `FilterableDataTable` story in the component demo (`demo:start`, port 8085).

## Related Documentation

- [UI performance benchmarks](ui-performance.md)
- [UI package source](https://github.com/TerrenoLabs/terreno/tree/master/ui/src)
