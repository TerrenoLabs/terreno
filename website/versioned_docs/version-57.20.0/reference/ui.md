# @terreno/ui

React Native UI component library (a large component library). Layout (Box, Page, Card), forms (TextField, SelectField), display (Text, DataTable), actions (Button), feedback (Modal, Toast), and theming via TerrenoProvider.

## Key exports

- Layout: `Box`, `Page`, `ListDetailLayout`, `SplitPage`, `Card`, `ChartCard`, `DashboardGrid`, `DashboardGridItem`
- Forms: `TextField`, `SelectField`, `DateTimeField`, `CheckBox`, `OtpField`, `FormContainer`
- Display: `Text`, `Heading`, `Badge`, `DataTable`, `Scorecard`, `SparklineChart`, `LineChart`, `BarChart`, `AreaChart`, `DonutChart`
- Actions: `Button`, `IconButton`, `Link`
- Feedback: `Spinner`, `Modal`, `Toast`
- Loading: `Skeleton`, `SkeletonText`, `SkeletonCircle`, `SkeletonCard`, `SkeletonList`, `SkeletonGroup`, `withLoading`, `LoadingProps`
- Notifications: `NotificationBell`, `NotificationInbox`, `NotificationPreferences`
- AI chat: `GPTChat`, `AskCard` (agent asks in the transcript), `SimpleAskCard` (an ask's simple card for narrow layouts), `BlocksView` (a whole-reply YAML document)
- Authentication: `SocialLoginButton`, `LoginScreen`, `TwoFactorChallengeScreen`, `SignUpScreen`
- Account security: `LinkedAccountsCard`, `PasswordCard`, `PasskeysCard`, `SessionsCard`, `TwoFactorSettingsCard`, `AccountSecurityScreen`
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

Heavy optional widgets (`GPTChat`, `AskCard`, `BlocksView`, `EmojiSelector`, `MarkdownEditor`, consent flows, `ChartCard`, `Scorecard`, `SparklineChart`, `LineChart`, `BarChart`, `AreaChart`, `DonutChart`, and related admin tools) are
re-exported from the root entry through lazy boundaries. Importing them from `@terreno/ui` stays type-compatible, but
their implementation modules load on first render instead of during the initial root import. `DashboardGrid` stays eager.
`MarkdownView` and `DataTable` header info defer `react-native-markdown-display`;
`EmojiSelector` defers `emoji-datasource` until open.

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

## Theme modes

`TerrenoProvider` defaults to the Flourish Health light mode exported from
Figma. Select the matching Figma dark mode explicitly or follow the operating
system:

``````tsx
import {TerrenoProvider} from "@terreno/ui";

<TerrenoProvider colorScheme="system">
  <App />
</TerrenoProvider>
``````

`colorScheme` accepts `"light"`, `"dark"`, or `"system"` and defaults to
`"light"` for deterministic server rendering. `"system"` follows the operating
system. Change the choice after startup with `setColorScheme`:

``````tsx
import {SelectField, themeColorSchemeOptions, useTheme, type ThemeColorScheme} from "@terreno/ui";

const AppearanceSetting = () => {
  const {colorSchemeSetting, setColorScheme} = useTheme();
  return (
    <SelectField
      onChange={(value) => {
        setColorScheme(value as ThemeColorScheme);
      }}
      options={themeColorSchemeOptions}
      title="Appearance"
      value={colorSchemeSetting}
    />
  );
};
``````

Dark `surface.warningLight` uses `warning200`. The lighter warning orange, `warning100`, is 2.52:1 against warning text and misses WCAG AA. Striped `DataTable` rows use `neutral900` in dark mode instead of `surface.neutralLight`, which is too light for ghost and link text. Highlighted `DataTable` cells switch to `text.inverted` when `text.primary` is below 4.5:1 on that fill. Inverted `MarkdownView` code uses `surface.neutralDark` when `surface.neutralLight` is below 4.5:1 against that text, and blockquotes do the same with `surface.baseAlternate`. Primary `Button` labels use `text.secondaryDark` when that pair meets 4.5:1 on `surface.primary`, and `text.inverted` otherwise, so `setTheme(darkThemeConfig)` stays readable without changing `colorScheme`. The demo palette generator emits status `050` steps so custom palettes update those dark error, success, and warning surfaces.

`themeColorSchemeOptions` labels those values Light, Dark, and Follow system.
`useTheme()` also returns the resolved `colorScheme` (`"light"` or `"dark"`)
with `theme`, `setTheme`, `setPrimitives`, and `resetTheme`. An explicit
`colorScheme` prop replaces the current choice whenever the parent changes it.

The public `lightThemeConfig`, `darkThemeConfig`, and
`defaultThemePrimitives` exports are the canonical token maps. They include the
Figma AI surface/border roles and the dark status ramps. Custom overrides set
through `useTheme()` are layered over the active mode; `resetTheme()` removes
those overrides without changing the provider's selected mode.

### DashboardGrid and DashboardGridItem

Eager layout-only wrapping grid. Default columns `{sm: 1, md: 2, lg: 3}`. Children stay caller-supplied `Card`s. Cell width is `(rowWidth - gap × (columns - 1)) / columns` so flex `gap` does not wrap extra columns.
Wrap a child in `DashboardGridItem` when it must span more than one responsive column.
Plain children remain one column.

```tsx
<DashboardGrid columns={{sm: 1, md: 2, lg: 4}}>
  <DashboardGridItem span={{sm: 1, md: 2, lg: 2}}>
    <Card>
      <LineChart data={points} legendLabel="Signups" />
    </Card>
  </DashboardGridItem>
  <Card>
    <LineChart data={points} legendLabel="Signups" />
  </Card>
</DashboardGrid>
```

### ChartCard

Card chrome for a chart or table: title, optional filter summary, and an optional period
badge. Pass `onPeriodPress` to make the badge a button; omit it for display-only copy.

```tsx
<ChartCard title="Cost by Device" periodLabel="Last 30 days">
  <DonutChart data={points} />
</ChartCard>
```

### Scorecard

Compact KPI tile with a title, formatted value, and optional current/comparison
sparkline. Numeric values use `formatValue`; string values render unchanged.

```tsx
<Scorecard
  title="Cost"
  value={569}
  formatValue={(value) => `$${value}`}
  sparklineData={current}
  comparisonData={previous}
/>
```

### SparklineChart

Plot-only line chart for compact metrics. `data` draws the current solid line;
`comparisonData` draws a dotted previous-period line on the same scale. It has no axes,
grid, legend, tooltip row, or empty-state copy.

```tsx
<SparklineChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  comparisonData={[{label: "Mon", value: 4}, {label: "Tue", value: 4}]}
/>
```

### LineChart

Line chart drawn with `react-native-svg`. Keep the simple `data` + `legendLabel` path for
one series, or pass named `series` for multiple lines and legend items.
`comparisonData` adds a dotted previous-period overlay on the shared scale. Empty data
shows `emptyText` (default `"No data"`). `loading` shows a `Spinner`.
Set `xTickPolicy` to `auto` (default), `rotate`, or `truncate`. `title`,
`periodLabel`, and `onPeriodPress` use the same header chrome as `ChartCard`.

```tsx
<LineChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  legendLabel="Signups"
  testID="signups"
/>
```

Hit targets use `Box` `onClick`, so testIDs are `{testID}.point.{index}-clickable`.

### BarChart

Bar chart on the same owned-SVG contract as `LineChart` (empty, loading, legend,
tooltip, tick policy, and header shortcuts). `comparisonData` paints lighter bars behind
the current period. When `series` is passed in this facade, its first entry supplies the
bars and legend; grouped bars remain future work.

```tsx
<BarChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  legendLabel="Signups"
  testID="signups-bar"
/>
```

### AreaChart

Filled area plus line on the same owned-SVG contract as `LineChart`.
Named `series` render one fill/line pair and legend item each; `comparisonData` stays a
dotted line rather than a filled area.

```tsx
<AreaChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  legendLabel="Signups"
  testID="signups-area"
/>
```

### DonutChart

One slice per `{label, value}` point. Per-slice `color` overrides the theme paint.
Legend rows show label + percent by default; customize with `formatShare`.
`centerValue` and `centerTitle` put an aggregate in the donut hole. `title` /
`periodLabel` use `ChartCard` chrome (`legendLabel` remains ignored).

```tsx
<DonutChart
  data={[{label: "Open", value: 3}, {color: "#112233", label: "Closed", value: 5}]}
  centerValue="8"
  centerTitle="Total"
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

## Loading states and skeletons

Containers share one loading contract, `LoadingProps`:

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `loading` | `boolean` | `false` | Renders `loadingComponent` in place of the children |
| `loadingComponent` | `ReactNode` | per component, below | The placeholder, usually built from skeletons |
| `loadingAnimation` | `"pulse" \| "shimmer" \| "none"` | `"pulse"` | Animation for skeletons inside `loadingComponent` that do not set their own |
| `loadingLabel` | `string` | `"Loading"` | What screen readers announce while loading |

| Component | While `loading`, renders | Default `loadingComponent` |
| --- | --- | --- |
| `Box` | `loadingComponent` instead of children | `<SkeletonText />` (three lines) |
| `Card` (container), `EditableCard` | `loadingComponent` instead of children | `<SkeletonText />` |
| `Card` (display) | `loadingComponent` instead of image, title, and body | `<SkeletonCard>` with media when `imageUri` is set |
| `ChartCard` | Title row, then `loadingComponent` instead of the body | 160px `Skeleton` |
| `Scorecard` | Title row, then `loadingComponent` instead of the value | Value-sized `Skeleton`, plus a sparkline `Skeleton` when `sparklineData` is set |
| `LineChart`, `BarChart`, `AreaChart`, `DonutChart` | `loadingComponent` instead of the plot | `Spinner` |
| `Page` | `loadingComponent` instead of children | `Spinner` and `loadingText` |
| `SplitPage` | `loadingComponent` instead of the list and detail | `Spinner` beside the content |

`Page`, `SplitPage`, and the charts keep their spinner unless you pass `loadingComponent`. The
spinner is busy and labeled the same way. `SplitPage` takes no `testID`, so its loading region is
always `split-page-loading`.

While loading, the container sets `accessibilityState.busy` (`aria-busy` on web) and the
`loadingLabel` as its accessibility label. Skeleton blocks are hidden from screen readers. A
clickable `Box` ignores presses while loading.

```tsx
import {Box, SkeletonList} from "@terreno/ui";

<Box loading={isLoading} loadingAnimation="shimmer" loadingComponent={<SkeletonList rows={3} />}>
  {rows}
</Box>
```

### Skeleton primitives

| Component | Props (defaults) | Shape |
| --- | --- | --- |
| `Skeleton` | `width` (`"100%"`), `height` (16), `rounding` (`"sm"`, or `"circle"`), `color` (`"neutralExtraLight"`) | One block |
| `SkeletonText` | `lines` (3), `size` (`"md"`), `lastLineWidth` (`"60%"`) | Lines sized to `Text` at `size` |
| `SkeletonCircle` | `size` (40) | Avatar or icon |
| `SkeletonCard` | `showAvatar` (true), `showMedia` (false), `mediaHeight` (160), `lines` (2) | Media, avatar, title, and text |
| `SkeletonList` | `rows` (3), `showAvatar` (true), `lines` (2) | Repeated list rows |

Every primitive takes `animation` and `testID`. Child test ids are dot-suffixed, such as
`{testID}.line.0`, `{testID}.row.1.avatar`, and `{testID}.shimmer`. Skeletons are hidden from
assistive tech, so React Native Testing Library queries need `{includeHiddenElements: true}`.

`SkeletonGroup` sets `animation` for every skeleton inside it and runs them from one timeline, so
they pulse together. Loading containers wrap `loadingComponent` in one. A skeleton's own
`animation` overrides the group. Animations stop while the OS reduce-motion setting is on. On
native, skeletons hold still until that setting has been read, so they never animate first.

### Custom components

`withLoading(Component, {loadingComponent?, loadingAnimation?})` returns a component that takes
`LoadingProps`. While `loading`, it renders `loadingComponent` in a busy `Box` with test id
`{testID}-loading`; otherwise it renders `Component`. The wrapper consumes `loading`, so use it
only for components without a `loading` prop of their own.

```tsx
const UserRowWithLoading = withLoading(UserRow, {loadingComponent: <SkeletonList rows={1} />});

<UserRowWithLoading loading={isLoading} user={user} />
```

To give your own container the same contract, extend `LoadingProps` and pass the props to a
`Box`, or call `resolveLoadingContent({children, loading, loadingAnimation, loadingComponent,
defaultLoadingComponent})` where the placeholder goes.

## WhatsNewBanner

Non-blocking release notes banner. It shows `What's new in <version>` (plus a count of earlier
unseen releases) until the viewer opens or dismisses it, and stays hidden until a newer release
is listed. **See what's new** opens a `Modal` with each unseen release's Markdown notes.
Steps: [Show release notes with WhatsNewBanner](../how-to/whats-new-banner.md).

| Prop | Type | Description |
|---|---|---|
| `releases` | `WhatsNewRelease[]` | `{version, body, date?}` entries, newest first. `body` is Markdown |
| `storageKey` | `string` | Device storage key for the last seen version. Default `@TerrenoUI:whatsNew:lastSeenVersion` |
| `title` | `string` | Modal title. Default `What's new` |
| `onOpen` | `() => void` | Called when the viewer opens the notes |
| `testID` | `string` | Default `whats-new-banner`. Children: `-text`, `-open-button`, `-dismiss`, `-modal`, `-release-<version>` |

`getUnseenWhatsNewReleases({releases, lastSeenVersion})` returns the releases newer than
`lastSeenVersion`; an unknown or missing version counts as nothing seen.

`BannerButton` also accepts an optional `testID`.

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

A label stays on one line by default, so a long label can make the button wider than its container.
Set `wrapText` to keep the button inside its container instead: the label wraps onto centered lines
and the button grows taller. A `size="sm"` button grows from its 28px height instead of clipping the
second line. `SimpleAskCard` and `AskCard` set `wrapText` on their answer buttons, because their
labels come from the agent.

```tsx
<Box direction="row" width={160}>
  <Button onClick={handleSave} text="Save all changes now" wrapText />
</Box>
```

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

### TextField accessibilityLabel

`accessibilityLabel` sets the input's accessible name (`aria-label`). Without it screen readers
announce "Text input field", so pass it when the visible `title` is missing or not specific.

### TextField autoComplete

`autoComplete` is the field's autofill hint: `"on"`, `"off"`, `"username"`, `"email"`,
`"current-password"`, `"new-password"`, `"one-time-code"`, or `"username webauthn"`.

On web it is written to the input's `autocomplete` attribute. On native it is sent as React
Native's `autoComplete` (Android's autofill hint) with the matching iOS `textContentType`:

| `autoComplete` | Android `autoComplete` | iOS `textContentType` |
| --- | --- | --- |
| `"username"`, `"username webauthn"` | `username` | `username` |
| `"email"` | `email` | `emailAddress` |
| `"current-password"` | `current-password` (password) | `password` |
| `"new-password"` | `new-password` (new password) | `newPassword` (iOS offers a strong password) |
| `"one-time-code"` | `one-time-code` (SMS code) | `oneTimeCode` |
| `"off"` | `off` | `none` |
| `"on"` or unset | not set | from `type`: `emailAddress` for `email`, `password` for `password`, `username` for `username`, else `none` |

Passkey autofill (`"username webauthn"`) is web only; native gets the plain username hint.

- `"off"` turns autofill off for the field. Use `"username"` on the email field of a login or
  sign-up form, so password managers save it with the password.
- `Field type="password"` defaults to `"current-password"`. Pass `autoComplete="new-password"`
  (directly or through `TapToEdit`) on fields that set a new password, so password managers
  offer to generate one.
- `SignUpScreen` password fields default to `"new-password"`; `LoginScreen` password fields
  default to `"current-password"`. Both default the email field to `"username"`.
- `"username webauthn"` asks the browser to offer saved passkeys in the field's autofill;
  `LoginScreen` sets it on the email field when `passkeyAutofill` is on.

### FormContainer

Groups a form's fields. On web it renders a real `<form>` around them, so browsers and password
managers pair a username with its password, autofill saved credentials, and offer to save new
ones. react-native-web never renders a `<form>` on its own, and Chrome logs "Password field is not
contained in a form" for every password input outside one. On native it renders a `Box`.

``````typescript
import {Button, FormContainer, type FormContainerHandle, TextField} from "@terreno/ui";

const formRef = useRef<FormContainerHandle>(null);
const passwordRef = useRef<TextInput | null>(null);

<FormContainer accessibilityLabel="Sign in" gap={4} onSubmit={signIn} ref={formRef}>
  <TextField
    autoComplete="username"
    blurOnSubmit={false}
    onChange={setEmail}
    onEnter={() => passwordRef.current?.focus()}
    returnKeyType="next"
    title="Email"
    type="email"
    value={email}
  />
  <TextField
    autoComplete="current-password"
    inputRef={(ref) => {
      passwordRef.current = ref;
    }}
    onChange={setPassword}
    onEnter={() => formRef.current?.requestSubmit()}
    returnKeyType="go"
    title="Password"
    type="password"
    value={password}
  />
  <Button onClick={() => formRef.current?.requestSubmit()} text="Log In" />
</FormContainer>
``````

| Prop | Type | Behavior |
| --- | --- | --- |
| `onSubmit` | `() => void \| Promise<void>` | Called on `ref.requestSubmit()` and, on web, when the browser submits the form. The page reload is always prevented. |
| `ref` | `Ref<FormContainerHandle>` | `requestSubmit(): Promise<void>`. On web it calls the form element's `requestSubmit()`, so the browser fires a real submit event (password managers watch for it to offer "Save password") and the submit handler calls `onSubmit`; it resolves when `onSubmit` settles. On native, and in browsers without `requestSubmit`, it calls `onSubmit` directly. |
| `username` | `string` | For forms without a username field, such as change password: on web a hidden, read-only `autocomplete="username"` input names the account so password managers update its saved password. Ignored on native. |
| `accessibilityLabel` | `string` | Names the form; on web a named form is a `form` landmark. |
| Box layout props | | `gap`, `padding`, `width`, and the rest of `Box`'s layout props apply to the inner `Box`. |

The `<form>` uses `display: contents` and `noValidate`, so it adds no layout box and no browser
validation bubbles. `TextField` stops the browser's implicit Enter submission (it handles Enter
through `onEnter`), so Enter never submits twice: give earlier fields `returnKeyType="next"`, an
`onEnter` that focuses the next field, and `blurOnSubmit={false}`, and call
`ref.requestSubmit()` from the last field and the submit button. A `FormContainer` inside another
one renders a `Box`, since HTML forms cannot nest; its `requestSubmit` calls its own `onSubmit`.

`LoginScreen`, `SignUpScreen`, `PasswordCard`, the password step of `TwoFactorSettingsCard`, and
`GPTChat`'s API key modal already use it.

**Test IDs:** the form is `{testID}` on web and the `Box` is `{testID}` on native; the hidden
username input is `{testID}-username`.

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

The history sidebar (model selector, toolbar, New chat, and the history list) is a 250px-minimum column. Pass `showHistory={false}` to leave it out so the chat panel takes the full width, as on a phone. The host then owns history navigation and the sidebar's controls. `showHistory` defaults to `true`.

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

Pass `uiBlocks` to render each assistant message through `BlocksView`. A streaming message
shows each finished top-level block and a spinner for the block still arriving. `reply`
calls `onSubmit` with the button text. `open` and `select` call `onBlockAction`. `callback`
calls `onBlockCallback` and the button stays loading until that promise settles. Return
`{replace: "block", blocks}` to swap that block, or `{text}` to place an assistant message
immediately after the message that started the callback. A result that arrives after
`currentHistoryId` changes is dropped. `hostActions` disables callback names the host did
not list. `resolveDataset` loads `ref` datasets. `resolveImage` turns a `file:` image id
into a URL.

```tsx
<GPTChat
  currentMessages={messages}
  histories={histories}
  hostActions={["export_csv"]}
  onBlockAction={handleBlockAction}
  onBlockCallback={handleBlockCallback}
  onCreateHistory={onCreateHistory}
  onDeleteHistory={onDeleteHistory}
  onSelectHistory={onSelectHistory}
  onSubmit={onSubmit}
  uiBlocks
/>
```

Operator steps: [Add a GPT chat mascot](../how-to/add-gpt-chat-mascot.md). Demo story: `GPTChat` → `Mascot`.
Blocks playground: `BlocksPlayground`.
The example AI screen demonstrates a consumer selecting one of four bundled mascot
images once per mount.

#### Asks

`GPTChat` shows an [agent ask](agent-ui-asks.md) as an `AskCard` in the transcript. Set `ask` on
the ask's `tool-call` message and pass `onAskSubmit`:

```tsx
<GPTChat
  askErrors={askErrors}
  currentMessages={currentMessages}
  histories={histories}
  onAskSubmit={handleAskSubmit}
  onCreateHistory={onCreateHistory}
  onDeleteHistory={onDeleteHistory}
  onSelectHistory={onSelectHistory}
  onSubmit={onSubmit}
/>
```

| Prop or field | Type | Description |
| --- | --- | --- |
| `GPTChatMessage.ask` | `ChatAsk` | On a `tool-call` message: the ask (`kind`, `input`), its `toolCallId`, `status` (`pending`, `answered`, or `cancelled`), and optional `response` and `simple` card. The chat shows an `AskCard` instead of the tool call. |
| `onAskSubmit` | `(submission: {toolCallId, response}) => void \| Promise<void>` | Called when the user answers a pending ask. `response` is the answer envelope. The pressed control shows a loading state until the promise settles. Without it, asks show but cannot be answered. |
| `askErrors` | `Record<string, AskValidationError[]>` | Errors for the last answer to each ask, keyed by tool call id, such as the `fields` of a 400 `Invalid askResponse`. Shown inside the card. |
| `resolveAskFiles` | `AskFilesResolver` | Turns the files picked for a `files` ask into the refs its answer sends. Defaults to `resolveAskFilesAsDataUrls`. Pass an uploader to send `{fileId}` refs; see [Accept uploads with or without GCS](../how-to/agent-ui-asks.md#accept-uploads-with-or-without-gcs). |

- The ask's `tool-result` message stays in `currentMessages` but is not shown. Keep it: message
  indexes must match the stored `prompts` rows that ratings use. When `ask.response` is unset, the
  card reads the answer from that message.
- A pending ask takes focus when it appears: DOM focus on the card, labelled with the ask's
  `title`, on web; accessibility focus on the question, an accessibility header, on native.
- Answered and cancelled asks collapse to a one-line summary.

The example AI screen, `example-frontend/app/(tabs)/ai.tsx`, handles the stream events, saved
rows, answers, and errors. Steps: [Add agent asks to a chat](../how-to/agent-ui-asks.md).

### BlocksView

`BlocksView` paints a whole-reply document from `@terreno/blocks`. Pass the assistant text
as `document`. Leaf blocks in this slice are `heading`, `text`, `metric`, `badge`,
`divider`, and `context`. `columns` is a row from the `md` breakpoint and a stack on `sm`.
`card` groups children under an optional title, with an optional small muted `eyebrow` above it (test ID `<card path>-eyebrow`). A `callout` draws `Banner` and is not dismissible. An `image` draws `Image` and requires `alt`; pass `imageHosts` to allow `https` hosts. A `details` block draws `Accordion`. A `chart` draws `LineChart`, `BarChart`,
`AreaChart`, or `DonutChart` from an inline dataset or from `points`. The series is only
`{label, value}` — a point color in the document is not passed through. A `table` draws
`DataTable` and maps each dataset column type to a cell: `number` to a right-aligned
`number` cell, `date` to a `date` cell (Luxon `DATE_MED`, such as "Mar 14, 2026"), and
`string` to `text`. A listed column that the dataset does not have yet is `text`. Each header
is the column name with underscores shown as spaces (`bone_in_lamb` reads "bone in lamb"). The table
measures its container with `onLayout` and splits the width evenly across its columns, with
at least 96 per column; past that it scrolls sideways. Before the first layout each column
is 120 wide. Its height fits the header plus its rows (54 each), up to 10 rows; a longer table
scrolls inside that height, so it never spills over the next block. A `ref` dataset stays empty until `resolveDataset` returns its rows, and the
chart shows `loading` while that promise is in flight. A rejected fetch clears that
loading state. A segmented control highlights the option whose `data` matches the target
chart or table. A `select` action switches a table the same way it switches a chart.
An image `file:` ref is not passed to `Image` until `resolveImage` returns a URL; the
alt text still shows.

A string that is not a document becomes one `text` block. A document that fails
`validateBlocks` shows a `Banner` with the first three errors and the raw text inside a
collapsed `Accordion`.

An `actions` block draws `Button` and `SegmentedControl`. `onAction` receives
`{action, blockId, elementId}` for reply, open, select, and callback. A `select`
action also stores the chosen dataset on the target chart for this view. Pass
`hostActions` to disable callback buttons whose names are not in that list. Omit
`hostActions` and every callback stays enabled. `pendingElementIds` shows those
buttons as loading. `overrides` replaces a block by id.

A `stepper` draws its `label` as a small muted line, then `IconButton` − and + around the
value and its `unit`, then `itemsTitle`, a two-column grid of item labels and amounts
(formatted with `decimals`, so `{amount: 2, unit: kg, decimals: 1}` reads "2.0 kg"), and the
muted `note`. − is disabled when `value - step` would fall below `min`, and + when `value + step`
would pass `max`, so with `max: 20` and `step: 2` + is disabled at 19. Both are disabled while either button's
element id is in `pendingElementIds`, and when `hostActions` is passed without the stepper's
`callback.name`. The buttons are labelled "Decrease <label>" and "Increase <label>". A tap
calls `onAction` with `blockId: <id>`, `elementId: <id>_decrease` or `<id>_increase`, and
`{kind: "callback", name, payload: {...payload, value: value ± step}}`. A host returns the
new stepper, and `overrides[<id>]` paints it.

A `checklist` draws its `title` on the left and an "n of m" counter on the right, then one
`CheckBox` row per item: the bold `text` first, then the small muted `meta` (such as a time),
then the muted `detail`. Each row is a pressable `Box` with the `checkbox` role, labelled with the item
text, that reports `accessibilityState` `{checked, disabled}` (`aria-checked` and
`aria-disabled` on web); Space toggles a focused row on web. A locked row keeps its role and
label and reports `disabled: true`. Test ids are stable across states: the item wrapper is
`<path>-<id>_<item id>`, the pressable row `<path>-<id>_<item id>-row-clickable`, its
`CheckBox` `<path>-<id>_<item id>-checkbox`, its lines `<path>-<id>_<item id>-text`, `-meta`,
and `-detail`, and the counter `<path>-counter`. A tick goes to the host when the checklist has a `callback`,
`onAction` is passed, and `hostActions` is omitted (as for the stepper) or lists
`callback.name`. Then a tap calls `onAction` with `blockId: <id>`,
`elementId: <id>_<item id>`, and `{kind: "callback", name, payload: {...payload, itemId,
checked, state}}`, where `state` maps every item id to its tick after this one. The tick is
not drawn ahead of the reply. `BlocksView` disables the checklist while a tick is pending:
while any of its `<id>_<item id>` element ids is in `pendingElementIds`, no row is pressable,
so a second tick cannot send a `state` that misses the first. The counter changes when
`overrides[<id>]` brings the returned checklist. Otherwise a tick stays in this `BlocksView` only and updates the counter at once.
When an override for the checklist arrives or changes, earlier local ticks on it are dropped
and the override's `checked` values show.
On the server, `toggleChecklistHostAction` from `@terreno/ai` handles the callback and returns
the stored checklist with the ticks from `state` (see [Host actions](ai.md#host-actions)). A host
that records progress registers its own `handles: "checklist"` action.

A `gallery` draws each image as a 4:3 `Image` tile (`fit` cover), with `alt` as the tile's
accessible label and the optional `caption` as small muted text under it. Tiles are 8 apart
(the `gap={2}` spacing step). The gallery measures its container with `onLayout`: up to three
images share one row at equal widths, and more wrap into a three-column grid whose last row
keeps the same tile width. When that width would fall under 160, every tile stays 160 wide in
one row that scrolls sideways. A measured width decides this rather than the `sm` breakpoint, so
a gallery inside a narrow `columns` child or card also scrolls. Before the first layout each tile
is 160 wide. A `file:` tile loads through `resolveImage` like an `image` block. Until it has a
URL, or when the lookup fails, the tile is a muted 4:3 placeholder that shows the alt text and
keeps it as the label. Test ids: the gallery `<path>`, each grid row `<path>-row-<n>`, the
scrolling row `<path>-scroll`, each tile `<path>-image-<index>`, the frame around a loaded
image `<path>-image-<index>-image`, its caption `<path>-image-<index>-caption`, and a
placeholder `<path>-image-<index>-placeholder`.
`Image` passes `alt` to the native image as its `accessibilityLabel`.

A `list` draws one row per item, 12 apart (`gap={3}`). The row starts with a 3:4 portrait
`Image` thumbnail (`fit` cover), always 112 wide and 149 tall, with `alt` as its accessible label.
Beside it, the optional `meta` sits small and muted above the bold `title`, and the optional
`text` follows in muted body text. `text` is plain text, not markdown. When any item in the list
has a thumbnail, an item without one keeps an empty 112-wide gutter so every title starts at the
same place; a list with no thumbnails draws text only, with no gutter. A `file:` thumbnail loads
through `resolveImage`, including in a list inside a card. Until it has a URL, or when the lookup
fails, it is a muted 112 by 149 placeholder that shows the alt text and keeps it as the label.
Test ids: the list `<path>`, each row `<path>-item-<index>`, its thumbnail
`<path>-item-<index>-image`, placeholder `<path>-item-<index>-placeholder`, gutter
`<path>-item-<index>-gutter`, text column `<path>-item-<index>-body`, and the
`<path>-item-<index>-meta`, `-title`, and `-text` lines.

A `copy` button writes the clipboard on the device and never calls `onAction`, so
`hostActions` does not disable it. A press builds the text with `blockPlainText` from
`@terreno/blocks`: a literal `text` as written, or the `target` block as it is shown now. That
means the `overrides` replacement (a stepper at 6 copies the scaled amounts), the checklist's
ticks made on the device, and a table's selected dataset, inline or a `ref` that
`resolveDataset` has returned. `BlocksView` writes it with `expo-clipboard` `setStringAsync`
(web and native), then shows "Copied" in small muted text beside the button for 2 seconds. A
failed write, or a target with no text yet (such as a `ref` table still loading), shows
"Couldn't copy" in error text for 2 seconds instead, logs `console.warn`, and does not throw.
The status sits in a `Box` with `accessibilityLiveRegion="polite"`, which stays mounted while
empty, so screen readers on web and Android announce the status when it appears (`Text` has
no live-region prop, and VoiceOver on iOS does not announce React Native live regions).
Test ids: the button `<path>-<element id>`, the live region `<path>-<element id>-status`, and
the status text `<path>-<element id>-status-text`.

```tsx
<BlocksView
  document={reply}
  hostActions={["export_csv"]}
  onAction={handleAction}
  testID="assistant-blocks"
/>
```

Demo story: `BlocksView`.

### MarkdownView

`MarkdownView` renders markdown with `react-native-markdown-display` and the current theme.
GPTChat and the `text` block render through it.

GFM tables use theme colors, never fixed hex values:

- Cell borders draw a grid in `theme.border.default`.
- Header cells sit on `theme.surface.secondaryLight` and use the bold text font (`text-bold`).
  Body cells use `text-regular`.
- Every column gets an equal share of the width, at least 96. A narrow table fills its
  container. A table wider than its container scrolls sideways in a horizontal `ScrollView`.

Test ids: `markdown-table-scroll` (the scroll view), `markdown-table`,
`markdown-table-header-<column>`, and `markdown-table-cell-<row>-<column>` (body rows count
from 0).

### HtmlFrame

`HtmlFrame` paints one `html` block. On web it is an `<iframe sandbox="" referrerpolicy="no-referrer">` whose `srcdoc` starts with a Content-Security-Policy meta tag (`default-src 'none'`). On native it is a WebView with JavaScript off, and navigation after the first load is rejected. `BlocksView` renders that frame only when `allowHtml` is true and `streaming` is false. Otherwise the block is a card that says the preview is off or still arriving. `GPTChat` passes `allowHtml` through.

```tsx
<HtmlFrame height="md" html="<h1>Invoice</h1>" title="Invoice preview" />
```

### AskCard

One agent ask in a chat transcript: controls while it is pending, a summary line after. `GPTChat`
renders it for messages with `ask`. Render it directly in a custom transcript. A saved ask whose
input no longer validates, or whose `accept` answer has no `content` object, shows the generic
line ("You answered this question.") and no sent values.

```tsx
<AskCard ask={ask} errors={errors} onSubmit={handleAskSubmit} testID="plan-ask" />
```

| Prop | Type | Description |
| --- | --- | --- |
| `ask` | `ChatAsk` | The ask. Pending asks are interactive. Answered and cancelled asks show a summary. |
| `errors` | `AskValidationError[]` | Errors for the last answer, shown under the controls |
| `onSubmit` | `AskSubmitHandler` | Called with `{toolCallId, response}`. Without it, the card cannot be answered: buttons and the select are disabled, and radio and checkbox options show as plain text. When the promise it returns rejects, the ask stays open and the card shows "Your answer could not be sent. Try again." until the next answer. |
| `promptRef` | `React.Ref<Text>` (React Native) | Receives the question's native text, which is an accessibility header. `GPTChat` uses it to move screen reader focus to a pending ask on native. |
| `resolveAskFiles` | `AskFilesResolver` | For a `files` ask: turns the picked files into refs on Submit. Defaults to data URLs. `GPTChat` passes its own `resolveAskFiles`. |
| `testID` | string | Defaults to `ask-card`. `GPTChat` passes `gpt-ask-<toolCallId>`. |

A saved ask whose input no longer passes `validateAskInput` shows "This question cannot be shown.
Send a message to continue." while pending, and "You answered this question." once answered.

`choice` controls:

| Ask | Controls |
| --- | --- |
| The simple card has a button for every option (`handoff: false`), and every option label is at most 20 characters | The card's buttons as quick replies, then Skip unless `allowDecline` is `false`. A tap answers. |
| Up to 8 options | `RadioField`, then Submit (`submitLabel`) and Skip |
| More than 8 options | Searchable `SelectField`, then Submit and Skip |
| `select: "many"` | `MultiselectField` with a hint such as "Choose 1 to 3.", then a `TextField` titled `otherLabel` (default "Other") when `allowOther` is `true`, then Submit and Skip |

The selection starts on the ask's `default`. Submit is enabled only when `validateAskResponse`
accepts the selection. For `select: "many"`, the answer lists the checked ids in option order and
sends the Other text trimmed, leaving `other` out when the field is blank. When the checked
options and the Other text add up to more than `maxSelected`, the checkboxes say so ("You chose
4. Choose at most 3."). An Other text over 500 characters, or a server error at `content.other`,
shows on the Other field. When `ask.simple` is absent, the card derives it with `toSimpleCard`. An
ask whose input fails `validateAskInput` shows "This question cannot be shown. Send a message to
continue." instead of controls.

`confirm` controls: the simple card's two buttons in its order, the approve button (`confirmLabel`,
default "Confirm") first and the deny button (`denyLabel`, default "Cancel") last. The approve
button uses the `destructive` variant when the ask sets `destructive: true`, else `primary`; the
deny button uses `ghost`. Skip follows only when `allowDecline` is `true`. A tap answers
`{"confirmed": true}` or `{"confirmed": false}`. Without `onSubmit`, both buttons are disabled.

`markdown` controls: a `MarkdownEditorField` (edit and preview, at most 320 pt tall) that starts
on the ask's `initial` draft and shows `placeholder` while empty, then Submit (`submitLabel`) and
Skip unless `allowDecline` is `false`. Under the editor a hint gives the length and the bounds,
such as "1,240 / 2,000 characters. At least 20." Submit is enabled only when
`validateAskResponse` accepts the text, and it sends `{markdown, changed}` with `changed` true
when the text differs from `initial`. Text over `maxLength`, or a server error at
`content.markdown`, shows on the editor. Without `onSubmit`, the editor and both buttons are
disabled. An answered markdown ask shows the sent text under its summary; text over 280
characters shows a preview cut at a word, with Show all and Show less.

`form` controls: one field per entry in `fields`, in order, titled with the field's `label`
("(required)" appended for required fields) and its `helperText`, then Submit (`submitLabel`) and
Skip unless `allowDecline` is `false`. Each field uses the `@terreno/ui` control for its type:

| Field `type` | Control | Sends |
| --- | --- | --- |
| `text`, `email`, `url` | `TextField` (`text`, `email`, `url`) | The trimmed text |
| `phone` | `TextField` (`phoneNumber`) | E.164, such as `+14155552671`, when the number parses (as a US number without a country code); else the trimmed text |
| `number` | `TextField` | A number when the text is plain decimal notation; else the text, so validation says why |
| `textarea` | `TextArea` | The trimmed text |
| `date` | `DateTimeField` (`date`) | `YYYY-MM-DD` |
| `time` | `DateTimeField` (`time`) with its time zone picker (the device's zone to start) | 24-hour `HH:mm` as shown; the zone is not sent |
| `datetime` | `DateTimeField` (`datetime`) with a time zone picker | An ISO datetime with the chosen zone's offset, such as `2026-10-01T09:30:00-07:00` |
| `boolean` | `BooleanField` | `true` or `false`, always |
| `select` | `SelectField` | The option id |
| `multiselect` | `MultiselectField` | The checked option ids |

Fields start on their `default`. Blank fields are left out of `values`. Submit is enabled only
when `validateAskResponse` accepts the values and no date, time, or datetime field holds an
unfinished entry. `DateTimeField` reports that through `onEntryStatusChange`, such as
"0 / 5 / 026": the field says "Enter a complete date, or clear it." until the user finishes it,
and clearing every part leaves the field out. After the user edits a field, it says what is
wrong in plain words, such as "Enter a number from 1 to 500." or "This field is required." A
server error whose path is `content.values.<id>` (or an item under it) shows on that field until
the user edits it; other errors show under the form. Without `onSubmit`, every field and both
buttons are disabled. An answered form lists each sent field as its label and a readable value
(Yes or No, option labels, "Oct 1, 2026", "9:30 AM", text shortened to one line of 80
characters) under its summary.

`files` controls: a hint built from the counts and types, such as "Up to 3 files: images, PDFs or
text files.", then a "Choose files" `FilePickerButton` ("Add files" once some are picked), the
picked files as an `AttachmentPreview` with a remove control on each, then Submit (`submitLabel`,
default "Submit") and Skip unless `allowDecline` is `false`. The picker offers Photo Library only
when `accept` has `image`, and its document picker offers only the accepted MIME types. It allows
several files when `maxFiles` is more than 1 and is disabled once `maxFiles` files are picked.
Submit is enabled only when `validateAskResponse` accepts the picked names, types, and sizes. On
Submit, the card calls `resolveAskFiles` with the picked files and sends `{files: refs}`; Submit
shows a spinner and Skip is disabled until the answer is sent. When the ask ends another way while
the resolver runs, such as an answer from another tab, its refs are not sent. If the resolver throws, the ask
stays open and the card shows "The files could not be sent. Try again, or pick them again." Server
errors, such as `MIME_MISMATCH`, show under the picked files. Each file's type is
`selectedFileMimeType(file)`, so a CSV a picker reports as `application/vnd.ms-excel` is sent as
`text/csv`.

| How the ask ended | Summary |
| --- | --- |
| `files` `accept` | You sent `<n>` files: `<filenames>`, or You sent 1 file: `<filename>` |
| `form` `accept` | You sent the form (`<n>` fields) |
| `markdown` `accept` | You approved the draft as is (`changed: false`), or You edited the draft (`<n>` characters) |
| `confirm` `accept` | You confirmed: `<confirmLabel>`, or You declined: `<denyLabel>`, with the default labels when the ask sets none |
| `choice` `accept` | You chose: `<option labels>`. With Other text, it adds "`<otherLabel>`: `<text>`" (the label defaults to "Other"), or shows only that when no option was checked. An empty `select: "many"` answer shows "You chose none of the options." |
| `decline` | You skipped this question. |
| `cancel` with `user_sent_message` | Not answered: you sent a message instead. |
| `cancel` with `one_ask_at_a_time` | Not asked: the assistant asked another question first. |
| Any other `cancel`, or status `cancelled` without a response | This question was cancelled. |
| Status `answered` without a response | You answered this question. |

| Element | testID |
| --- | --- |
| Card | `{testID}` |
| Quick reply row | `{testID}-quick-replies` |
| Quick reply or Skip button | `{testID}-button-<button id>`, such as `{testID}-button-option:team` or `{testID}-button-skip` |
| Confirm button row | `{testID}-confirm-buttons` |
| Confirm approve or deny button | `{testID}-button-approve`, `{testID}-button-deny` |
| Radio options (up to 8) | `{testID}-radio` |
| Select | `{testID}-select` |
| Checkboxes (`select: "many"`) | `{testID}-multiselect` |
| Other text field | `{testID}-other` |
| Markdown editor, and its text input | `{testID}-editor`, `{testID}-editor-input` |
| Sent markdown under an answered ask, and its Show all toggle | `{testID}-answer`, `{testID}-answer-toggle` |
| Form field, and its wrapper | `{testID}-field-<field id>` (a `BooleanField` switch is `{testID}-field-<field id>.switch`), `{testID}-form-field-<field id>` |
| Sent form values under an answered ask | `{testID}-answer` |
| Files hint, picker, and picked files | `{testID}-hint`, `{testID}-picker`, `{testID}-selected` |
| Files that could not be sent | `{testID}-resolve-error` |
| Radio or checkbox options as plain text, without `onSubmit` | `{testID}-options` |
| Submit | `{testID}-submit` |
| Answer errors | `{testID}-errors` |
| Summary | `{testID}-summary` |
| Ask that cannot be shown | `{testID}-invalid` |
| Answer that could not be sent | `{testID}-submit-error` |

Types: `AskCardProps`, `ChatAsk`, `ChatAskState`, `ChatAskStatus`, `AskSubmission`,
`AskSubmitHandler`, `AskFilesResolver`. Demo story: `AskCard`.

File ref helpers:

| Export | Description |
| --- | --- |
| `AskFilesResolver` | `(files: SelectedFile[]) => Promise<AskFileRef[]>`. Throw to keep the ask open. |
| `resolveAskFilesAsDataUrls` | The default resolver: every file as a `{url}` data URL |
| `selectedFileToDataUrlRef(file)` | One picked file as `{filename, mimeType, size, url}`. The data URL's media type is `selectedFileMimeType(file)`, and `size` is the decoded byte count. |
| `selectedFileMimeType(file)` | The picked file's normalized type. When the picker reports none, `application/octet-stream`, or `application/vnd.ms-excel` (Windows reports CSV files so), the type comes from the extension: `.csv`, `.gif`, `.jpeg`, `.jpg`, `.json`, `.pdf`, `.png`, `.txt`, `.webp`. Otherwise the reported type is kept. |
| `normalizeMimeType(mimeType)` | Drops parameters and lowercases: `Text/CSV; charset=utf-8` becomes `text/csv` |

`FilePickerButton` props used by the files card, also available to any caller:

| Prop | Type | Description |
| --- | --- | --- |
| `documentTypes` | `string[]` | MIME types the document picker offers. Defaults to PDF, text, CSV, and JSON. An empty list hides Document. |
| `includeImages` | boolean | Offer Photo Library. Defaults to `true`. When `false`, the button opens the document picker directly. |
| `text` | string | Shows an outline button with this label instead of the paperclip icon |

`SelectedFile.size` is the file's size in bytes when the picker reports it.

### SimpleAskCard

Any agent ask as its [simple card](agent-ui-asks.md#simple-cards): the title, the question, and up
to three full-width buttons that each send an exact answer. Use it in narrow layouts, such as a
watch-sized preview. It reads the card's `kind` only to word the handoff line.

```tsx
const [runTurn] = useGpthistoriesTurnMutation();

<SimpleAskCard
  card={pendingAsk.simple}
  onPress={(button) =>
    runTurn({
      body: {buttonId: button.id, surface: "compact", toolCallId: pendingAsk.toolCallId},
      id: historyId,
    })
  }
  pendingButtonId={sendingButtonId}
/>
```

| Prop | Type | Description |
| --- | --- | --- |
| `card` | `SimpleCard` | `pendingAsk.simple` from the server, or `simple` on an `{ask}` event |
| `onPress` | `(button: SimpleCardButton) => void \| Promise<void>` | Called with the pressed button. Send `{toolCallId: card.toolCallId, buttonId: button.id}` to the history's [`turn` action](agent-ui-asks.md#headless-endpoints), or send `button.response` as the answer. |
| `pendingButtonId` | string? | The button whose answer is still sending. It shows a spinner, the other buttons are disabled, and presses are ignored. |
| `testID` | string? | Defaults to `simple-ask-card` |

- A card with `handoff: true` shows "Continue on your phone" under the question, because its
  buttons cannot give every answer. A `markdown` card shows "Edit on your phone" instead, a
  `form` card "Fill it in on your phone", and a `files` card "Upload on your phone".
- Button styles map to `Button` variants the same way as `AskCard` quick replies: `primary` to
  `primary`, `default` to `outline`, `destructive` to `destructive`, and `cancel` to `ghost`.

| Element | testID |
| --- | --- |
| Card | `{testID}` |
| Continue on your phone, or Edit on your phone | `{testID}-handoff` |
| Button | `{testID}-button-<button id>`, such as `{testID}-button-option:team` |

Types: `SimpleAskCardProps`, and `SimpleCard` and `SimpleCardButton` from `@terreno/blocks`. Demo
story: `SimpleAskCard`. Its demo answers a plan card on a watch-sized 198×242 pt screen, and its
"Every fixture" story draws every valid fixture's card at that size.

### ListDetailLayout

Route-driven list/detail layout, such as a mail inbox. Use it as a route group's `_layout.tsx`.
On a phone it is an expo-router `Stack`: the group's index route shows the list, and opening an
item pushes the detail route with the native animation and swipe-back. When the layout is at least
`splitAtWidth` wide, the list stays in a left pane and the `Stack` shows the detail beside it.

The width is the layout's own measured width, so it decides correctly inside a sidebar or an admin
rail. Before the first layout event, it uses the window width. The `Stack` stays in the same place
in the tree at every width, so it never remounts when a tablet rotates or a browser resizes, and
the open item stays open: crossing the breakpoint makes no router call. The
`list` element does move between the index screen and the left pane, so it remounts at the
breakpoint and its scroll position resets; keep list state such as filters or search text in the route or a store. The list pane
has no `Stack` header, so it applies safe-area insets on its top, left, and bottom edges.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `list` | `ReactElement` | required | The list. Rendered in the left pane when split, and by `ListDetailIndex` when not |
| `detailHref` | `(id: string) => Href` | required | Where selecting an item navigates |
| `indexHref` | `string` | required | The group's own path, such as `/mail` |
| `emptyDetail` | `ReactElement` | none | Shown in the detail pane when split and nothing is open |
| `splitAtWidth` | `number` | `768` | Split when the layout is at least this many pixels wide |
| `listWidth` | `number` | `360` | Width of the list pane when split |
| `detailRoute` | `string` | `"[id]"` | The child route name that holds the detail |
| `paramName` | `string` | `"id"` | The route param that holds the item id |
| `screenOptions` | `Stack` `screenOptions` | none | Passed through to the `Stack` |
| `children` | `Stack.Screen` elements | none | Passed through to the `Stack` |

`ListDetailIndex` is the group's `index.tsx` screen. It renders `list` when stacked, and
`emptyDetail` when the list already sits in the left pane.

`useListDetail()` returns `{isSplit, selectedId, select, clear}` and throws outside a
`ListDetailLayout`.

- `selectedId` is the `paramName` param of the route directly below `indexHref` whose segment is
  `detailRoute`. It is `undefined` on the index route, and an `id` from a parent dynamic segment
  never counts.
- `select(id)` pushes `detailHref(id)`. When split with another item open, it replaces the open
  detail instead, so the stack is never deeper than the list plus one detail and back always
  returns to the list. When split, selecting the open item again does nothing.
- `clear()` calls `router.dismissTo(indexHref)` when an item is open, so it pops back to the
  index inside this `Stack` and never leaves the group. It does nothing when no item is open.

When split, the list is already on screen, so the header's back never returns to it: `Stack`
screens get `headerBackVisible: false`, `animation: "none"`, and a `headerLeft` back button
(`list-detail-leave`) that leaves the group through the parent navigator, or nothing when the
parent cannot go back. The web header ignores `headerBackVisible`, so `headerLeft` draws it. Your
`screenOptions` win where they set the same key. A static web export writes a detail URL only when
`[id].tsx` exports `generateStaticParams` for that id; other ids need the host's `index.html`
fallback. Mark the open row with
`accessibilityState={{selected: true}}` so screen readers announce it (a clickable `Box` row sends
it as `aria-current="true"` on web). See
[Build a list/detail screen](../how-to/build-list-detail-screens.md).

| Element | testID |
| --- | --- |
| Layout root | `list-detail-layout` |
| List pane (split only) | `list-detail-list-pane` |
| Detail pane, which holds the `Stack` | `list-detail-detail-pane` |
| Empty detail (split, nothing open) | `list-detail-empty` |

```typescript
// app/mail/_layout.tsx
import {ListDetailIndex, ListDetailLayout, Text} from "@terreno/ui";

export const unstable_settings = {initialRouteName: "index"};

const MailLayout: React.FC = () => (
  <ListDetailLayout
    detailHref={(id) => `/mail/${id}`}
    emptyDetail={<Text>Select a message</Text>}
    indexHref="/mail"
    list={<MailList />}
  />
);
export default MailLayout;

// app/mail/index.tsx
const MailIndex: React.FC = () => <ListDetailIndex />;
export default MailIndex;

// app/mail/[id].tsx is an ordinary route screen that reads its id with useLocalSearchParams.
```

### SplitPage

Prefer [`ListDetailLayout`](#listdetaillayout) for new list/detail screens: it keeps the selected
item in the route, so deep links and back navigation work, and it splits on native tablets.
SplitPage remains supported for list/detail views that do not have their own routes.

Master-detail layout. Pass `listViewData` plus `renderListViewItem` for the list, and
`renderContent` or children for the detail pane. On large screens both panes stay visible. On small
screens the detail replaces the list until the user goes back.

`desktopChildrenMinWidth` opts into a minimum pixel width for each desktop child when there
are one or two children. `childColumnRounding` sets the border radius on each desktop detail
pane (defaults to `md`, 4px); the list column is excluded. The pane clips to that radius. The
column inside it scrolls: content taller than the pane scrolls in the column, and a child with
`height: "100%"` fills the visible pane so a scroll view inside that child scrolls on its own.
On a narrow web viewport the pager page is height-bounded to that same visible pane. Its rounded
corners still clip, and a `height: "100%"` child scrolls inside the page. On the labeled pager,
previous and next sit in fixed left and right slots in a row under the column. A missing direction
leaves that slot empty, so the other arrow stays put. The column height is the measured pane minus
top spacing, the navigation row, bottom spacing, and `bottomNavBarHeight`.
`narrowViewportChildLabels`
opts into a labeled full-width pager on the narrow viewport. `narrowBelowWidth` uses that
viewport when the window is at or below the given pixel width; when omitted, the narrow
viewport follows `isNarrowViewport()`. These props are web only; the native `SplitPage`
ignores them. See `SplitPageProps` for when each prop applies and what is ignored. An unset
`color` is `baseAlternate` on web and native.
`IconButton`'s `backgroundOpacity` tints only that button's background.

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

### Tooltip

`Tooltip` (and `tooltipText` on `Button` / `IconButton`) renders its bubble outside the trigger's clipping and stacking context:

| Platform | Mount point | Positioning |
| --- | --- | --- |
| Web | `document.body` | `position: fixed`, `z-index: 9999`, so it shows above an open `Modal` and nothing else covers the page |
| iOS / Android | `TerrenoProvider` portal host | `position: absolute`, `z-index: 999` |

The bubble stays off screen at `opacity: 0` until the trigger is measured, then `getTooltipPosition` places it at `idealPosition` or the first side that fits on screen.

### Toast

`TerrenoProvider` mounts the toast container. Call `useToast()` for `success`, `info`, `warn`, `error`, `show`, `hide`, and `catch`.

On web, that container is portaled to `document.body` (`position: fixed`, `z-index: 999999`, `pointerEvents: "box-none"`), so a toast stays above an open `Modal` and its backdrop. The web container is sized with `100%` rather than the measured window, so statically exported pages (where `Dimensions` reports 0×0 at build time) still center the toast on screen. Native iOS and Android keep the in-tree absolute container sized to the window.

Only the visible toast takes clicks. Every full-width layer around it (the container, its safe area, and the `Toast` layout wrapper) uses `pointerEvents: "box-none"`, so a button at the same height as an open toast stays clickable. Declare that style through `StyleSheet.create`; react-native-web drops `pointerEvents` from inline styles.

## Consent components

Client side of `ConsentApp` ([API reference](api.md#consent-forms-consentapp),
[concepts](../explanation/consent-forms.md)). Lazily exported from the package root.

### ConsentNavigator and ConsentFormScreen

`ConsentNavigator` wraps app content, fetches `GET /consents/pending` through
`useConsentForms(api, baseUrl)`, and renders `ConsentFormScreen` for each pending form until
the list is empty. `ConsentFormScreen` shows the form's markdown (with `{{variable}}`
substitution), required checkboxes, an optional signature, the scroll-to-bottom gate, and the
agree and decline buttons.

When staff signed the form provisionally, the pending form carries
`provisionalSignature: {signedAt, signedByName}` (`ConsentFormPublic`), and the screen shows
"Signed on your behalf by <name> on <date>" above the content (`testID`
`consent-form-provisional-notice`, date in Luxon `DATETIME_MED` for the screen's `locale`). The user still agrees or
declines themselves: the scroll gate, checkboxes, and signature work as for any other form.
The signer's note is never shown.

`useConsentForms.ts` also exports two helpers the consent components share:
`applyConsentVariables(content, variables?)` replaces `{{name}}` placeholders and leaves
unknown ones as written, and `resolveConsentLocale(form, locale)` picks the content locale to
show: the exact locale, then its language (`en-GB` → `en`), then the form's default.

### ProvisionalConsentSigner and useProvisionalConsent

For staff who record consent on a user's behalf. The server must grant the viewer
`consentResponse:signOnBehalf` (or `user.admin` when `ConsentApp` has no `accessControl`).

```tsx
import {ProvisionalConsentSigner} from "@terreno/ui";

<ProvisionalConsentSigner api={terrenoApi} userId={memberId} />
```

| Prop | Type | Description |
| --- | --- | --- |
| `api` | RTK Query api | The consumer api, as passed to `ConsentNavigator` |
| `baseUrl` | `string` | Optional prefix for consent routes |
| `userId` | `string` | The user being signed for |
| `onSigned` | `(response) => void` | Called with the stored `ConsentResponse` after a provisional signature |
| `onError` | `(error) => void` | Called with the server error when signing fails |
| `variables` | `Record<string, string>` | Values for `{{name}}` placeholders in form content |

It lists every form that applies to the user (`GET /consent-responses/status`) with a status
badge: "Pending", "Signed provisionally by <signer> on <date>", "Signed by user on <date>",
or "Declined by user on <date>". It shows a spinner while loading and the server error with
a Retry button on failure. Lazily exported from the package root.

Pending forms have a "Sign on behalf" button. Declined forms do not: the user's own decline
always decides the status, so a provisional signature would not count. It opens the form read-only
(`MarkdownView`, `variables` applied, in the viewer's locale, then that locale's language,
then the form's default) with a required "Note" box. "Sign provisionally" stays disabled until
the note has text. Submitting sends `{userId, consentFormId, note, locale}` to
`POST /consent-responses/provisional`, then returns to the list with a confirmation naming
the signer and time, and calls `onSigned`. A server error shows under the note and calls
`onError`. The signer never ticks the form's checkboxes or draws a signature: those stay the
user's.

Provisional, signed, and declined rows have a "Print" button, and so does the confirmation
after signing. It calls `printConsentHtml` with `buildConsentPdfHtml` HTML: the form content,
its status, and, when there is a provisional signature, the "Provisional signature" block with
the signer, date, and note. Provisional rows also have "Void". It opens a dialog that asks for
a required reason, sends it to `POST /consent-responses/:id/void`, and refetches, so the row
returns to "Pending". A void error shows in the dialog and calls `onError`.

`useProvisionalConsent({api, baseUrl?, userId})` returns `{statuses, isLoading, error,
refetch, sign, isSigning, voidSignature, isVoiding}`. `statuses` are `ProvisionalConsentStatusRow`s
(`{form, status, isConsented, respondedAt?, provisional?}`). `sign({consentFormId, note,
locale?})` signs for the hook's `userId` and resolves to the `ConsentResponse`, or rejects
with the RTK error. `voidSignature({responseId, reason})` voids a provisional signature the
same way. The hook injects `getConsentStatus`, `signConsentProvisionally`, and
`voidProvisionalConsent` once per `(api, baseUrl)`. Signing and voiding invalidate the
`ConsentStatus` and `PendingConsents` tags.

testIDs: `provisional-consent-signer`, `provisional-consent-loading`,
`provisional-consent-error`, `provisional-consent-retry-button`, `provisional-consent-empty`,
`provisional-consent-row-{formId}`, `provisional-consent-status-{formId}`,
`provisional-consent-open-{formId}`, `provisional-consent-form-content`,
`provisional-consent-note-input`, `provisional-consent-submit-button`,
`provisional-consent-cancel-button`, `provisional-consent-submit-error`,
`provisional-consent-success`, `provisional-consent-success-print`,
`provisional-consent-print-{formId}`, `provisional-consent-void-{formId}`,
`provisional-consent-void-modal` (confirm button `provisional-consent-void-modal.primary`),
`provisional-consent-void-reason-input`, `provisional-consent-void-error`.

### Consent printouts

`buildConsentPdfHtml(data)` builds a self-contained HTML document for a consent response
(response details, user info, checkboxes, audit trail, signature, content snapshot). Native
apps turn it into a PDF with `sharePdfFromHtml({html, filename})`.

`printConsentHtml({html})` opens the print dialog for that HTML: `expo-print` `printAsync`
on native, and on web a hidden `iframe` (`srcdoc`) whose window is printed, so the app page
itself is not. The iframe is removed after printing, or at the next print if the browser
never reports that printing finished, so consent HTML does not linger in the page. The
promise rejects if printing throws.

`PdfTemplateData.provisionalSignature?: {signedAt, signedByName, note?, signerIp?, voidedAt?}`
adds a "Provisional signature" section with the signer and date (ISO dates are printed with
Luxon `DATETIME_FULL`), the escaped note and signer IP when given, and "Voided <date>" when
voided. Pass `note` and `signerIp` only on admin printouts: the user never sees the note.

## Authentication Components

### SocialLoginButton

Branded social login buttons for OAuth authentication with Google, GitHub, and Apple.

``````typescript
import {SocialLoginButton} from "@terreno/ui";
import {authClient} from "@/store/authClient";

// The Better Auth client resolves {data, error} rather than throwing, and SocialLoginButton only
// logs a rejected onPress, so show the error yourself.
<SocialLoginButton
  provider="google"  // "google" | "github" | "apple"
  variant="primary"  // "primary" | "outline"
  onPress={async () => {
    const {error} = await authClient.signIn.social({
      provider: "google",
      callbackURL: "yourapp://auth/callback",
    });
    if (error) {
      setError(error.message ?? "Couldn't sign in with Google.");
    }
  }}
  loading={isLoading}
  fullWidth
/>
``````

**Features:**
- Proper brand colors for each provider (follows brand guidelines)
- Built-in icons (FontAwesome 6)
- Primary and outline variants
- Loading states with spinner; the spinner follows later changes to the `loading` prop
- Automatic text: "Continue with {Provider}"

### LoginScreen

Presentational login screen: email/password fields, branded and generic OAuth providers,
passkeys, a last-used badge, one-tap "Continue" cards, and a notice slot. It renders the methods
and accounts it is given and reports presses through callbacks; it never calls an auth client
itself. Without the optional props below it renders the plain email/password form.

``````typescript
import {LoginScreen} from "@terreno/ui";

// The Better Auth client resolves {data, error} rather than throwing, and LoginScreen does not
// catch a rejected onSubmit, so put the error in state and pass it as `error`.
// signInWithSocial and the other handlers below are app helpers that do the same.
const [error, setError] = useState<string | undefined>(undefined);

<LoginScreen
  error={error}
  fields={[
    {name: "email", label: "Email", type: "email", required: true},
    {name: "password", label: "Password", type: "password", required: true},
  ]}
  onSubmit={async ({email = "", password = ""}) => {
    setError(undefined);
    const {error: signInError} = await authClient.signIn.email({email, password});
    if (signInError) {
      setError(signInError.message ?? "Couldn't sign in.");
    }
  }}
  oauthProviders={[
    {provider: "google", onPress: () => signInWithSocial("google")},
    {provider: "github", onPress: () => signInWithSocial("github"), loading: isGitHubLoading},
  ]}
  genericProviders={[
    {id: "mock-oidc", label: "Mock OIDC", iconName: "key", onPress: () => signInWithSocial("mock-oidc")},
  ]}
  lastUsedMethod="github"            // provider id, "email", or "passkey"
  onPasskeyPress={signInWithPasskey}
  passkeyAutofill                    // web: email field gets autocomplete="username webauthn"
  currentSessions={deviceSessions}   // signed-in sessions on this device
  rememberedAccounts={remembered}    // accounts remembered from earlier sign-ins
  onContinue={(account, source) => (source === "session" ? switchTo(account) : reauth(account))}
  onForget={(account) => forget(account.id)}
  notice={{tone: "warning", text: "Sign in with Google to link GitHub.", actionLabel: "Continue with Google", onAction: () => signInWithSocial("google")}}
  onForgotPassword={() => router.push("/forgot-password")}
  onSignUpPress={() => router.push("/signup")}
/>
``````

| Prop | Type | Behavior |
| --- | --- | --- |
| `fields` | `LoginFieldConfig[]` | Form fields; `onSubmit` receives their values keyed by `name`. An empty array leaves out the email form, the Sign in button, and the forgot-password link. Method pills stay. |
| `oauthProviders` | `OAuthProviderConfig[]` | Branded Google, GitHub, and Apple pills (`SocialLoginButton` outline). |
| `genericProviders` | `GenericOAuthProviderConfig[]` | Providers without a brand, such as a generic OIDC provider: `{id, label, onPress, loading?, disabled?, iconName?}`. Each renders an outline pill "Continue with {label}" after the branded ones. |
| `lastUsedMethod` | `string` | The method this device signed in with last. It gets a "Last used" pill. A provider moves to the front of the provider list; `"passkey"` leads the method stack; `"email"` pills the email label. Methods always sit above the email form. A method the screen does not offer is ignored. |
| `lastUsedLabel` | `string` | Pill text. Defaults to "Last used". |
| `currentSessions` | `LoginAccountOption[]` | Sessions already signed in on this device. Each renders a continue row; one tap calls `onContinue(account, "session")`. A session reads "Signed in · {email}". |
| `rememberedAccounts` | `LoginAccountOption[]` | Accounts remembered on this device. Each renders a continue row (`onContinue(account, "remembered")`). With `onForget`, Edit reveals Remove. Sessions cannot be removed here. |
| `onContinue` / `onForget` | callbacks | Rows render only when `onContinue` is set. Remove (`{testID}-forget-{index}`) renders only in Edit mode. |
| `passwordError` | `string` | Wrong email or password, shown under the password field. A banner `error` is for everything else. |
| `continuingAccount` / `onCancelContinue` | `LoginAccountOption` / `() => void` | Replaces the body with the password step for a remembered email account. Back and "Not you?" call `onCancelContinue`. |
| `initialMethodsExpanded` | `boolean` | Returning users start with other methods behind "Sign in another way". Set this to open them. |
| `onPasskeyPress` | `() => void \| Promise<void>` | Shows a "Sign in with a passkey" button (text via `passkeyButtonText`). |
| `passkeyAutofill` | `boolean` | On web, sets the email field's `autocomplete` to `username webauthn` so browsers offer saved passkeys (conditional mediation). Ignored on native. |
| `notice` | `LoginNotice` | `{tone: "info" \| "warning" \| "error", title?, text, actionLabel?, onAction?, focusMethod?}`, one banner under the heading. Warning and error are `role="alert"`. Info is `role="status"` and can be dismissed. `notice` wins over `error`. |
| `initialValues` | `Record<string, string>` | Values the form starts with, keyed by field `name`. Passing a new object later replaces those fields and keeps what the user typed in the others, so a "Continue" card can prefill the email. |

Accessibility: the control a "Last used" pill marks gets the pill in its accessible name
("Continue with GitHub, last used"; for email, the email field and the Sign in button). A
`warning` or `error` notice has `role="alert"` and an `info` notice `role="status"`. A session
row reads "Signed in · {email}". A remembered row reads "{Provider} · {masked email}".

Keyboard and autofill: the fields sit in a `FormContainer` (`{testID}-form`), so on web they are
in a real `<form>` that password managers recognize. The email field defaults to
`autoComplete="username"` (or `"username webauthn"` with `passkeyAutofill` on web) and password
fields to `"current-password"`; each input's accessible name is its field `label`. Enter in a
field moves focus to the next field (`returnKeyType="next"`); Enter in the last field
(`returnKeyType="go"`) submits once when Sign in is enabled, and does nothing while `loading` or
while a required field is empty. Enter and the Sign in button both submit through the form's
`requestSubmit()`, so browsers see a real submit and offer to save the password. A second submit
while `onSubmit` is pending is ignored. Method pills sit above the form. From the email field,
Tab reaches forgot password, the password field, its show/hide button, Sign in, then sign up.

`LoginAccountOption` is `{id, name?, email?, image?, method}`. Name, email, and image are
optional because apps remember only the method by default; a row without them reads
"Continue with {method}". Show identity only when the app opted in to remembering it. A remembered
email is masked (`j***@n***.io`).

The submit button reads "Sign in", and "Signing in" while `loading`. The footer is "New here?"
plus `signUpLinkText` (default "Create an account"). With accounts on the device, the title
defaults to "Welcome back"; otherwise "Sign in". One divider, "or sign in another way", appears
when a returning user expands methods. One divider, "or use your email", appears only when both
methods and the email form are on screen.

**Test IDs** (with the default `testID="login-screen"`):

| Element | testID |
| --- | --- |
| Branded or generic provider button | `login-screen-oauth-{provider}` (e.g. `login-screen-oauth-github`, `login-screen-oauth-mock-oidc`) |
| Last-used badge on a method | `login-screen-last-used-{method}` |
| Last-used badge on a continue row | `login-screen-last-used-account-{index}` |
| Continue row (sessions first, then remembered accounts) | `login-screen-continue-{index}` |
| Remove, only while Edit is open | `login-screen-forget-{index}` (same index as its row) |
| Edit / Done | `login-screen-accounts-edit` |
| Sign in another way | `login-screen-another-way` |
| Passkey button | `login-screen-passkey-button` |
| Notice / its action / dismiss | `login-screen-notice` / `login-screen-notice-action` / `login-screen-notice-dismiss` |
| Banner from the `error` prop | `login-screen-error` |
| Wrong password, under the password field | `login-screen-password-input.error` |
| Password step back / Not you? | `login-screen-continue-back` / `login-screen-continue-not-you` |
| Continue-as card list | `login-screen-accounts` |

`OAuthButtons`, which `LoginScreen` and `SignUpScreen` use, takes the same `genericProviders`, a
`lastUsed={{provider, label?, testID?}}` pill, and `dividerPosition` (`"above"` by default,
`"below"` when the buttons sit above a form, `"none"` for no divider). `appearance` is `"brand"`
(filled buttons, the sign-up default) or `"pill"` (neutral outline, what `LoginScreen` uses).

### OtpField

One-time code input with one cell per digit. Typing fills the cells left to right, pasting or
autofilling a whole code into any cell fills every cell, and backspace in an empty cell deletes
the previous digit and moves back. `onComplete(code)` fires when every cell holds a digit.
Non-digits are dropped, so a pasted `123 456` or `123-456` works.

``````typescript
import {OtpField} from "@terreno/ui";

<OtpField
  autoFocus
  length={6}                       // default 6
  value={code}                     // optional; omit to let the field keep its own state
  onChange={setCode}
  onComplete={(code) => verifyTotp({code})}
  errorText={error}
  testID="verify-otp"
/>
``````

Each cell is its own input. Every cell carries the one-time-code autofill hint
(`autocomplete="one-time-code"` on web, `textContentType="oneTimeCode"` on iOS, `"sms-otp"` on
Android) and a numeric keyboard, and a full-length code that lands in any cell fills the whole
field, so platform code suggestions work whichever cell has focus. A full code pasted into a
filled cell drops that cell's old digit. Tapping a cell past the first empty one moves focus back
to that empty cell. Only the cell that takes the next digit is a tab stop (roving `tabIndex`), so
Tab and Shift+Tab move past the field in one step.

`onEnter(code)` is called with the digits entered so far when the user presses Enter in a cell
(the cells' `enterKeyHint` is `"done"`).

Accessibility: the cells sit in a `role="group"` named by `accessibilityLabel` (default
"Verification code"); each cell is labelled "Digit k of N". With `errorText`, cells get
`aria-invalid`.

**Test IDs:** the group is `{testID}`; cells are `{testID}-cell-{k}` with `k` from 1 to
`length`; error, title, and helper are `{testID}-error`, `{testID}-title`, `{testID}-helper`.

### TwoFactorChallengeScreen

Presentational second sign-in step for two-factor authentication. TOTP mode shows an `OtpField`
and submits on its own once the code is complete; a toggle switches to a backup-code text field
(backup codes contain letters). It reports `onSubmit({code, kind, trustDevice})` and never calls
an auth client itself.

``````typescript
import {TwoFactorChallengeScreen} from "@terreno/ui";

// The Better Auth client resolves {data, error} rather than throwing; show its error through the
// `error` prop (a rejected onSubmit only clears the code).
const [error, setError] = useState<string | undefined>(undefined);

<TwoFactorChallengeScreen
  error={error}                    // e.g. "That code didn't work"; a new error clears the code
  loading={isVerifying}
  onCancel={() => router.replace("/login")}
  onSubmit={async ({code, kind, trustDevice}) => {
    setError(undefined);
    const result =
      kind === "totp"
        ? await authClient.twoFactor.verifyTotp({code, trustDevice})
        : await authClient.twoFactor.verifyBackupCode({code, trustDevice});
    if (result.error) {
      setError(result.error.message ?? "That code didn't work.");
    }
  }}
  trustDeviceDays={30}
/>
``````

| Prop | Type | Behavior |
| --- | --- | --- |
| `onSubmit` | `(values: TwoFactorChallengeSubmission) => void \| Promise<void>` | Receives `{code, kind: "totp" \| "backup", trustDevice}`. Backup codes are trimmed. Not called while `loading` or while an earlier call is still pending. A rejection is caught, logged with `console.warn`, and clears the code. |
| `error` | `string` | Shown under the cells for an authenticator code (`role="alert"`) and under the field for a backup code. The screen shows this string as passed, including a rate limit or an expired session. The entered code clears (and the first cell refocuses) when a new error arrives, and when a submission finishes (`loading` goes from true to false, or `onSubmit` settles) with an error set, so the same error twice still clears it. |
| `loading` | `boolean` | Disables every control and shows a spinner on Verify. |
| `trustDeviceDays` | `number` | Shows a "Trust this device" checkbox, checked by default for an authenticator code, with helper text "We won't ask for a code here for N days." Unset hides it and `trustDevice` is always `false`. |
| `onCancel` / `cancelText` | `() => void` / `string` | Shows a Back link and a footer link (default "Sign in a different way"). |
| `codeLength` | `number` | Digits in a TOTP code. Defaults to 6. |
| `initialKind` | `"totp" \| "backup"` | The mode the screen opens in. Defaults to `"totp"`. The title follows the mode: "Enter your code" or "Use a backup code". |
| `initialTrustDevice` | `boolean` | Whether "Trust this device" starts checked. Defaults to checked for an authenticator code and unchecked for a backup code. Pass `false` to start unchecked. |
| `autoFocus` | `boolean` | Focuses the first code cell on mount. Defaults to `true`. Set `false` where the screen is a preview rather than the page's task, since the focus scrolls the page to the cells; a rejected code still refocuses the first cell. |
| `title` / `accountLabel` / `logo` | `string` / `string` / `ReactNode` | Heading override, the account the code is for (an email is masked), and an optional logo. |

Enter in a code cell submits a complete code (the same guard as Verify applies); Enter in the
backup-code field submits it.

Accessibility: the trust-device control is a `role="checkbox"` with `aria-checked` and its full
sentence as the accessible name, and toggles with Space or Enter on web; the error is
`role="alert"`; the code cells are labelled "Digit k of N"; the backup input is named "Backup
code".

**Test IDs** (with the default `testID="two-factor-challenge"`):

| Element | testID |
| --- | --- |
| Screen root | `two-factor-challenge` |
| TOTP cells | `two-factor-challenge-otp-cell-{k}` (1-based) |
| Backup code input | `two-factor-challenge-backup-input` |
| TOTP / backup toggle | `two-factor-challenge-backup-toggle` |
| Trust-device checkbox | `two-factor-challenge-trust-device` |
| Error | `two-factor-challenge-error` |
| Verify button | `two-factor-challenge-submit` |
| Use another method | `two-factor-challenge-cancel` |
| Back | `two-factor-challenge-back` |

### SignUpScreen

Complete signup screen with email/password and optional social providers.

``````typescript
import {SignUpScreen} from "@terreno/ui";
import {authClient} from "@/store/authClient";

// The Better Auth client resolves {data, error} rather than throwing, and SignUpScreen does not
// catch a rejected onSubmit, so put the error in state and pass it as `error`.
const [error, setError] = useState<string | undefined>(undefined);

const signUpWithGoogle = async (): Promise<void> => {
  setError(undefined);
  const {error: socialError} = await authClient.signIn.social({
    provider: "google",
    callbackURL: "yourapp://auth",
  });
  if (socialError) {
    setError(socialError.message ?? "Couldn't sign up with Google.");
  }
};

<SignUpScreen
  error={error}
  fields={[
    {name: "name", label: "Name", required: true},
    {name: "email", label: "Email", type: "email", required: true},
    {name: "password", label: "Password", type: "password", required: true},
  ]}
  onSubmit={async ({name = "", email = "", password = ""}) => {
    setError(undefined);
    const {error: signUpError} = await authClient.signUp.email({email, password, name});
    if (signUpError) {
      setError(signUpError.message ?? "Couldn't create your account.");
    }
  }}
  oauthProviders={[{provider: "google", onPress: signUpWithGoogle}]}
  onLoginPress={() => router.push("/login")}
/>
``````

Keyboard and autofill: the fields sit in a `FormContainer` (`{testID}-form`). The email field
defaults to `autoComplete="username"` and password fields to `"new-password"`, so password
managers offer a strong password and save it with the email; each input's accessible name is its
field `label`. Enter moves to the next field and submits from the last one once Sign Up is
enabled (required fields filled, password requirements met), through the form's
`requestSubmit()`. A second submit while `onSubmit` is pending is ignored.

**Learn more:** [Configure Better Auth](../how-to/configure-better-auth.md)

## Account security

Presentational cards for an account security screen, and `AccountSecurityScreen`, which
composes them (see [AccountSecurityScreen](#accountsecurityscreen)). Each card takes plain data
and reports actions through callbacks; none of them calls an auth client. Each card's title
is a level 2 heading and `AccountSecurityScreen`'s title is level 1, through `Heading`'s `level`
prop: with `level` set, `Heading` renders `role="heading"` and `aria-level` (an `<h1>`–`<h6>`
on web, the header accessibility role on native); without it, `Heading` stays plain text. The data types are built from
Better Auth's responses, but they are not a one-to-one copy: `listAccounts()` returns `id`,
`providerId`, `accountId` and `createdAt` per account and no email, so a connected screen renames
`createdAt` to `linkedAt` and fills `email` from elsewhere (the session user, or a per-account
info call) when it wants one shown. Dates may be `Date` objects (the Better Auth client parses
them) or ISO 8601 strings; Luxon formats both.

**Callbacks must throw to show an error.** Each card catches a rejected callback and shows its
message as a `role="alert"` card error. The Better Auth client does not reject on failure: its
calls resolve `{data, error}`. Unwrap every call, as the examples below do:

``````typescript
const {error} = await authClient.unlinkAccount({accountId: account.id});
if (error) {
  throw new Error(error.message ?? "Couldn't unlink that account.");
}
``````

Shared types (exported from the package root):

| Type | Shape |
| --- | --- |
| `LinkedAccount` | `{id, providerId, accountId?, email?, linkedAt?}`. `id` is Better Auth's own account row id, the value `unlinkAccount({accountId})` takes; `accountId` is the id at the provider (display only). A password is an account with `providerId: "credential"` (`CREDENTIAL_PROVIDER_ID`). `linkedAt` (`string \| Date`) is Better Auth's `createdAt`. |
| `LinkableProvider` | `{id, label?, iconName?}`. Branded ids (`google`, `github`, `apple`) get their brand name and icon; other ids show `label` (or the id) with a key icon. |
| `AccountPasskey` | `{id, name?, authenticatorName?, createdAt?, lastUsedAt?, backedUp?}`. A subset of `@better-auth/passkey`'s `Passkey`, so `authClient.passkey.listUserPasskeys()` items pass as is. `authenticatorName` labels an unnamed passkey; a connected screen can fill it with `getAuthenticatorName(aaguid)` from `@better-auth/passkey` (ui does not depend on it). Better Auth stores no last-used time; pass `lastUsedAt` only when the app records one. |
| `AccountSession` | `{id, token?, userAgent?, ipAddress?, location?, createdAt?, updatedAt?, expiresAt?}`. A subset of Better Auth's session, so `listSessions()` items pass as is. `location` is for a place name the app looks up; Better Auth has none. `updatedAt` moves only once per `session.updateAge` (a day by default), so the card labels it "Last refreshed", not "Last active". |
| `TwoFactorEnrollment` | `{totpURI, backupCodes}`: the TOTP branch of Better Auth's `twoFactor.enable()` data. `enable()` resolves `{method: "otp"}` \| `{method: "totp", totpURI, backupCodes}`, so `onStartEnroll` narrows it with `"totpURI" in data` (see the example below). |

`hasPasswordCredential(accounts)` returns whether the user has a password.
`parseUserAgent(userAgent)` returns `{browser?, os?, deviceType}` (`deviceType` is `desktop`,
`mobile`, `tablet` or `unknown`) for common browsers and for the HTTP clients React Native apps
send (`CFNetwork`/`Darwin` reads as "App" on iOS, `okhttp` as "App" on Android). Two limits
of user agent sniffing: iPadOS Safari asks for desktop sites by default and reports itself as
`Macintosh`, so it reads as Safari on macOS; and a macOS native app also sends
`CFNetwork`/`Darwin`, so it reads as an iOS app.
`describeUserAgent(userAgent)` turns that into "Chrome on macOS", whichever part is known, or
"Unknown device". Neither adds a dependency.

### LinkedAccountsCard

Lists every linked account (with its email, when given, and linked date) under the providers
the app offers, with a Link row for each offered provider that has no account. Each linked
account is its own row, so two Google accounts are each unlinkable. A linked account whose
provider the app no longer offers still shows as a linked row. The password account is not a row (see PasswordCard), but it counts as a
sign-in method.

``````typescript
import {LinkedAccountsCard} from "@terreno/ui";

<LinkedAccountsCard
  accounts={accounts}                      // every account, including "credential"
  providers={[{id: "google"}, {id: "github"}, {id: "mock-oidc", label: "Company SSO"}]}
  otherMethodCount={passkeys.length}       // passkeys count as sign-in methods
  onLink={async (providerId) => {
    const {error} = await authClient.linkSocial({provider: providerId, callbackURL});
    if (error) {
      throw new Error(error.message ?? "Couldn't link that account.");
    }
  }}
  onUnlink={async (_providerId, account) => {
    const {error} = await authClient.unlinkAccount({accountId: account.id});
    if (error) {
      throw new Error(error.message ?? "Couldn't unlink that account.");
    }
  }}
/>
``````

| Prop | Type | Behavior |
| --- | --- | --- |
| `accounts` | `LinkedAccount[]` | Every linked account, including the `credential` password account. |
| `providers` | `LinkableProvider[]` | Row order. A provider gets one row per linked account, or one Link row when it has none. |
| `onLink` | `(providerId) => void \| Promise<void>` | Link button on unlinked rows. The row shows a spinner and every row is disabled until the promise settles. A rejection's message shows as the card error. |
| `onUnlink` | `(providerId, account) => void \| Promise<void>` | Unlink button on linked rows. Pressing it opens a confirm `Modal`; the callback runs only after the user confirms, with that row's account. Pass `account.id` to `unlinkAccount({accountId})`. Same spinner and error handling as `onLink`. |
| `otherMethodCount` | `number` | Sign-in methods that are not accounts, such as passkeys. Defaults to 0. Pass 0 unless the server sets `allowUnlinkingAll` (see below). |
| `canUnlinkLast` | `boolean` | Allows unlinking the last sign-in method. Defaults to `false`. |
| `error` | `string` | Card error with `role="alert"`; overrides a rejection message. |
| `disabled` | `boolean` | Disables every row, for example while accounts load. |
| `title` / `description` | `string` | Heading (default "Linked accounts") and the text under it. |

**Last sign-in method.** The card counts `accounts.length + otherMethodCount`. When that is 1
and `canUnlinkLast` is false, the only linked provider's Unlink is disabled and a sentence under
the row explains why (`{testID}-last-method-{id}`). Passing the `credential` account is what
lets a user with a password unlink their only provider. Better Auth enforces its own version of
the rule: `unlinkAccount` refuses a user's last account (passkeys do not count) unless
`account.accountLinking.allowUnlinkingAll` is set. So only pass the passkey count as
`otherMethodCount` when the server allows unlinking every account; otherwise pass 0 and the card
matches the server.

Accessibility: Link and Unlink are named after their provider and, when known, the account's
email ("Link GitHub", "Unlink Google (ada@example.com)"); a disabled Unlink has a visible
explanation; errors are `role="alert"`.

**Test IDs** (with the default `testID="linked-accounts-card"`). `{id}` is the provider id for an
unlinked row and for a provider's first linked account; a provider's later accounts add `-2`,
`-3`, and so on (`linked-accounts-card-unlink-google-2`), in `accounts` order:

| Element | testID |
| --- | --- |
| Card root | `linked-accounts-card` |
| Row / name / status | `linked-accounts-card-row-{id}`, `-name-{id}`, `-status-{id}` |
| Link / Unlink buttons | `linked-accounts-card-link-{id}`, `linked-accounts-card-unlink-{id}` |
| Last-method explanation | `linked-accounts-card-last-method-{id}` |
| Confirm modal, confirm, cancel | `linked-accounts-card-confirm`, `-confirm-submit`, `-confirm-cancel` |
| Error | `linked-accounts-card-error` |

### PasswordCard

Shows "Change password" (current, new and confirm, plus an optional "Sign out of other devices"
checkbox) when the user has a password, and "Set a password" (new and confirm) for a user who
only signs in with a provider. It checks the minimum length and the confirmation inline before
calling `onSubmit`.

``````typescript
import {hasPasswordCredential, PasswordCard} from "@terreno/ui";

<PasswordCard
  hasPassword={hasPasswordCredential(accounts)}
  onSubmit={async ({mode, currentPassword, newPassword, revokeOtherSessions}) => {
    if (mode === "change") {
      const {error} = await authClient.changePassword({
        currentPassword: currentPassword ?? "",
        newPassword,
        revokeOtherSessions,
      });
      if (error) {
        throw new Error(error.message ?? "Couldn't change your password.");
      }
    } else {
      await setPassword({newPassword});      // Better Auth's setPassword is server-only
    }
  }}
/>
``````

| Prop | Type | Behavior |
| --- | --- | --- |
| `hasPassword` | `boolean` | `true` shows change mode; `false` shows set mode. When it flips (after a first password is set), the form clears. |
| `onSubmit` | `(values: PasswordCardSubmission) => Promise<void>` | Receives `{mode, currentPassword?, newPassword, revokeOtherSessions}`. `currentPassword` is present only in change mode; `revokeOtherSessions` is always `false` in set mode. Resolving clears the form and shows a success message (`role="status"`). Rejecting keeps the form and shows the error's message (`role="alert"`). |
| `showRevokeOtherSessions` | `boolean` | Shows the sign-out checkbox in change mode. Defaults to `true`. |
| `minLength` | `number` | Minimum new-password length. Defaults to 8, Better Auth's default. |
| `error` | `string` | Error with `role="alert"`; overrides a rejection message. |
| `loading` | `boolean` | Disables the form and shows a spinner on the submit button. |
| `username` | `string` | The signed-in user's email or username. On web it goes in a hidden `autocomplete="username"` field of the card's form, so password managers update that account's saved password. `useAccountSecurity` passes the session user's email. |

Inline errors: "Enter your current password.", "Use at least N characters.", and "Passwords
don't match." show under their field after a submit attempt and clear when that field changes.
A failed attempt also focuses the first invalid field and shows a `role="alert"` summary ("Fix the
2 highlighted fields.", `{testID}-validation-error`) that updates as fields are fixed. Enter in
the current or new password field moves to the next field; Enter in the confirm field submits
through the card's `FormContainer` (`{testID}-form`), like the submit button. A second submit
while `onSubmit` is pending is ignored.

Accessibility: inputs are named "Current password", "New password" and "Confirm new password";
on web they carry `autocomplete="current-password"` / `"new-password"` so password managers fill
and save correctly; the sign-out control is a `role="checkbox"` that toggles with Space or Enter.

**Test IDs** (with the default `testID="password-card"`):

| Element | testID |
| --- | --- |
| Card root / heading | `password-card`, `password-card-title` |
| Current / new / confirm inputs | `password-card-current`, `password-card-new`, `password-card-confirm` |
| Sign-out checkbox | `password-card-revoke-other-sessions` |
| Submit | `password-card-submit` |
| Validation summary | `password-card-validation-error` |
| Error / success | `password-card-error`, `password-card-success` |

### PasskeysCard

Lists the user's passkeys, each with its name (else `authenticatorName`, else "Unnamed passkey"), the date it
was added, the date it was last used (when given), and a "Synced" badge when `backedUp` is true.
Add, Rename and Remove each open a dialog. A device that can't create passkeys gets an
explanation instead of the Add button.

``````typescript
import {PasskeysCard} from "@terreno/ui";

<PasskeysCard
  passkeys={passkeys}                      // authClient.passkey.listUserPasskeys() data
  supported={typeof window !== "undefined" && "PublicKeyCredential" in window}
  onAdd={async (name) => {
    const {error} = await authClient.passkey.addPasskey({name});
    if (error) {
      throw new Error(error.message ?? "Couldn't add a passkey.");
    }
  }}
  onRename={async (id, name) => {
    const {error} = await authClient.passkey.updatePasskey({id, name});
    if (error) {
      throw new Error(error.message ?? "Couldn't rename that passkey.");
    }
  }}
  onRemove={async (passkey) => {
    const {error} = await authClient.passkey.deletePasskey({id: passkey.id});
    if (error) {
      throw new Error(error.message ?? "Couldn't remove that passkey.");
    }
  }}
/>
``````

| Prop | Type | Behavior |
| --- | --- | --- |
| `passkeys` | `AccountPasskey[]` | One row per passkey, keyed by `id`. An empty list shows "You haven't added a passkey yet." |
| `onAdd` | `(name?) => void \| Promise<void>` | Add opens a dialog with an optional name field; Continue calls `onAdd` with the trimmed name, or `undefined` when blank. The Add button shows a spinner and every row is disabled until the promise settles. A rejection (for example, the user cancelling the browser prompt) shows its message as the card error. |
| `onRename` | `(id, name) => void \| Promise<void>` | Rename opens a dialog with the current name; Save is disabled while the name is blank or unchanged and calls `onRename` with the trimmed name. Same pending and error handling. |
| `onRemove` | `(passkey) => void \| Promise<void>` | Remove opens a confirm `Modal`; the callback runs only after the user confirms. The row's Remove shows a spinner. |
| `supported` | `boolean` | `false` hides Add and explains that this device or browser can't create passkeys. Existing passkeys can still be renamed and removed. Defaults to `true`. |
| `error` | `string` | Card error with `role="alert"`; overrides a rejection message. |
| `disabled` | `boolean` | Disables every button, for example while passkeys load. |
| `title` / `description` | `string` | Heading (default "Passkeys") and the text under it. |

A button whose callback is not passed is not rendered.

Accessibility: Rename and Remove are named after their passkey ("Rename passkey Work laptop",
"Remove passkey Work laptop"); dialog inputs are named "Passkey name"; errors are `role="alert"`.

**Test IDs** (with the default `testID="passkeys-card"`; `{id}` is the passkey id):

| Element | testID |
| --- | --- |
| Card root / heading | `passkeys-card`, `passkeys-card-title` |
| Row / name / dates / synced badge | `passkeys-card-row-{id}`, `-name-{id}`, `-status-{id}`, `-synced-{id}` |
| Rename / Remove buttons | `passkeys-card-rename-{id}`, `passkeys-card-remove-{id}` |
| Add button | `passkeys-card-add` |
| Empty state / unsupported explanation | `passkeys-card-empty`, `passkeys-card-unsupported` |
| Add dialog, name input, Continue, Cancel | `passkeys-card-add-dialog`, `-add-dialog-name`, `-add-dialog-submit`, `-add-dialog-cancel` |
| Rename dialog, name input, Save, Cancel | `passkeys-card-rename-dialog`, `-rename-dialog-name`, `-rename-dialog-submit`, `-rename-dialog-cancel` |
| Remove confirm, confirm, cancel | `passkeys-card-confirm`, `-confirm-submit`, `-confirm-cancel` |
| Error | `passkeys-card-error` |

### SessionsCard

Lists the user's signed-in sessions. Each row shows the browser and OS parsed from the session's
user agent ("Safari on iOS") with a desktop, phone or tablet icon, the location and IP address
when known, "Signed in 3 days ago" from `createdAt`, and "Last refreshed 2 hours ago" from
`updatedAt` (Luxon `toRelative`; anything under a minute old or in the future reads "just now").
Better Auth refreshes `updatedAt` only once per `session.updateAge` (a day by default), so it is
not shown as a live "last active" time. The current session is listed first, marked "This
device", reads "Active now", and has no Sign out button: sign the current device out with the
app's own sign-out action. The rest follow, most recently refreshed first. Without `now`, the card
recomputes relative times every minute.

``````typescript
import {SessionsCard} from "@terreno/ui";

<SessionsCard
  sessions={sessions}                      // authClient.listSessions() data
  currentSessionId={session.data?.session.id}
  onRevoke={async (revoked) => {
    if (!revoked.token) {
      throw new Error("This session can't be signed out.");
    }
    const {error} = await authClient.revokeSession({token: revoked.token});
    if (error) {
      throw new Error(error.message ?? "Couldn't sign out that session.");
    }
  }}
  onRevokeOthers={async () => {
    const {error} = await authClient.revokeOtherSessions();
    if (error) {
      throw new Error(error.message ?? "Couldn't sign out your other sessions.");
    }
  }}
/>
``````

| Prop | Type | Behavior |
| --- | --- | --- |
| `sessions` | `AccountSession[]` | One row per session, keyed by `id`. |
| `currentSessionId` / `currentSessionToken` | `string` | Identify the current session by `id` or by `token`; either match marks the row. |
| `onRevoke` | `(session) => void \| Promise<void>` | Sign out on every non-current row. No confirm. The row shows a spinner and every other button is disabled until the promise settles; a rejection's message shows as the card error. |
| `onRevokeOthers` | `() => void \| Promise<void>` | "Sign out everywhere else" opens a confirm `Modal` that names how many sessions it ends; the callback runs after the user confirms. Disabled, with "You're not signed in anywhere else.", when no other session exists. |
| `now` | `Date` | The time relative times are measured from. When omitted, the card uses the current time and recomputes it every 60 seconds (the interval is cleared on unmount or when `now` is passed); pass it in tests and screenshots. |
| `error` | `string` | Card error with `role="alert"`; overrides a rejection message. |
| `disabled` | `boolean` | Disables every button, for example while sessions load. |
| `title` / `description` | `string` | Heading (default "Where you're signed in") and the text under it. |

Accessibility: each Sign out button names its session and when it signed in ("Sign out Safari
on iOS, signed in 3 days ago"), so two sessions on the same browser stay distinguishable; "This device" is visible text; errors are `role="alert"`.

**Test IDs** (with the default `testID="sessions-card"`; `{id}` is the session id):

| Element | testID |
| --- | --- |
| Card root / heading | `sessions-card`, `sessions-card-title` |
| Row / device name / location and IP | `sessions-card-row-{id}`, `-name-{id}`, `-details-{id}` |
| "Signed in" / "Active now" or "Last refreshed" | `sessions-card-signed-in-{id}`, `sessions-card-activity-{id}` |
| "This device" badge | `sessions-card-current-{id}` |
| Sign out (one session) | `sessions-card-revoke-{id}` |
| Sign out everywhere else | `sessions-card-revoke-others` |
| Confirm, confirm, cancel | `sessions-card-confirm`, `-confirm-submit`, `-confirm-cancel` |
| No other sessions / empty | `sessions-card-no-others`, `sessions-card-empty` |
| Error | `sessions-card-error` |

### TwoFactorSettingsCard

Turns two-factor authentication with an authenticator app (TOTP) on and off and manages backup
codes. While off, the card shows "Status: Off" and **Turn on**, which walks through four steps
("Step 1 of 4"):

1. **Password.** Better Auth asks for it before `twoFactor.enable`.
2. **Scan.** A QR code of `totpURI` (`react-native-qrcode-svg`, drawn black on white so it scans
   in dark mode), plus the setup key (the URI's `secret`, in groups of four) with **Copy key**
   for users who can't scan. `parseTotpSecret(totpURI)` and `parseTotpDigits(totpURI)` are
   exported for connected screens.
3. **Verify.** An `OtpField` with one cell per digit (the URI's `digits`, else 6). A full code submits itself; **Verify** does the
   same. A rejection clears the code and shows the error. **Back** returns to the QR code.
4. **Backup codes.** The codes from `onStartEnroll`, with **Copy** (one code per line, through
   `expo-clipboard`) and **Download** on web (a `two-factor-backup-codes.txt` file) or **Share**
   on native (the system share sheet). **Finish** stays disabled until the user checks "I saved
   these backup codes". This step has no Cancel: two-factor is already on, and the codes are shown
   only once.

**Cancel** on steps 1–3 returns to the card without verifying. Better Auth keeps an unverified
secret until the next `enable`, which replaces it; `user.twoFactorEnabled` stays false.

While on, the card shows "Status: On", the backup codes left (when `backupCodesRemaining` is given,
with a warning below 3), **Get new backup codes** (password, then the new codes with the same "I
saved these" gate) and **Turn off** (password, then a destructive confirm `Modal`). A flow in
progress keeps showing when `enabled` changes underneath it, so refetching the session in
`onVerify` doesn't hide the backup codes.

**Password and OAuth-only users.** Better Auth's `enable`, `generateBackupCodes`, `getTotpUri` and
`disable` require the user's password unless its two-factor plugin sets `allowPasswordless`.
Terreno's `twoFactor` config does not set it, so by default a user who signed up with a social
provider must set a password first: pass `hasPassword={hasPasswordCredential(accounts)}` and the
card disables **Turn on** (or, when two-factor is already on, **Get new backup codes** and
**Turn off**) and says so. A consumer that adds `twoFactor({allowPasswordless: true})`
through `config.plugins` passes `requirePassword={hasPassword}`: Better Auth still asks users who
have a password for it, and skips it for the rest. Without `requirePassword` the password steps are
skipped and the callbacks get `undefined`.

``````typescript
import {TwoFactorSettingsCard, hasPasswordCredential} from "@terreno/ui";

<TwoFactorSettingsCard
  enabled={Boolean(session.data?.user.twoFactorEnabled)}
  hasPassword={hasPasswordCredential(accounts)}
  onStartEnroll={async (password) => {
    const {data, error} = await authClient.twoFactor.enable({password: password ?? ""});
    // enable() resolves {method: "otp"} for the email/SMS OTP method; only TOTP has a URI.
    if (error || !data || !("totpURI" in data)) {
      throw new Error(error?.message ?? "Couldn't start two-factor setup.");
    }
    return {backupCodes: data.backupCodes, totpURI: data.totpURI};
  }}
  onVerify={async (code) => {
    const {error} = await authClient.twoFactor.verifyTotp({code});
    if (error) {
      throw new Error(error.message ?? "That code didn't work.");
    }
  }}
  onRegenerateBackupCodes={async (password) => {
    const {data, error} = await authClient.twoFactor.generateBackupCodes({password: password ?? ""});
    if (error || !data) {
      throw new Error(error?.message ?? "Couldn't create new backup codes.");
    }
    return data.backupCodes;
  }}
  onDisable={async (password) => {
    const {error} = await authClient.twoFactor.disable({password: password ?? ""});
    if (error) {
      throw new Error(error.message ?? "Couldn't turn off two-factor authentication.");
    }
  }}
/>
``````

| Prop | Type | Behavior |
| --- | --- | --- |
| `enabled` | `boolean` | Better Auth's `user.twoFactorEnabled`. False offers Turn on; true offers new backup codes and Turn off. |
| `backupCodesRemaining` | `number` | Shown as "8 backup codes left" while on; below 3 adds a warning. Better Auth does not put this on the session; pass it when the app knows it. |
| `onStartEnroll` | `(password?) => Promise<TwoFactorEnrollment>` | Called after the password step (or at once without `requirePassword`). Resolve `{totpURI, backupCodes}`, narrowed from `enable()`'s TOTP branch; a rejection stays on the password step with the error. |
| `onVerify` | `(code) => Promise<void>` | Called with the full code. Resolve to move to the backup codes; reject to clear the code and show the error. |
| `onRegenerateBackupCodes` | `(password?) => Promise<string[]>` | Called after the password step. Resolve the new codes to show them; hidden when not passed. |
| `onDisable` | `(password?) => Promise<void>` | Called after the password step and the confirm. Hidden when not passed. |
| `requirePassword` | `boolean` | Ask for the password before each action. Defaults to `true`; see above. |
| `hasPassword` | `boolean` | With `requirePassword`, `false` disables Turn on, Get new backup codes and Turn off, and asks the user to set a password first. Defaults to `true`. |
| `digits` | `number` | Cells in the code field: Better Auth's `totpOptions.digits`. Defaults to the `digits` parameter of the enrollment's `totpURI`, else 6. |
| `error` | `string` | Card error with `role="alert"`; overrides a rejection message. |
| `disabled` | `boolean` | Disables Turn on, Get new backup codes, Turn off and the password step, for example while the user loads. |
| `title` / `description` | `string` | Heading (default "Two-factor authentication") and the text under it. |
| `username` | `string` | The signed-in user's email or username. On web the password step's form gets a hidden `autocomplete="username"` field, so password managers fill that account's password. `useAccountSecurity` passes the session user's email. |

The card never logs the codes or the URI; a rejection is logged with `console.warn` as the
callback threw it, so don't put secrets in error messages.

Accessibility:

- Each step replaces the content that had focus, so the card moves focus when the step changes.
  On web, focus goes to the step's heading (a `tabIndex={-1}` view holding "Step N of M" and the
  step's lead text), or to the field on the password and code steps. On native, where a view
  can't take focus, the card calls `AccessibilityInfo.announceForAccessibility` with the step
  ("Step 2 of 4. Scan this QR code…"), and announces the outcome when it returns to the card
  ("Two-factor authentication is on.", "Two-factor authentication is off."). Nothing moves on
  first render.
- The QR code is an image named "QR code for your authenticator app".
- Copy results ("Copied", "Couldn't copy") are in a polite live region (`aria-live` on web,
  `accessibilityLiveRegion` on Android); iOS VoiceOver ignores live regions, so the card also
  announces them there.
- "I saved these backup codes" is a `role="checkbox"` control that Space toggles; the backup codes
  are a list; errors are `role="alert"`.
- The password is dropped from the card's state as soon as `onStartEnroll` or
  `onRegenerateBackupCodes` resolves; the Turn off flow keeps it until the confirm.

**Test IDs** (with the default `testID="two-factor-settings-card"`):

| Element | testID |
| --- | --- |
| Card root / heading / status ("On" / "Off") | `two-factor-settings-card`, `-title`, `-status` |
| Turn on / Get new backup codes / Turn off | `two-factor-settings-card-enable`, `-regenerate`, `-disable` |
| Backup codes left / low warning / set-a-password note | `two-factor-settings-card-backup-codes-remaining`, `-backup-codes-low`, `-needs-password` |
| Step heading (focus target) / step indicator / Cancel | `two-factor-settings-card-step-heading`, `-step`, `-cancel` |
| Password prompt, field, submit | `two-factor-settings-card-password-prompt`, `-password`, `-password-submit` |
| Password step form (web `<form>`) | `two-factor-settings-card-password-form` |
| QR code / setup key / Copy key / Next | `two-factor-settings-card-qr`, `-secret`, `-copy-secret`, `-next` |
| Code field (cells `-otp-cell-1`…) / Verify / Back | `two-factor-settings-card-otp`, `-verify`, `-back` |
| Codes heading / list / code N (from 1) | `two-factor-settings-card-codes-title`, `-backup-codes`, `-backup-code-{n}` |
| Copy / Download or Share / copy status | `two-factor-settings-card-copy-codes`, `-download-codes`, `-copy-codes-status` (`-copy-secret-status` for the key) |
| "I saved these" / Finish | `two-factor-settings-card-saved`, `-finish` |
| Turn-off confirm, confirm, cancel | `two-factor-settings-card-confirm`, `-confirm-submit`, `-confirm-cancel` |
| Error | `two-factor-settings-card-error` |

### AccountSecurityScreen

The account security cards composed into one screen. Each card's props go in as one object, and
a card renders only when its object is given, so a feature the server has off simply leaves its
prop out. The order is fixed:

1. **Sign-in methods:** `LinkedAccountsCard`, then `PasswordCard`, grouped in
   `{testID}-sign-in-methods` when either is given.
2. `PasskeysCard`.
3. `TwoFactorSettingsCard`.
4. `SessionsCard`.

Above the cards is a heading (`title`, default "Security"), an optional `description`, and an
optional `header` node (for example, "Signed in as ada@example.com"). `children` render after the
cards, for an app-specific card. The cards stack in one column at every width, and the content
stops growing at `maxWidth` (720px by default) and centers on wide screens. At 768px wide and
below, `Card` draws edge to edge, so the screen drops its own side padding there and insets the
heading, `header` and empty text to line up with the cards' content.

By default the screen wraps itself in a scrolling ui `Page` (the same `Page` LoginScreen uses),
so it works as a route on its own on native and web. Inside your own `Page`, `ScrollView` or tab
layout, pass `withPage={false}`: the screen then renders only its content and leaves scrolling to
the parent, so scroll views don't nest.

``````typescript
import {AccountSecurityScreen, hasPasswordCredential} from "@terreno/ui";

// Two-factor is off on this server, so `twoFactor` is left out and its card is hidden.
<AccountSecurityScreen
  isLoading={isLoading}
  error={loadError}
  onRetry={reload}
  linkedAccounts={{accounts, providers, onLink, onUnlink}}
  password={{hasPassword: hasPasswordCredential(accounts), onSubmit: onPasswordSubmit}}
  passkeys={{passkeys, onAdd, onRename, onRemove}}
  sessions={{sessions, currentSessionId, onRevoke, onRevokeOthers}}
/>
``````

| Prop | Type | Behavior |
| --- | --- | --- |
| `linkedAccounts` | `LinkedAccountsCardProps` | Props for `LinkedAccountsCard`. Omit to hide it. |
| `password` | `PasswordCardProps` | Props for `PasswordCard`. Omit to hide it. |
| `passkeys` | `PasskeysCardProps` | Props for `PasskeysCard`. Omit to hide it, for example when the server has no passkey plugin. |
| `twoFactor` | `TwoFactorSettingsCardProps` | Props for `TwoFactorSettingsCard`. Omit to hide it. |
| `sessions` | `SessionsCardProps` | Props for `SessionsCard`. Omit to hide it. |
| `title` / `description` | `string` | Heading (default "Security") and the text under it. |
| `header` | `ReactNode` | Content under the heading and above the cards. Shown in every state. |
| `children` | `ReactNode` | Content after the cards. Hidden with the cards while loading or in the error state. |
| `isLoading` | `boolean` | Shows a spinner and "Loading your security settings…" instead of the cards. Takes precedence over `error`, so a retry in flight shows as loading. |
| `error` | `string` | A page-level error, such as the data failing to load, shown in a `role="alert"` card instead of the cards. A card action's error belongs in that card's own `error` prop (or a rejected callback), not here. |
| `onRetry` | `() => void` | The error card's **Try again** button. Hidden when not passed. |
| `withPage` | `boolean` | Wrap the screen in a scrolling `Page`. Defaults to `true`. |
| `maxWidth` | `number` | The widest the content grows, in pixels. Defaults to 720. |

With no card props and no `children`, the screen says "There are no security settings to
manage." (`{testID}-empty`).

Accessibility: the title is a level 1 heading and each card's title is level 2, so screen
reader heading navigation lists Security, then each card; the loading state is a `progressbar`
named "Loading security settings" with visible text; the page error is an alert.

**Test IDs** (with the default `testID="account-security-screen"`; each card keeps its own default
testID, unless you pass `testID` in its props):

| Element | testID |
| --- | --- |
| Root / heading block / title / description | `account-security-screen`, `-heading`, `-title`, `-description` |
| Sign-in methods group | `account-security-screen-sign-in-methods` |
| Loading | `account-security-screen-loading` |
| Error card / message / Try again | `account-security-screen-error`, `-error-message`, `-retry` |
| No cards | `account-security-screen-empty` |

#### A connected screen

`@terreno/rtk` ships the connected version: `TerrenoAccountSecurityScreen` (and the
`useAccountSecurity` hook behind it) wires every card to the Better Auth client, refetches the
affected section after each change, and links in bearer mode through the OAuth handoff. See
[Drop-in security screen](../how-to/configure-better-auth.md#6-drop-in-security-screen). To connect
the presentational screen yourself instead, work along the lines below. It needs a client created
with the passkey and two-factor client plugins (for `authClient.passkey` and
`authClient.twoFactor`), reads which features are on from `useAuthMethods`, and unwraps every
Better Auth call, because the client resolves `{data, error}` instead of rejecting. Better Auth's
`setPassword` is server-only, so "Set a password" posts to `@terreno/api`'s
`POST {basePath}/terreno/set-password`.

``````typescript
import {useAuthMethods} from "@terreno/rtk";
import type {AccountPasskey, AccountSession, LinkedAccount} from "@terreno/ui";
import {AccountSecurityScreen, hasPasswordCredential, Text} from "@terreno/ui";
import {type FC, useCallback, useEffect, useState} from "react";

import {authClient} from "@/store/authClient";

/** Throws the Better Auth error, so the card that called shows its message. */
const unwrap = <T,>(result: {data: T | null; error: {message?: string} | null}, fallback: string): T => {
  if (result.error || result.data === null) {
    throw new Error(result.error?.message ?? fallback);
  }
  return result.data;
};

export const SecurityScreen: FC = () => {
  const {
    methods,
    isLoading: isMethodsLoading,
    error: methodsError,
    refetch: refetchMethods,
  } = useAuthMethods(authClient);
  const session = authClient.useSession();
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [passkeys, setPasskeys] = useState<AccountPasskey[]>([]);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  // False until the first load settles, so the cards never flash empty and a methods failure
  // (no load runs) is not stuck behind a spinner.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();

  const loadAccounts = useCallback(async (): Promise<void> => {
    const data = unwrap(await authClient.listAccounts(), "Couldn't load your accounts.");
    setAccounts(data.map((account) => ({...account, linkedAt: account.createdAt})));
  }, []);
  const loadPasskeys = useCallback(async (): Promise<void> => {
    setPasskeys(unwrap(await authClient.passkey.listUserPasskeys(), "Couldn't load passkeys."));
  }, []);
  const loadSessions = useCallback(async (): Promise<void> => {
    setSessions(unwrap(await authClient.listSessions(), "Couldn't load your sessions."));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(undefined);
    try {
      await Promise.all([loadAccounts(), methods?.passkey ? loadPasskeys() : null, loadSessions()]);
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  }, [loadAccounts, loadPasskeys, loadSessions, methods?.passkey]);

  // Load the cards' data once the server says which features are on.
  useEffect(() => {
    if (methods) {
      void load();
    }
  }, [load, methods]);

  const hasPassword = hasPasswordCredential(accounts);
  const user = session.data?.user;

  return (
    <AccountSecurityScreen
      error={methodsError ?? loadError}
      header={user ? <Text color="secondaryLight">Signed in as {user.email}</Text> : undefined}
      isLoading={
        isMethodsLoading || session.isPending || isLoading || (Boolean(methods) && !hasLoaded)
      }
      onRetry={methods ? load : refetchMethods}
      linkedAccounts={
        methods && methods.providers.length > 0
          ? {
              accounts,
              providers: methods.providers.map((id) => ({id})),
              // Bearer-mode web clients link through linkSocialWithHandoff instead.
              onLink: async (provider) => {
                unwrap(await authClient.linkSocial({callbackURL: "/security", provider}), "Couldn't link that account.");
              },
              onUnlink: async (_providerId, account) => {
                unwrap(await authClient.unlinkAccount({accountId: account.id}), "Couldn't unlink that account.");
                await loadAccounts();
              },
            }
          : undefined
      }
      password={
        methods?.emailPassword
          ? {
              hasPassword,
              onSubmit: async ({mode, currentPassword, newPassword, revokeOtherSessions}) => {
                if (mode === "change") {
                  unwrap(
                    await authClient.changePassword({currentPassword: currentPassword ?? "", newPassword, revokeOtherSessions}),
                    "Couldn't change your password."
                  );
                  return;
                }
                const result = await authClient.$fetch("/terreno/set-password", {
                  body: {newPassword},
                  method: "POST",
                });
                if (result.error) {
                  throw new Error(result.error.message ?? "Couldn't set your password.");
                }
                await loadAccounts();
              },
            }
          : undefined
      }
      passkeys={
        methods?.passkey
          ? {
              passkeys,
              supported: typeof window !== "undefined" && "PublicKeyCredential" in window,
              onAdd: async (name) => {
                unwrap(await authClient.passkey.addPasskey({name}), "Couldn't add a passkey.");
                await loadPasskeys();
              },
              onRename: async (id, name) => {
                unwrap(await authClient.passkey.updatePasskey({id, name}), "Couldn't rename that passkey.");
                await loadPasskeys();
              },
              onRemove: async (passkey) => {
                unwrap(await authClient.passkey.deletePasskey({id: passkey.id}), "Couldn't remove that passkey.");
                await loadPasskeys();
              },
            }
          : undefined
      }
      twoFactor={
        methods?.twoFactor
          ? {
              enabled: Boolean(user?.twoFactorEnabled),
              hasPassword,
              onStartEnroll: async (password) => {
                const data = unwrap(await authClient.twoFactor.enable({password: password ?? ""}), "Couldn't start two-factor setup.");
                if (!("totpURI" in data)) {
                  throw new Error("Couldn't start two-factor setup.");
                }
                return {backupCodes: data.backupCodes, totpURI: data.totpURI};
              },
              onVerify: async (code) => {
                unwrap(await authClient.twoFactor.verifyTotp({code}), "That code didn't work.");
                await session.refetch();
              },
              onRegenerateBackupCodes: async (password) => {
                const data = unwrap(
                  await authClient.twoFactor.generateBackupCodes({password: password ?? ""}),
                  "Couldn't create new backup codes."
                );
                return data.backupCodes;
              },
              onDisable: async (password) => {
                unwrap(await authClient.twoFactor.disable({password: password ?? ""}), "Couldn't turn off two-factor authentication.");
                await session.refetch();
              },
            }
          : undefined
      }
      sessions={{
        currentSessionId: session.data?.session.id,
        sessions,
        onRevoke: async (revoked) => {
          unwrap(await authClient.revokeSession({token: revoked.token ?? ""}), "Couldn't sign out that session.");
          await loadSessions();
        },
        onRevokeOthers: async () => {
          unwrap(await authClient.revokeOtherSessions(), "Couldn't sign out your other sessions.");
          await loadSessions();
        },
      }}
    />
  );
};
``````

`useAuthMethods` reports `passkey`, `twoFactor`, `emailPassword` and `providers`, so a card
appears only for a feature the server has on. When the methods request fails, Try again calls its
`refetch()`; when the methods loaded but the cards' data failed, Try again calls `load` again. Leave `sessions` out on apps that don't want to
show it.

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

Responsive design utilities for breakpoints and device detection. The policy
(support levels, which widths to test, how layouts should adapt) is
[Responsive design](../explanation/responsive-design.md).

``````typescript
import {
  mediaQuery,
  mediaQueryLargerThan,
  mediaQuerySmallerThan,
  isNarrowViewport,
  isSupportedDesktopWidth,
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

// Current window is below the desktop breakpoint
if (isNarrowViewport()) {
  console.info("Narrow viewport");
}

// Same floor for a width you already measured
if (isSupportedDesktopWidth({width: 1280})) {
  console.info("Desktop layout");
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

`isNarrowViewport()` is true below the supported desktop floor: native width < 1024 (`xl`), web width < 1024 (`lg`). `isMobileDevice()` is the same check and is deprecated in favor of `isNarrowViewport`.

`isSupportedDesktopWidth({width})` is the same floor for a width you already have (for example from `useWindowDimensions`). It does not read `Dimensions` itself. Web `lg` and native `xl` both start at 1024pt, so a 768pt window is narrow on both surfaces.

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

`Box` takes an optional `accessibilityState` of `{checked?, disabled?, selected?}`. It is sent to
screen readers as `accessibilityState` and as `aria-checked` / `aria-disabled`, on both a plain and
a clickable Box. On a clickable Box, `disabled: true` also stops presses while the role and
label stay. A clickable Box with `accessibilityRole` `checkbox` or `switch` also toggles on
Space on web, as ARIA expects.

`selected` is sent as `aria-selected` when `accessibilityRole` is a selectable role (`tab`,
`option`, `row`, `gridcell`, `treeitem`, `columnheader`, `rowheader`). On any other Box, such as a
clickable list row, ARIA does not allow `aria-selected`, so `selected: true` is sent as
`aria-current="true"` instead. On web that row does not also receive
`accessibilityState.selected`, because react-native-web would turn it into `aria-selected`
on the button. iOS and Android still read `accessibilityState.selected`.

```tsx
<Box
  accessibilityHint="Marks this item as done"
  accessibilityLabel="Preheat the oven"
  accessibilityRole="checkbox"
  accessibilityState={{checked: false, disabled: isSaving}}
  onClick={toggle}
/>
```

`Box` also takes `accessibilityLiveRegion` (`polite` or `assertive`) on a Box without
`onClick`. It is sent as `aria-live`, so screen readers announce changes to the Box's contents
on web and Android. VoiceOver on iOS does not announce React Native live regions.

```tsx
<Box accessibilityLiveRegion="polite" testID="copy-status">
  {status ? <Text size="sm">{status}</Text> : null}
</Box>
```

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

- **TerrenoProvider props** — `colorScheme`, `initialPrimitives`, custom icons, and OpenAPI spec URL
- **Theme hooks** — `useTheme()`, `setColorScheme()`, `setTheme()`, `setPrimitives()`
- **Component props** — Direct prop overrides for individual components

**Example configuration:**

``````typescript
import {TerrenoProvider} from "@terreno/ui";

<TerrenoProvider
  colorScheme="system"
  openAPISpecUrl="https://api.example.com/openapi.json"
>
  {children}
</TerrenoProvider>
``````

## DataTable column types

`columnType` picks the cell a column draws, unless `customColumnComponentMap` has an entry
for that type:

| `columnType` | Cell |
| --- | --- |
| `text` (and any unmapped type) | The value as a string |
| `number` | The value as a string, right-aligned, with the header right-aligned to match. A number or a numeric string both work |
| `date` | An ISO string or a `Date`, formatted with Luxon `DATE_MED` ("Mar 14, 2026") in the local zone. A value Luxon cannot parse is shown as written, and an empty value is blank |
| `boolean` | A check or a cross icon |

A value that is already formatted, such as "Oct 8, 2026, 3:00 PM", is not ISO, so a `date`
column shows it unchanged.

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
