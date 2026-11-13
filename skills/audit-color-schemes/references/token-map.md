# Fixed color → theme token map

Read `useTheme().theme` (or a component color prop) instead of the literal. Pick by
**role**, not by matching hex: the light value of a token can equal the literal while its
dark value is something else entirely, which is the point.

| The literal is used as | Replace with | Component prop |
| --- | --- | --- |
| Body / heading text | `theme.text.primary` | `<Text color="primary">` |
| Secondary, caption, timestamp text | `theme.text.secondaryLight` | `color="secondaryLight"` |
| Placeholder / hint text | `theme.text.extraLight` | (fields set it) |
| Text on a filled brand/error button or chip | `theme.text.inverted` | `color="inverted"` |
| Link text | `theme.text.link` | `<Link>` |
| Error / success / warning text | `theme.text.error` / `success` / `warning` | `color="error"` … |
| Page or card background, `"white"`, `"#fff"` | `theme.surface.base` | `<Box color="base">` |
| Alternate row, inset panel, `#F5F5F5`-ish | `theme.surface.baseAlternate` | `color="baseAlternate"` |
| Hover / selected row | `theme.surface.baseHover` / `secondaryExtraLight` | |
| Brand fill (primary button, active tab) | `theme.surface.primary` | `color="primary"` |
| Soft status fill (banner, badge) | `theme.surface.errorLight` / `successLight` / `warningLight` | |
| Solid status fill | `theme.surface.error` / `success` / `warning` | |
| Disabled fill | `theme.surface.disabled` | |
| Divider, card outline | `theme.border.default` | `<Box border="default">` |
| Input / control outline (must be visible) | `theme.field.border` or `theme.border.dark` | |
| Focus ring | `theme.border.focus` | |
| Error / success / warning outline | `theme.border.error` / `success` / `warning` | `border="error"` … |
| Icon that sits next to text | the text token of that text | `<Icon color="secondaryLight">` |
| Online / away / busy dot | `theme.status.active` / `away` / `doNotDisturb` | |
| Chart series | omit `color` so charts use their theme paint (`surface.primary`), or pass a theme token | chart `color` props |

## Never a fix

- `theme.primitives.*` — primitives are the same object in both modes; reading one is a
  hardcoded color with extra steps. Map it to the semantic token for its role.
- `useColorScheme()` from `react-native` to branch colors — it reports the OS, not the
  user's in-app choice. Read `useTheme().colorScheme` (always `"light"` or `"dark"`).
- Leaving the color off a `react-native` `Text`, `TextInput`, `ActivityIndicator`, or
  `Switch`: the platform default (black text) does not flip. Use `@terreno/ui` `Text`,
  `TextField`, and `BooleanField`, which read the theme. `Spinner` reads fixed primitives
  (`neutral400` by default), so check its ratio against both surfaces too.
- Adding a token to `setTheme({...})` to fix one mode — `setTheme` overrides apply to
  **both** modes. A brand color that works on white can disappear on `neutral800`.

## Colors that may stay fixed

Keep the literal, with a one-line comment saying why, only when it is genuinely
mode-independent **and** passes in both modes against what it actually sits on:

- Third-party brand marks with mandated colors (Google, Apple, GitHub buttons — the
  `SocialLoginButton` handles these).
- Content colors chosen by data (user-picked tag color, avatar initials background); pair
  them with `readableTextColor`-style logic so the text on them is computed, not assumed.
- `transparent`, and shadows (`shadowColor: "#000"` is fine in both modes).
- A deliberately single-mode surface (an always-dark video player, a code console) whose
  text colors are fixed **with** it — audit that text against the fixed fill, not the theme.

## Thresholds (WCAG 2.2 AA)

| What | Min | Criterion |
| --- | --- | --- |
| Text < 18pt (24px) regular / < 14pt (18.66px) bold | 4.5:1 | 1.4.3 |
| Large text | 3:1 | 1.4.3 |
| Control boundaries, focus indicator, icons that carry meaning, chart marks, status dots | 3:1 vs adjacent color | 1.4.11 |
| Disabled controls, pure decoration, logos | exempt | 1.4.3 / 1.4.11 |
| Focus indicator area & contrast (enhanced) | 3:1 change | 2.4.13 (AAA, advisory) |

Contrast is measured on the color actually rendered: composite translucent colors
(`rgba`, 8-digit hex, `opacity`) over the surface beneath before measuring.
