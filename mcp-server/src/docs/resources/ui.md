# @terreno/ui Documentation

React Native UI component library for one universal app (iOS, Android, and web).

## Installation

```bash
bun add @terreno/ui
```

## Setup

Wrap your app with TerrenoProvider:

```typescript
import { TerrenoProvider } from "@terreno/ui";

const App = () => (
  <TerrenoProvider>
    <YourApp />
  </TerrenoProvider>
);
```

## Core Components

### Box (Layout Foundation)

The primary layout component. Use instead of View.

```typescript
import { Box } from "@terreno/ui";

<Box
  direction="row"
  padding={4}
  gap={2}
  alignItems="center"
  justifyContent="between"
  backgroundColor="neutral100"
>
  <Text>Content</Text>
</Box>
```

**Props:**
- `direction`: "row" | "column" (default: "column")
- `padding`, `paddingX`, `paddingY`: 0-12 (spacing scale)
- `margin`, `marginX`, `marginY`: 0-12
- `gap`: 0-12
- `alignItems`: "start" | "center" | "end" | "stretch"
- `justifyContent`: "start" | "center" | "end" | "between" | "around"
- `flex`: number
- `backgroundColor`: theme color key

### Button

```typescript
import { Button } from "@terreno/ui";

<Button
  text="Submit"
  onClick={handleSubmit}
  variant="primary"
  loading={isLoading}
  disabled={!isValid}
  fullWidth
/>

<Button
  text="Delete"
  variant="destructive"
  withConfirmation
  confirmationTitle="Delete Item?"
  confirmationMessage="This cannot be undone."
/>
```

**Variants:**
- `primary` - Default filled button
- `secondary` - Darker background
- `outline` - Border only
- `ghost` - Minimal, no background
- `destructive` - Red/error color
- `muted` - Light background

### Text & Typography

```typescript
import { Text, Heading, Title } from "@terreno/ui";

<Title>Page Title</Title>
<Heading size="lg">Section Heading</Heading>
<Text size="md" color="neutral600">Body text</Text>
```

### Form Fields

```typescript
import {
  TextField,
  EmailField,
  PasswordField,
  NumberField,
  TextArea,
  SelectField,
  DateTimeField,
  BooleanField,
  CheckBox,
  RadioField,
} from "@terreno/ui";

<TextField
  label="Name"
  value={name}
  onChangeText={setName}
  placeholder="Enter your name"
  error={errors.name}
  helperText="Your full legal name"
/>

<SelectField
  label="Country"
  value={country}
  onChangeValue={setCountry}
  options={[
    { label: "United States", value: "US" },
    { label: "Canada", value: "CA" },
  ]}
/>

<DateTimeField
  label="Date of Birth"
  value={dob}
  onChange={setDob}
  mode="date"
/>

<BooleanField
  label="Accept Terms"
  value={accepted}
  onChangeValue={setAccepted}
/>
```

### Modal & Sheets

```typescript
import { Modal, ModalSheet, ActionSheet } from "@terreno/ui";

<Modal
  visible={showModal}
  title="Confirm Action"
  subtitle="Are you sure?"
  primaryButtonText="Confirm"
  secondaryButtonText="Cancel"
  onPrimaryAction={handleConfirm}
  onDismiss={() => setShowModal(false)}
>
  <Text>Modal content here</Text>
</Modal>

<ActionSheet
  visible={showSheet}
  title="Select Option"
  onDismiss={() => setShowSheet(false)}
>
  <Button text="Option 1" onClick={handleOption1} />
  <Button text="Option 2" onClick={handleOption2} />
</ActionSheet>
```

### Table Components

```typescript
import {
  Table,
  TableHeader,
  TableHeaderCell,
  TableRow,
  TableText,
  TableDate,
  TableBadge,
} from "@terreno/ui";

<Table data={users} keyExtractor={(item) => item.id}>
  <TableHeader>
    <TableHeaderCell>Name</TableHeaderCell>
    <TableHeaderCell>Email</TableHeaderCell>
    <TableHeaderCell>Status</TableHeaderCell>
  </TableHeader>
  {users.map((user) => (
    <TableRow key={user.id} item={user}>
      <TableText field="name" />
      <TableText field="email" />
      <TableBadge field="status" />
    </TableRow>
  ))}
</Table>
```

### Page & Layout

```typescript
import { Page, SplitPage, ScrollView } from "@terreno/ui";

<Page
  navigation={navigation}
  title="Dashboard"
  headerRight={<IconButton name="settings" />}
>
  <ScrollView>
    {/* Content */}
  </ScrollView>
</Page>
```

## Theme System

### Using Theme

```typescript
import { useTheme } from "@terreno/ui";

const MyComponent = () => {
  const { theme, setTheme } = useTheme();

  return (
    <Box backgroundColor={theme.colors.primary500}>
      <Text color={theme.colors.neutral100}>Themed content</Text>
    </Box>
  );
};
```

### Theme Values

**Colors:**
- Primary: primary100-900
- Secondary: secondary100-900
- Accent: accent100-900
- Neutral: neutral100-900
- Error: error100-900
- Success: success100-900
- Warning: warning100-900

**Spacing (0-12):**
spacing0=0, spacing1=4, spacing2=8, spacing3=12, spacing4=16, spacing5=24, spacing6=32, spacing7=40, spacing8=48, spacing9=56, spacing10=64, spacing11=72, spacing12=80

**Border Radius:**
radiusSm, radiusMd, radiusLg, radiusXl, radius2xl, radius3xl

## Utilities

```typescript
import { useStoredState, MediaQuery, isNarrowViewport } from "@terreno/ui";

// Persist state to storage
const [value, setValue] = useStoredState("key", defaultValue);

// Responsive rendering
<MediaQuery minWidth={768}>
  <DesktopLayout />
</MediaQuery>

// Current window is below the desktop breakpoint.
// isMobileDevice() is deprecated in favor of isNarrowViewport().
if (isNarrowViewport()) {
  // Narrow-viewport code
}
```

## Icons

FontAwesome 6 icons are used by default via `iconName`:

```typescript
import { Icon, IconButton, Button } from "@terreno/ui";

<Icon iconName="check" size="md" color="primary" />
<IconButton accessibilityLabel="Close" iconName="xmark" onClick={handleClose} />
<Button text="Save" iconName="check" onClick={handleSave} />
```

### Custom Icons

Register SVG or other custom icons on `TerrenoProvider` and use them by name anywhere `iconName` is accepted. Registered names take precedence over FontAwesome.

```typescript
import type { CustomIconProps } from "@terreno/ui";
import { TerrenoProvider } from "@terreno/ui";
import Svg, { Path } from "react-native-svg";

const SparkleIcon = ({ color, size, testID }: CustomIconProps) => (
  <Svg fill="none" height={size} testID={testID} viewBox="0 0 24 24" width={size}>
    <Path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill={color} />
  </Svg>
);

<TerrenoProvider icons={{ sparkle: SparkleIcon }}>
  <Icon iconName="sparkle" color="accent" size="lg" />
</TerrenoProvider>
```

For TypeScript autocomplete, extend `CustomIconRegistry` via declaration merging:

```typescript
declare module "@terreno/ui" {
  interface CustomIconRegistry {
    sparkle: true;
  }
}
```

## Best Practices

1. Use `Box` as your primary layout component
2. Use theme values instead of hardcoded colors/spacing
3. Wrap callbacks with `useCallback`
4. Use Luxon for dates (not Date or dayjs)
5. Provide explicit return types on components
6. Use `React.FC` for component typing
