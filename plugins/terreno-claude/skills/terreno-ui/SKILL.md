---
name: terreno-ui
description: >-
  Build UI with @terreno/ui — Terreno's React Native component library with a
  large component set and a three-layer theming system. Use when adding or reviewing
  layout, forms, tables, modals, feedback, or navigation chrome. Covers
  component selection, Box/Page patterns, theme props, and when NOT to use raw
  React Native primitives. Lifecycle composition: Grow for UI shape, Pick for
  implementation, Roast for UI conformance review. Not for backend APIs, RTK
  Query, or Expo Router setup.
---
# @terreno/ui

`@terreno/ui` is Terreno's universal (iOS, Android, web) component library. Start with existing components before creating new ones. For full screen structure and navigation, see `building-terreno-apps`.

## Choosing a component (read this first)

Work down this list and stop at the first layer that meets the need:

1. **Layout primitives — start here.** `Box` for flex layout, `Page` for full screens, `Card` for grouped content with shadow.
2. **Form fields.** `TextField`, `SelectField`, `DateTimeField`, `CheckBox`, etc. for user input.
3. **Data display.** `DataTable`, `Badge`, `Text`, `Heading` for content.
4. **Feedback.** `Modal`, `Toast`, `Spinner`, `Banner`, `ErrorPage` for states.
5. **Admin screens.** Skill `building-admin-interfaces` (`AdminScreenRouter`,
   `AdminModelTable`, `AdminModelForm`, `AdminShellLayout`) before hand-rolling
   tables/forms.
6. **New component — last resort.** Only when a concrete composition gap is proven. Add to `ui/` package and a demo story in `demo/`.

**Do not use `@expo/ui`** in Terreno apps unless there is an explicit requirement for native SwiftUI/Compose that `@terreno/ui` cannot satisfy.

## Documentation

1. Read `docs/reference/ui.md`, `docs/explanation/responsive-design.md`, `docs/reference/components/`, and the relevant explanation pages before changing components, width-dependent layout, or theme contracts.
2. Implement against that design.
3. Update those pages (and a demo story) in the same slice with `update-docs`.
4. Ship without matching docs is a failed slice.

## References

```
references/
  layout.md              Box, Page, Card, SplitPage — spacing and flex
  forms.md               TextField, SelectField, DateTimeField, validation
  data-display.md        DataTable, Badge, Text, Heading
  feedback.md            Modal, Toast, Spinner, Banner
  theming.md             TerrenoProvider, useTheme, color tokens
```

## Installation

In Terreno monorepo apps, `@terreno/ui` is a workspace dependency:

```json
"@terreno/ui": "workspace:*"
```

Wrap the app root in `TerrenoProvider`:

```tsx
import {TerrenoProvider} from "@terreno/ui";

<TerrenoProvider>
  {children}
</TerrenoProvider>
```

## Quick examples

### Layout

```tsx
import {Box, Card, Heading, Page, Text} from "@terreno/ui";

const ProfileScreen: React.FC = () => (
  <Page title="Profile" scroll>
    <Box gap={4} padding={4}>
      <Heading size="lg">Account</Heading>
      <Card padding={4}>
        <Text>user@example.com</Text>
      </Card>
    </Box>
  </Page>
);
```

### Button

```tsx
import {Button} from "@terreno/ui";

<Button
  text="Save"
  variant="primary"
  onClick={handleSave}
  loading={isSaving}
  iconName="check"
  fullWidth
/>
```

Variants: `primary` | `secondary` | `muted` | `outline` | `destructive`

### Form field

```tsx
import {TextField} from "@terreno/ui";

<TextField
  title="Email"
  value={email}
  onChange={setEmail}
  type="email"
  errorText={emailError}
  helperText="We'll never share your email"
/>
```

### Modal

```tsx
import {Modal, Text} from "@terreno/ui";

<Modal
  title="Confirm Delete"
  visible={isVisible}
  primaryButtonText="Delete"
  secondaryButtonText="Cancel"
  onDismiss={() => setIsVisible(false)}
  onPrimaryAction={handleDelete}
>
  <Text>Are you sure?</Text>
</Modal>
```

## Rules

- Use `Box` for layout — never raw `View` (unless inside a platform-specific workaround).
- Use `Text` / `Heading` from `@terreno/ui` — never raw React Native `Text`.
- Use theme props (`padding`, `gap`, `color`, `border`, `rounding`) — not inline hex when a token exists.
- Use `Page` for screen-level layout — not bare `ScrollView`.
- Icons use FontAwesome 6 via `iconName` props.
- Use Luxon for dates in display logic; `DateTimeField` handles input.
- Always support React Native Web.
- After component changes, verify in the demo app (`verify-ui-changes` skill).

## Component map

| Need | Component |
|------|-----------|
| Flex layout | `Box` |
| Full screen | `Page` |
| Grouped content | `Card` |
| Two-column layout | `SplitPage` |
| Text input | `TextField`, `TextArea`, `EmailField`, `PasswordField` |
| Dropdown | `SelectField`, `MultiselectField` |
| Date/time | `DateTimeField` |
| Boolean | `CheckBox`, `BooleanField`, `RadioField` |
| Table | `DataTable` |
| Status chip | `Badge` |
| Action | `Button`, `IconButton`, `Link` |
| Dialog | `Modal`, `ActionSheet`, `ModalSheet` |
| Loading | `Spinner` |
| Notification | `Toast` (via TerrenoProvider), `Banner` |
| Error state | `ErrorPage`, `ErrorBoundary` |
| OAuth login | `SocialLoginButton` |
| Signature | `SignatureField` |
| Markdown | `MarkdownView` |

See `./references/` for detailed props and patterns.

## vs Expo UI (`@expo/ui`)

| | @terreno/ui | @expo/ui |
|---|-------------|----------|
| Platform | RN + web (unified) | Native SwiftUI/Compose |
| Theming | Three-layer design tokens | Platform-native |
| Forms | Full field library | Limited universal set |
| Tables | `DataTable` with sort/pagination | List components |
| Admin | `@terreno/admin-frontend` | None |
| Terreno integration | First-class | Not integrated |

Default to `@terreno/ui` in all Terreno apps.

## Decision Tree

```
Need UI in a Terreno app?
  |-- Screen structure?
  |   \-- Page + Box (references/layout.md)
  |
  |-- User input?
  |   \-- references/forms.md
  |
  |-- Show data (table, badge, text)?
  |   \-- references/data-display.md
  |
  |-- Loading/error/modal/toast?
  |   \-- references/feedback.md
  |
  |-- Colors/spacing/fonts?
  |   \-- references/theming.md
  |
  |-- Admin CRUD table/form, sidebar, or custom operator screen?
  |   \-- skill building-admin-interfaces
  |
  |-- Component doesn't exist?
  |   \-- Compose with Box + existing fields; add to ui/ only if gap is proven
  |
  \-- Changed a component?
      \-- verify-ui-changes (demo app /dev route)
```

## Common Mistakes

**Wrong: inline styles for spacing**

```tsx
<View style={{padding: 16, marginBottom: 8}}>
```

**Right: theme props**

```tsx
<Box padding={4} marginBottom={2}>
```

**Wrong: raw Text**

```tsx
import {Text} from "react-native";
<Text style={{fontSize: 24}}>Title</Text>
```

**Right: Heading**

```tsx
import {Heading} from "@terreno/ui";
<Heading size="lg">Title</Heading>
```

**Wrong: StyleSheet.create for one-off styles**

```tsx
const styles = StyleSheet.create({container: {flex: 1}});
```

**Right: inline styles or Box props (Terreno convention)**

```tsx
<Box flex="grow" padding={4}>
```
