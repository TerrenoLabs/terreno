---
trigger: always_on
---
# @terreno/ui

React Native UI component library with a large component set and a three-layer theming system. This is a **frontend-only** package — no Express, no Mongoose, no backend code.

## Commands

```bash
bun run compile          # Compile TypeScript
bun run dev              # Watch mode
bun run test             # Run tests (watch mode)
bun run test:ci          # Run tests (CI mode)
bun run lint             # Lint code
bun run lint:fix         # Fix lint issues
```

## Architecture

### File Structure

```
src/
  index.tsx              # All 90+ exports
  Box.tsx                # Core layout primitive (style mapper)
  Button.tsx             # Action button with variants
  SocialLoginButton.tsx  # OAuth login button for Better Auth
  Card.tsx               # Box wrapper with shadow and rounding
  Page.tsx               # Page layout with header/footer
  Modal.tsx              # Dialog/action sheet
  Text.tsx               # Base text component
  Heading.tsx            # Title text component
  TextField.tsx          # Text input field
  SelectField.tsx        # Dropdown select
  DateTimeField.tsx      # Date/time picker
  DataTable.tsx          # Advanced table with sorting/pagination
  Theme.tsx              # Theme context and provider
  TerrenoProvider.tsx    # Root provider (Theme + Toast + OpenAPI)
  Common.ts              # All type definitions (~2700 lines)
  Constants.ts           # Large constant definitions
  Utilities.tsx          # Helper functions
  useStoredState.ts      # AsyncStorage persistence hook
  test-utils.tsx         # Test helpers (renderWithTheme)
  fieldElements/         # Form field sub-components (title, error, helper)
  table/                 # Table cell components
  icons/                 # Custom SVG icons
  signUp/                # Login/signup screens and OAuth components
  asks/                  # AskCard, SimpleAskCard, and per-kind ask controls for GPTChat
```

## Exports

### Components
All UI components are exported from the package root.

### Type Re-exports
@terreno/ui re-exports commonly-used React Native types to avoid version conflicts:

```typescript
import {StyleProp, ViewStyle} from "@terreno/ui";

// Use these instead of importing from react-native directly
const customStyle: StyleProp<ViewStyle> = {
  flex: 1,
  backgroundColor: "#fff",
};
```

**Why re-export types?**
- Avoids version mismatches between consumer's react-native and @terreno/ui's react-native
- Ensures type compatibility when passing styles to @terreno/ui components
- Simplifies imports (one package instead of two)

## Component Categories

### Layout
Box, Page, SplitPage, Card, Body, ImageBackground, DashboardGrid

### Text
Text, Heading, Link, Hyperlink

### Form Fields
TextField, TextArea, SelectField, CustomSelectField, MultiselectField, DateTimeField, NumberField, EmailField, PhoneNumberField, BooleanField, RadioField, CheckBox, AddressField, PasswordField, SignatureField

### Actions
Button, IconButton, DismissButton, SocialLoginButton

### Data Display
DataTable, Pagination, Badge, SelectBadge, Avatar, LineChart, BarChart, AreaChart, DonutChart

### Feedback
Modal, Toast, Spinner, ErrorPage, ErrorBoundary, Banner

### Navigation
Accordion, SideDrawer, SegmentedControl, ActionSheet, ModalSheet

### Advanced
TapToEdit, Icon (FontAwesome 6), Tooltip, MarkdownView, EmojiSelector, Image, Slider

### AI chat
GPTChat, AskCard, SimpleAskCard

## Theming System

Three-layer architecture: Primitives → Config → Computed Theme.

### Primitives (raw values)
- Colors: `neutral000-900`, `primary000-900`, `secondary000-900`, `accent000-900`, `error/success/warning 000-200`
- Spacing: `spacing0=0` through `spacing12=80` (increments of 4-8px)
- Radius: `radiusSm=2`, `radiusMd=4`, `radiusLg=16`, `radiusXl=32`, `radius2xl=128`, `radius3xl=360`

### Config (maps primitives to usage)
- `text`: primary, inverted, secondaryDark, etc.
- `surface`: base, primary, disabled, error, etc.
- `border`: default, dark, focus, error, success, warning
- `status`: active, away, doNotDisturb
- `font`: primary (Nunito), title (Titillium Web)

### Consuming the theme

```typescript
const {theme, setTheme, setPrimitives, resetTheme} = useTheme();

// Use theme values in styles
<Box color="primary">                    // theme.surface.primary
  <Text color="inverted">Themed</Text>   // theme.text.inverted
</Box>

// Customize theme
setTheme({surface: {primary: "secondary500"}});
setPrimitives({accent500: "#FF6B35"});
```

## Box — Core Layout Primitive

All layout is built on Box. It maps props to React Native flexbox styles.

### Key Props

```typescript
// Flexbox
direction="row" | "column"
justifyContent="start" | "end" | "center" | "between" | "around"
alignItems="start" | "end" | "center" | "baseline" | "stretch"
flex="grow" | "shrink" | "none"
gap={0-12}
wrap={true}

// Spacing (0-12 scale, maps to pixel values via SPACING_MAP)
padding={4}  paddingX={2}  paddingY={3}
margin={2}   marginTop={1}  // Negative values allowed: margin={-2}

// Sizing
width={300}  width="50%"  height="100%"
minWidth={200}  maxWidth={800}

// Styling
color="base" | "primary" | "disabled" | "error" | ...  // Surface colors
border="default" | "dark" | "focus" | "error"
rounding="sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "circle"
shadow={true}
overflow="hidden" | "scroll" | "scrollX" | "scrollY"
display="none" | "flex" | "block"
position="absolute" | "relative" | "fixed"

// Responsive (sm/md/lg/xl; native 320/375/600/1024, web lg 1024 / xl 1280)
smDirection="row"  mdPadding={6}  lgDisplay="flex"  xlDirection="column"

// Interaction
onClick={() => {}}     // Makes it Pressable
scroll={true}          // Wraps in ScrollView
avoidKeyboard={true}   // Wraps in KeyboardAvoidingView

// Testing
testID="my-box"
```

### Spacing Scale

`0→0px, 1→4px, 2→8px, 3→12px, 4→16px, 5→24px, 6→32px, 7→40px, 8→48px, 9→56px, 10→64px, 11→72px, 12→80px`

## Button

```typescript
<Button
  text="Submit"                        // Required
  variant="primary"                    // primary | secondary | muted | outline | destructive
  onClick={handleSubmit}               // Required
  loading={isLoading}                  // Shows spinner
  disabled={isDisabled}
  fullWidth={true}
  iconName="check"                     // FontAwesome 6 icon
  iconPosition="left"                  // left | right
  withConfirmation={true}              // Shows confirmation modal
  confirmationText="Are you sure?"
  tooltipText="Click to submit"        // Not on native
  wrapText={true}                      // Wrap a long label onto centered lines instead of overflowing
/>
```

Features: 500ms debounce, haptic feedback, built-in confirmation modal.

A label stays on one line by default. Set `wrapText` when the label is long or not under your
control (for example agent text), so the button stays inside its container and grows taller.

## Agent asks (GPTChat, AskCard, SimpleAskCard)

Human docs: `docs/reference/ui.md` (GPTChat → Asks, AskCard, SimpleAskCard) and
`docs/how-to/agent-ui-asks.md`. Ask types and schemas come from `@terreno/blocks`.

```tsx
<GPTChat
  askErrors={askErrors}                // Record<toolCallId, AskValidationError[]> from a 400 Invalid askResponse
  currentMessages={currentMessages}    // set `ask` on the ask's tool-call message
  onAskSubmit={handleAskSubmit}        // ({toolCallId, response}) => void | Promise<void>
  resolveAskFiles={uploadAskFiles}     // optional; defaults to data URLs for `files` asks
  {...otherChatProps}
/>

<AskCard ask={ask} errors={errors} onSubmit={handleAskSubmit} />      // custom transcripts
<SimpleAskCard card={pendingAsk.simple} onPress={sendButton} pendingButtonId={sendingId} />
```

- `GPTChatMessage.ask` is a `ChatAsk`: `{toolCallId, kind, input, status, response?, simple?}`
  with `status` `pending`, `answered`, or `cancelled`. Pending asks are interactive; the others
  collapse to a one-line summary.
- Keep the ask's `tool-result` message in `currentMessages` (it is hidden): message indexes must
  match stored `prompts` rows used by ratings.
- Without `onAskSubmit` / `onSubmit`, asks render read-only.
- `SimpleAskCard` renders any ask's simple card (title, question, up to three full-width buttons)
  for narrow layouts. Send `{toolCallId, buttonId}` to `POST /gpt/histories/:id/turn`, or send
  `button.response` as the answer. `handoff: true` cards show "Continue on your phone".
- Ask controls are built from Terreno components (`RadioField`, `SelectField`,
  `MultiselectField`, `TextField`, `Button` with `wrapText`) — keep it that way.

## Blocks (GPTChat, BlocksView)

Human docs: `docs/reference/ui.md` (GPTChat, BlocksView),
`docs/reference/blocks.md`, and `docs/how-to/agent-ui-blocks.md`.

```tsx
<GPTChat
  hostActions={["exportDataset", "scaleStepper", "toggleChecklist"]} // callbacks this host runs; others stay disabled
  onBlockAction={handleBlockAction}    // open and select
  onBlockCallback={handleBlockCallback} // callback, stepper tap, checklist tick; return {replace: "block", blocks} or {text}
  resolveDataset={resolveDataset}      // load a ref dataset as {columns, rows, source: "inline"}
  resolveImage={resolveImage}          // turn a file: image id into a URL
  uiBlocks
  {...otherChatProps}
/>
// Set GPTChatMessage.blockNote for a caption such as "3 components".

<BlocksView document={yaml} hostActions={hostActions} resolveDataset={resolveDataset} />
```

- Assistant `content` is one whole-reply YAML document. `reply` calls `onSubmit`.
- Render with `@terreno/ui` components only. Do not paint blocks with raw `View` or `Text`.
- Catalog: heading, text, metric, badge, divider, context, callout, details, image, gallery,
  list, chart, table, actions (button, segmented), stepper, checklist, columns, card (optional
  `eyebrow`), and opt-in html. Field rules live in `docs/reference/blocks.md`; never invent a type.
- `stepper` − / + and `checklist` ticks with a `callback` go through `onBlockCallback` to a host
  action (`scaleStepperHostAction` / `toggleChecklistHostAction` or the app's own). The block is
  disabled while pending, and the returned block arrives as an override. Ticks without a callback,
  or with a name outside `hostActions`, stay local.
- A `copy` action writes the clipboard on the device with `blockPlainText` from the block as
  shown (override and ticks applied). It never calls `onAction`, so `hostActions` does not gate it.
- `file:` images in `image`, `gallery`, and `list` stay labelled placeholders until
  `resolveImage` returns a URL; `alt` is the accessible label.

## SocialLoginButton

Branded OAuth login button for Better Auth integration. Supports Google, GitHub, and Apple with appropriate brand colors and icons.

```typescript
<SocialLoginButton
  provider="google"                    // google | github | apple (required)
  onPress={async () => {               // Required
    await authClient.signIn.social({provider: "google"});
  }}
  loading={isLoading}                  // Shows spinner
  disabled={false}
  variant="primary"                    // primary (branded colors) | outline (white bg)
  fullWidth={true}
  text="Sign in with Google"           // Optional custom text
  testID="google-login"
/>
```

Features:
- Auto-branded colors following provider guidelines (Google white, GitHub dark, Apple black)
- FontAwesome provider icons
- 500ms debounce
- Loading state with spinner
- Full width by default
- Primary variant uses brand colors, outline variant uses white background with brand borders

## Form Fields

All form fields share a common pattern:

```typescript
// Common props across all fields
interface BaseFieldProps {
  onChange: (value: string) => void  // Required
  value?: string
  title?: string                     // Label above field
  placeholder?: string
  disabled?: boolean
  errorText?: string                 // Red error below field
  helperText?: string                // Gray helper below field
  iconName?: IconName
  testID?: string
}
```

### TextField

```typescript
<TextField
  title="Email"
  value={email}
  onChange={setEmail}
  type="email"           // email | password | phoneNumber | search | text | url
  errorText={emailError}
  helperText="Enter valid email"
  multiline={true}
  rows={3}
  grow={true}            // Auto-expand height
  trimOnBlur={true}      // Trim whitespace on blur
/>
```

`type="password"` masks the value and adds a show/hide eye control (test id
`{testID}.visibility-toggle`). Pass `showVisibilityToggle={false}` to remove it.

### SelectField

```typescript
<SelectField
  title="Status"
  options={[{label: "Active", value: "active"}, {label: "Inactive", value: "inactive"}]}
  value={status}
  onChange={setStatus}
  requireValue={true}    // No empty option
/>
```

### DateTimeField

```typescript
<DateTimeField
  title="Due Date"
  type="date"            // date | datetime | time
  value={dueDate}        // ISO string
  onChange={setDueDate}
  showTimezone={true}
/>
```

## Modal

```typescript
<Modal
  visible={isVisible}
  onDismiss={() => setIsVisible(false)}
  title="Confirm"
  size="sm"                          // sm | md | lg
  primaryButtonText="Confirm"
  primaryButtonOnClick={handleConfirm}
  secondaryButtonText="Cancel"
  secondaryButtonOnClick={() => setIsVisible(false)}
  persistOnBackgroundClick={false}
>
  <Text>Are you sure?</Text>
</Modal>
```

Renders as ActionSheet on mobile, centered dialog on web.

## Text & Heading

```typescript
// Text - body copy (Nunito font)
<Text size="md" color="primary" bold truncate>Content</Text>
// Sizes: sm(12/10px) md(16/14px) lg(18/16px) xl(20/18px) 2xl(48/40px) [web/mobile]

// Heading - titles (Titillium Web font)
<Heading size="lg" color="primary" align="center">Title</Heading>
// Sizes: sm(16/14px) md(18/16px) lg(24/20px) xl(32/28px) 2xl(48/32px) [web/mobile]
```

## DataTable

```typescript
<DataTable
  columns={[
    {key: "name", label: "Name", width: 200, sortable: true},
    {key: "status", label: "Status", width: 100, columnType: "boolean", pinned: true},
    {key: "created", label: "Created", width: 150, columnType: "date"},
  ]}
  data={rows}
  onSortChange={(sort) => setSort(sort)}
  onRowClick={(row) => navigate(row.id)}
  pageSize={20}
  totalRowCount={100}
  onPageChange={(page) => setPage(page)}
  sticky={true}
  loading={isLoading}
/>
```

Column types: `text`, `date`, `number`, `boolean`, `custom`. Supports pinned columns, sorting indicators, pagination controls.

## Card

Simple Box wrapper with defaults:

```typescript
<Card padding={4} color="base">   {/* rounding="md", shadow=true */}
  <Text>Content</Text>
</Card>
```

## Page

Full-screen layout with header, navigation, and optional footer:

```typescript
<Page
  title="My Page"
  backButton                         // Auto back navigation
  maxWidth={800}
  padding={2}
  scroll={true}
  loading={isLoading}
  footer={<Button text="Save" onClick={save} />}
  navigation={navigation}
>
  {children}
</Page>
```

## Custom Hooks

### useStoredState

Persists state to AsyncStorage:

```typescript
const [value, setValue, isLoading] = useStoredState<string>("key", "default");
```

## Conventions

- Use `Box` for all layout — never raw `View`
- Use `Text`/`Heading` from @terreno/ui — never raw React Native `Text`
- Use theme values via props (`color`, `border`, `rounding`) — not inline hex colors
- Use spacing props (`padding`, `margin`, `gap`) — not `style={{padding: 16}}`
- Icons use FontAwesome 6 names via `iconName` props
- Always support React Native Web — no platform-specific code without fallbacks
- Use inline styles over `StyleSheet.create`
- Declare `pointerEvents` through `StyleSheet.create` — react-native-web drops it from inline styles, so `box-none` / `box-only` containers silently become event-swallowing overlays on web
- Use Luxon for all date operations

## Testing

```typescript
import {renderWithTheme} from "./test-utils";
import {describe, it, expect} from "bun:test";

describe("MyComponent", () => {
  it("renders correctly", () => {
    const {getByTestId} = renderWithTheme(<MyComponent testID="comp" />);
    expect(getByTestId("comp")).toBeTruthy();
  });
});
```

- Framework: bun test with `@testing-library/react-native`
- Always wrap components in `renderWithTheme()` (provides ThemeProvider)
- Use `testID` props for element selection

## Logging

- Use `console.info`, `console.debug`, `console.warn`, `console.error` for permanent logs
- Use `console.log` only for temporary debugging (to be removed)
