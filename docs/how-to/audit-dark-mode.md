# Audit light and dark mode

Find every color in an app that ignores the theme, move it to a semantic token, and prove
that what stays fixed meets WCAG 2.2 AA in both modes. Agents run this as the
`audit-color-schemes` skill; the steps below work by hand too. Run the commands from the
app root, where `$SKILL` is the installed skill directory
(`plugins/terreno-planning/skills/audit-color-schemes` in this repo).

## Why colors break in one mode

`TerrenoProvider` swaps `lightThemeConfig` for `darkThemeConfig`. Those configs map
semantic tokens (`text.primary`, `surface.base`, `border.focus`) to primitives. Three
things do **not** change with the mode:

- Literal colors (`"#fff"`, `"white"`, `rgba(...)`).
- Primitives: `theme.primitives.*`, `setPrimitives`, and `initialPrimitives` are shared.
- `setTheme` overrides, which apply to both modes.

A fixed background with theme text is the usual failure: the text flips to light in dark
mode and the fill stays light.

## 1. Make dark mode reachable

- Pass `colorScheme="system"` (or a user setting) to `TerrenoProvider`, or call
  `setColorScheme`. The default is `"light"`.
- Set `"userInterfaceStyle": "automatic"` in `app.json` so iOS and Android report dark.
- Drive `StatusBar` and navigation chrome from `useTheme().colorScheme`, not
  `useColorScheme()` from `react-native`.

## 2. Scan the source

```bash
bun $SKILL/scripts/scanColors.ts --json /tmp/color-scan.json app components
```

## 3. Check contrast against your resolved themes

Record what your app passes to `setTheme` / `setPrimitives` in an overrides file
(`{"primitives": {}, "theme": {}, "light": {}, "dark": {}}`), then:

```bash
bun $SKILL/scripts/contrastAudit.ts --overrides theme-overrides.json \
  --findings /tmp/color-scan.json
```

The first table checks the token pairs `@terreno/ui` renders together. Text needs 4.5:1
and control boundaries, focus rings, and status dots need 3:1. The second table measures
each fixed color against `surface.base` and `surface.baseAlternate` in both modes and
names the nearest token.

## 4. Fix or justify each finding

Replace each literal with the token for its role (the skill's `references/token-map.md`
lists them). Keep a color fixed only when it is mode-independent, such as a brand mark,
a data-chosen color, or a shadow. Comment why it is fixed, and confirm it passes against
what it sits on in both modes.

## 5. Scan the rendered pages in both modes

Use axe (`bun run accessibility:scan` in this repo, `@axe-core/playwright` in an app) on
each route in light and dark. Review `incomplete` results too: React Native Web often
reports contrast there. Then look at the screenshots for edges and focus rings that
disappear. Keyboard, focus, and semantics checks are covered in
[Test UI accessibility](test-ui-accessibility.md).
