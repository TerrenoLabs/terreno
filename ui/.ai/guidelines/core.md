### @terreno/ui

React Native UI component library (a large component library):

- **Layout**: Box, Page, ListDetailLayout, SplitPage, Card
- **Forms**: TextField, SelectField, DateTimeField, CheckBox
- **Display**: Text, Heading, Badge, DataTable
- **Actions**: Button, IconButton, Link
- **Feedback**: Spinner, Modal, Toast
- **Theming**: TerrenoProvider, useTheme

Key imports:

```typescript
import {
  Box,
  Button,
  Card,
  Page,
  Text,
  TextField,
  TerrenoProvider,
} from "@terreno/ui";
```

#### UI Component Examples

Layout with Box:

```typescript
<Box direction="row" padding={4} gap={2} alignItems="center">
  <Text>Content</Text>
  <Button text="Action" />
</Box>
```

Buttons:

```typescript
<Button
  text="Submit"
  variant="primary" // 'primary' | 'secondary' | 'outline' | 'ghost'
  onClick={handleSubmit}
  loading={isLoading}
  iconName="check"
/>
```

Forms:

```typescript
<TextField
  label="Email"
  value={email}
  onChangeText={setEmail}
  error={emailError}
  helperText="Enter a valid email"
/>
```

#### UI Common Pitfalls

- Don't use inline styles when theme values are available
- Don't use raw `View`/`Text` when `Box`/@terreno/ui `Text` are available
- Don't forget loading and error states
- Don't use `style` prop when equivalent props exist (`padding`, `margin`)
- Never modify `openApiSdk.ts` manually
- **No barrel imports** inside `@terreno/ui` — import from concrete files (e.g. `./fieldElements/FieldTitle`), not `./fieldElements` or the package `index`. See `docs/explanation/no-barrel-imports.md`.
