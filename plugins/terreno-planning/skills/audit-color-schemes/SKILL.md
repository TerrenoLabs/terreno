---
name: audit-color-schemes
description: >-
  Audit a Terreno app's light and dark mode support: find every hardcoded color and
  theme.primitives read, move each to a semantic @terreno/ui theme token, and prove what
  stays fixed meets WCAG 2.2 AA contrast against the app's own light AND dark surfaces
  (static scan, resolved-theme contrast matrix, axe scan of rendered pages in both modes).
  Use when asked to audit or fix dark mode, light mode, theming, color tokens, hardcoded
  colors, or color contrast across an app, or before shipping dark mode. Not for one
  changed screen's accessibility gate (use accessibility-testing) or building new UI
  (use terreno-ui).
---

# Audit light and dark mode

Prove that every color in the app follows the theme, and that every color that cannot
follow it still reads in both modes. The audit is done when the findings table has a row
for every fixed color and primitive read, each row is either converted to a token or
marked keep-fixed with passing light **and** dark ratios, and the rendered axe scan has
zero `color-contrast` violations in both modes.

Scripts live in this skill's `scripts/` folder. Run them with `bun` **from the app root**
(where `@terreno/ui` resolves). Below, `$SKILL` is this skill's directory.

## How Terreno theming decides a color

Read this before judging any finding; the scripts encode it.

- `TerrenoProvider` resolves `colorScheme` (`"light"` default, `"dark"`, `"system"`) and
  picks `lightThemeConfig` or `darkThemeConfig`. Those configs map **semantic tokens**
  (`text.primary`, `surface.base`, `border.focus`, `field.border`, …) to primitive names.
- **Primitives do not flip.** One primitives object serves both modes. `theme.primitives.X`,
  `setPrimitives`, and `initialPrimitives` values are fixed colors.
- **`setTheme` overrides apply to both modes.** Pinning `surface.primary` to a brand color
  pins it in dark mode too.
- `useTheme().colorScheme` is the resolved `"light" | "dark"`; React Native
  `useColorScheme()` is the OS value and ignores the user's in-app choice.

## Workflow

1. **Confirm dark mode is reachable.** Pass when all hold; each miss is a finding.
   - The root `TerrenoProvider` gets `colorScheme="system"` or a user setting, or the app
     calls `setColorScheme` (example: `themeColorSchemeOptions` in a settings screen).
   - `app.json` / `app.config.*` sets `"userInterfaceStyle": "automatic"`; otherwise iOS
     and Android always report light.
   - `StatusBar` style and navigation chrome (`expo-router` / React Navigation theme,
     `expo-system-ui` background) follow `useTheme().colorScheme`.

2. **Static sweep.**

   ```bash
   bun $SKILL/scripts/scanColors.ts --json /tmp/color-scan.json app components
   ```

   Pass the app's source directories (add `--ignore <substring>` for vendored code). It
   lists hex / `rgb()` / `hsl()` / named colors, `theme.primitives.*` reads,
   `react-native` color-scheme reads, hardcoded `StatusBar` styles, `TerrenoProvider`s
   that never leave light mode (suppressed when any file calls `setColorScheme`), and
   `implicit-default-color`: `Text`, `TextInput`, `ActivityIndicator`, `RefreshControl`,
   or `Switch` imported from `react-native`, which paint platform defaults (black text,
   gray spinners) that ignore the theme. Swap those for `@terreno/ui` components, or pass
   theme colors explicitly. Each finding has a `file:line` and the prop it feeds. Also grep for
   color constants files (`colors.ts`, `Colors.ts`) imported into screens and for inline
   SVG `fill` / `stroke` in asset components; the scanner covers these only when they
   are string literals in scanned directories.

3. **Capture the app's theme overrides.** Search for `setTheme(`, `setPrimitives(`, and
   `initialPrimitives`. Write what they set to an overrides file (all keys optional):

   ```json
   {"primitives": {"primary400": "#0E7C86"}, "theme": {"surface": {"primary": "primary400"}},
    "light": {}, "dark": {}}
   ```

   `theme` mirrors `setTheme` (both modes). Use `light` / `dark` only when the app calls
   `setTheme` conditionally on `colorScheme`. With no overrides, skip `--overrides`.

4. **Contrast matrix on the resolved themes.**

   ```bash
   bun $SKILL/scripts/contrastAudit.ts --overrides theme-overrides.json \
     --findings /tmp/color-scan.json --json /tmp/color-report.json
   ```

   It resolves light and dark exactly as `TerrenoProvider` does, then prints two tables:
   - **Semantic token pairs** Terreno components render together (text on
     `surface.base` / `baseAlternate`, `text.inverted` on button fills, status text on
     soft fills, `field.border`, `border.focus`, status dots) at 4.5:1 for text and 3:1
     for UI (WCAG 1.4.3, 1.4.11). A failure here is a theme bug: fix the app's overrides,
     or report it upstream when it fails on Terreno defaults.
   - **Fixed colors** from the scan, measured against both modes' `surface.base` and
     `surface.baseAlternate` (for a fill: `text.primary` on it in each mode), with the
     nearest semantic token. Role comes from the prop name; check rows marked
     "role guessed" by hand.

   Translucent colors are composited over the surface first. For a pair the script does
   not know (fixed text on a fixed fill), measure it directly:

   ```bash
   bun -e 'import {contrastRatio} from "'$SKILL'/scripts/color.ts"; console.log(contrastRatio({foreground: "#7B8496", background: "#11151F"}))'
   ```

5. **Decide every row.** Use [`references/token-map.md`](references/token-map.md):
   - **Convert** to the semantic token for the color's role (not the nearest hex). Prefer
     component props (`<Text color="secondaryLight">`, `<Box color="base" border="default">`)
     over `useTheme().theme.*` in styles.
   - **Keep fixed** only for mode-independent colors (brand marks, data-chosen colors,
     shadows, a deliberately single-mode surface whose text is fixed with it). Add a
     one-line comment with the reason, and record its light and dark ratios against what
     it really sits on. Both must pass.
   - Replace `useColorScheme` from `react-native` with `useTheme().colorScheme`.

6. **Rendered scan in both modes.** Static math misses inherited colors, opacity, and
   images. Run axe against each audited route in light and dark:
   - In the Terreno monorepo: `bun run accessibility:scan <light-url> <dark-url>` (demo
     routes take `?theme=light` / `?theme=dark`).
   - In an app: use `@axe-core/playwright` with tags `wcag2a, wcag2aa, wcag21aa, wcag22aa`.
     `page.emulateMedia({colorScheme: "dark"})` switches only an app on
     `colorScheme="system"`; otherwise flip the app's own setting before scanning.
   - Read both `violations` and `incomplete`: on React Native Web, axe often puts
     `color-contrast` in `incomplete` (overlapping or translucent backgrounds). Check
     each incomplete node by hand with step 4's one-liner.
   - Save light/dark screenshots of each route; look at them. Contrast can pass while a
     card edge, divider, or focus ring disappears into the dark surface.

   On native, toggle the device appearance (`xcrun simctl ui booted appearance dark`,
   `adb shell cmd uimode night yes`) and screenshot the same screens.

7. **Report.** One table, most severe first:

   | file:line | current | role | action (token / keep fixed) | light | dark | min | status |
   | --- | --- | --- | --- | --- | --- | --- | --- |

   Then: reachability findings (step 1), semantic-pair failures (step 4), axe results per
   route and mode with screenshot paths. Do not mark a row done on a light-mode pass alone.

## Pairs with

- `terreno-ui` for component color props and theming API.
- `accessibility-testing` for keyboard, focus, semantics, and reflow on changed screens.
- `verify-ui-changes` to drive the app and attach the screenshots to a PR.

## Completion

- Every scan finding is converted or justified keep-fixed with both ratios passing.
- Semantic-pair failures are fixed in app overrides or filed upstream with ratios.
- Axe shows zero `color-contrast` violations and no unchecked `incomplete` contrast nodes
  on every audited route in light and dark.
- Dark mode is reachable on web and native (step 1).
