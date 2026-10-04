# Theming — @terreno/ui

## Three-layer architecture

1. **Primitives** — raw color/spacing values (`neutral500`, `primary500`, `spacing4`)
2. **Config** — semantic maps (`text.primary`, `surface.base`, `border.default`)
3. **Computed theme** — resolved values consumed by components

## TerrenoProvider

```tsx
import {TerrenoProvider} from "@terreno/ui";

<TerrenoProvider colorScheme="system">
  <App />
</TerrenoProvider>
```

Required at the app root. Provides theme context and toast support.

## useTheme

```tsx
import {useTheme} from "@terreno/ui";

const {colorScheme, theme, setTheme, setPrimitives, resetTheme} = useTheme();
```

## Component color props

Use semantic props instead of hex:

```tsx
<Box color="base">           {/* theme.surface.base */}
  <Text color="primary">     {/* theme.text.primary */}
  <Text color="inverted">    {/* on dark backgrounds */}
  <Text color="error">       {/* error state */}
</Box>
```

Surface colors: `base`, `primary`, `disabled`, `error`, etc.
Text colors: `primary`, `inverted`, `secondaryLight`, `error`, etc.
Border colors: `default`, `dark`, `focus`, `error`, `success`, `warning`.

## Spacing and radius

Use numeric spacing props (0-12) on Box, Page padding, and gap:

```tsx
<Box padding={4} gap={3} rounding="md">
```

Radius tokens: `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `circle`.

## Customizing theme

```tsx
setTheme({surface: {primary: "secondary500"}});
setPrimitives({accent500: "#FF6B35"});
```

Reset with `resetTheme()`.

## Fonts

- Body: Nunito (`text` font family)
- Headings: Titillium Web (`title` font family)

Load fonts in root `_layout.tsx` via `useFonts` (see example-frontend).

## Dark mode

Set `TerrenoProvider colorScheme` to `"light"`, `"dark"`, or `"system"`.
The default is deterministic `"light"`; `"system"` follows React Native's
current system scheme. `useTheme().colorScheme` is always the resolved
`"light"` or `"dark"` value. The exported `lightThemeConfig` and
`darkThemeConfig` match the Flourish Health Figma modes.

## Do not

- Hardcode `#hex` when a theme token exists
- Use `style={{padding: 16}}` when `padding={4}` works
- Import colors from a separate constants file instead of theme props
