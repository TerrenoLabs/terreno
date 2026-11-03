---
name: verify-ui-changes
description: >-
  Mandatory when any feature touches the frontend. Bring up a stack you own, log in,
  drive the change under the required checks (right page, not blank, no error overlay,
  console clean, DOM assertion, interaction proof, screenshot), run the repository's
  Maestro flows on the simulator for mobile-focused work (direct simulator commands when
  the app has no Maestro), and post screenshots and
  video to the PR or a secret gist in the report format. Lifecycle composition: Pick
  for implementation runtime checks, Roast for independent proof, and Taste after a
  UI-affecting review/CI fix.
claudecode:
  model: haiku
---

# Verify UI Changes

Use this skill automatically whenever a task changes UI behavior, UI layout, visual styling, component stories, navigation screens, user-visible copy, or any full-stack feature with a frontend surface.

If you made a user-facing change, you must run it, check that it actually works, and
show evidence. No evidence, no completion claim. A passing build, type check, or unit
test is necessary, not sufficient. **User-facing** is anything a user could notice:
components, screens, routes, navigation, styles, layout, responsive behavior, theming,
forms, validation, error / empty / loading states, copy, translations, API changes whose
output a client renders, emails, push, SMS, exported files. Pure refactors, internal
tooling, and backend-only changes with no rendered consumer are exempt, but say so:
"No user-facing change: <reason>".

## Trigger Files

Load this skill before validating changes to:

- `*.tsx`
- `*.jsx`
- `*.html`
- `*.css`
- `*.scss`
- `*.less`
- `*.styl`
- `*.vue`
- Story/demo files that render UI states
- Theme, layout, navigation, or component configuration that changes rendered UI
- Full-stack PRs that include any of the above, even when backend files dominate the diff

## The loop (every frontend-touching feature)

Do not open or update a PR for frontend work until this loop is complete.

1. **State the flow in one sentence** before testing:
   `<entry point> -> <user action or state> -> <expected visible result>`. For a general
   smoke: app loads -> first meaningful screen renders -> primary controls respond
   without errors.
2. **Get the app running on a stack you own** (package-specific sections below). If the
   backend or an app port is already taken by something you did not start, **stop and
   say which ports are taken**. Do not test through them and do not kill them: on a
   developer machine they are usually the simulators' Metros and a backend pointed at
   staging, and the checks could change staging data. When the repository ships a
   `verify-ui` stack script, use it; it refuses foreign ports for you.
3. **Write adversarial instructions, not happy-path ones.** Bad: "check that the form
   renders". Good: "submit empty, with an invalid email, with a wrong password, with
   valid credentials; assert each error message, the redirect, and the console". Cover
   the error, empty, disabled, and loading states the change touches. Drive the UI
   through `testID`s; if an element has none, add one to the component first
   (`{screen}-{element}-{qualifier}`), never a class or structural selector. As Roast's
   independent verifier, do not add it: report the missing `testID` (see "Who edits").
4. **Log in and exercise the changed feature** with the seeded accounts documented
   below: navigate to the affected screen and run the flow end to end, not just confirm
   the app or page loads. Visual or layout work gets a desktop and a phone viewport.
5. **Run the required checks** on every app × viewport run:

   | Check | Passing looks like |
   |---|---|
   | Right page | Final pathname is the expected one and is not the login page |
   | Not blank | ≥ 40 characters of visible text, not an empty shell or a stuck spinner |
   | No error overlay | No framework red box or compile-error text in the document |
   | Console clean | Zero console or page errors; warnings are listed for you to explain |
   | DOM assertion | ≥ 1 assertion on a visible element, text, or URL, all passed |
   | Interaction proof | ≥ 1 tap / type / key press, followed by an assertion of the new state |
   | Screenshot | ≥ 1 screenshot; take one of the failure state when a step fails |

   For visual or layout work also look at the phone run for clipping, overlap,
   unreadable text, bad wrapping, layout shift, missing assets, and z-index problems.
6. **Look at every screenshot.** Check the changed state actually rendered: not a
   spinner, not an empty state caused by seed data, not the login page. DOM assertions
   are primary; screenshots support visual claims, they do not replace them. A console
   error in the changed code path is a failure even when the shot looks right: explain
   it or fix it (see "Baselining console warnings" for the demo app).
7. **Mobile-focused change? Verify it on the simulator** (section below): the matching
   Maestro flow when the app has Maestro configured, direct simulator commands when it
   does not. Web alone is not enough.
8. **If anything fails: fix it and re-verify immediately.** Do not stop to report a
   half-working state. Retry a failing tool or UI action once before calling it a
   blocker. Repeat until zero failures. As Roast's independent verifier, do not fix:
   report FAIL with the evidence (see "Who edits").
9. **Publish and report** in the report format below: to the PR `Verification` table
   (see "GitHub Reviewer Evidence"), or to a secret gist when the repository's
   `verify-ui` publish script exists or there is no PR yet. Give the user the link plus
   the Result line.

## Simulator leg (mobile-focused changes)

Required when the change is native screens, gestures, navigation stacks, keyboard
behavior, safe areas, push, camera / permissions, auth storage, `*.ios.tsx`,
`*.android.tsx`, `*.native.tsx`, `Platform.OS` branches, or the ticket says "mobile" or
"app".

**Maestro configured** (the app has a `<app>/maestro/` directory with flows): verify with
those **Maestro** flows on the app's dedicated simulator, not with an ad-hoc tap script.
Run the flow that matches the change. No matching flow? Add one next to the existing
flows, reusing their launch and login subflows, with `testID` selectors and
`extendedWaitUntil` instead of sleeps; it is part of the change and stays in the
repository. Maestro configured but the CLI or Java missing: install them with the
repository's documented command, or report UNVERIFIED.

**Maestro not configured** (no `<app>/maestro/`): do not set Maestro up as part of the
change. Drive the simulator with direct commands instead, from a temporary script kept
outside the tree:

| Step | iOS simulator | Android emulator |
|---|---|---|
| Boot and install | `xcrun simctl boot <device>`, `xcrun simctl install booted <app>` | `emulator -avd <avd>`, `adb install <apk>` |
| Open the screen | `xcrun simctl openurl booted <scheme>://<path>` | `adb shell am start -a android.intent.action.VIEW -d <scheme>://<path>` |
| Tap and type | `idb ui tap <x> <y>`, `idb ui text "<text>"` | `adb shell input tap <x> <y>`, `adb shell input text "<text>"` |
| Assert | `idb ui describe-all` (find the `testID` and expected text) | `adb exec-out uiautomator dump /dev/tty` (find the `resource-id` and expected text) |
| Evidence | `xcrun simctl io booted screenshot <file>`, `xcrun simctl io booted recordVideo <file>` | `adb exec-out screencap -p > <file>`, `adb shell screenrecord <file>` |

Take tap coordinates from the accessibility tree, not from guesses. Assert on the tree
after each interaction; a screenshot alone is not an assertion. The same required checks
and outcomes apply. Without `idb`, iOS can only open screens and capture evidence, so an
iOS flow that needs taps is UNVERIFIED (`idb` missing) unless you install it.

A missing or stale dev client
(`Cannot find native module`) is rebuilt with the repository's documented command, then
the flow reruns. The flow deep-links the dev client to Metro, so Metro and the backend
must be the stack you started: "started by you" means the process you recorded is still
alive and holds the port, not that a pid file exists. A stack that crashed and was
followed by a developer's Metro or a backend on staging is not yours. If the simulator
or dev client is unavailable, the report says **UNVERIFIED (simulator)**; a passing web
check never stands in for the mobile one. Keep the three outcomes apart: a flow that ran
and failed is FAIL, a flow that never ran (stack not yours, no simulator or dev client,
simulator would not boot, Maestro, Java, or `idb` missing, no report written) is UNVERIFIED
with the blocker, and neither is ever reported as the other. A repository runner should
encode that in its exit codes (for example 2 for failed, 3 for UNVERIFIED). Also check
what web cannot: the keyboard does not cover inputs, safe areas, and the tablet vs
phone layout fork.

## Who edits

Only the implementer (Pick, or a Taste fix) changes the tree: adds `testID`s, adds
Maestro flows, and fixes failures. Roast's independent verifier (the `ui-verifier`
agent) runs the same loop report-only. A missing `testID` or Maestro flow, or a failing
check, is FAIL with the evidence; a check it could not run is UNVERIFIED with the
blocker. It never edits the tree to make a run pass.

## Evidence rules

- Seed or QA data only. Never screenshot, log, or paste real user data or PHI into
  evidence. Secret gists are unlisted, not private. If the only way to verify is against
  real data, stop and ask.
- Store screenshots, recordings, and temporary test scripts outside the committed source
  tree (`/opt/cursor/artifacts/` in Cursor Cloud, your scratchpad otherwise) unless the
  project specifies an evidence directory or the user asks for committed artifacts.
  Playwright scenarios and Maestro flows that document a feature may stay in the
  repository.
- If credentials are missing, ask for them. Never guess.

## When you can't verify

No browser tooling, app won't start, missing credentials, ports taken by a stack that is
not yours, needs a device: do not claim it works. Mark it **UNVERIFIED** with the exact
blocker and the commands or setup steps attempted, say what you did verify (build,
types, unit tests), give the reviewer the exact steps to verify themselves, and ask for
missing credentials rather than guessing. In the PR, that is one `⚠️ Not tested` row
naming the blocked behavior and the reviewer action, with decisive error detail in an
optional `<details>` block. Do not present compile-only or app-start-only checks as
complete verification.

## Package-Specific Manual Verification

### `@terreno/ui` component changes

Test UI package component changes only in the demo app.

1. Start the demo web app from the repo root:

   ```bash
   bun run demo:start
   ```

   Or from `demo/`:

   ```bash
   bun run web
   ```

   The demo runs on `http://localhost:8085`.

2. Open the developer-mode screen for the changed component:

   ```text
   http://localhost:8085/dev
   ```

3. Select the component and the most relevant story.
   - Direct URLs use the component name from `demo/demoConfig.tsx` and a story query param.
   - **The `?story=` value must exactly match a key of the `stories` object in
     `demo/story-config/<Component>.config.tsx`, URL-encoded.** These keys are human-readable
     display names, not slugs — e.g. `http://localhost:8085/dev/Button?story=Variants`, and they can
     contain spaces, which must be URL-encoded (`?story=Inline%20Feedback%20Prompt`).
     `demo/app/dev/[component].tsx` calls `router.replace("/dev")` only when `story` is absent or the
     component isn't in `demoConfig.tsx`; a *valid component with an unknown story* renders a **blank
     page** instead. Either way you get no error, so confirm the story actually rendered.
   - Use `/dev/<Component>?story=<Story>` to see one raw story full-screen.
   - Use `/demo/<Component>` when you need the **interactive prop controls**
     (`demoOptions.controls` — selects, booleans). Those controls render *only* on the `/demo`
     page, not on `/dev`. The `/demo` page also renders every story at the bottom, so it is the
     fastest way to see all states plus drive props from one screen.

4. Verify the changed state and at least one adjacent state that could regress.
   - For visual primitives: compare default, disabled, loading, icon, and full-width states when relevant.
   - For interactive components: click, type, open, close, hover, and keyboard navigate as appropriate.

5. When shipping a **new** `@terreno/ui` component or changing public props, also verify the generated docs page:
   - Run `cd ui && bun run types && bun run website:generate`
   - Check the docs deploy preview (or `bun run website:build` locally) for the component page and embedded demo iframe.

When the change is `LineChart`, `BarChart`, `AreaChart`, `DonutChart`, `DashboardGrid`, or
chart layout/paint helpers:

1. Run `bun run ui:charts:compare` (starts demo web on port 8085 unless it is already up).
2. If any fixture fails, follow the `review-chart-visuals` skill: open
   `demo/rendered-snapshots/<id>.png`, `demo/chart-visual-output/actual/<id>.png`, and
   `demo/chart-visual-output/diff/<id>.png` and describe the visual delta. Do not treat
   React test-renderer JSON snapshots as proof of chart paint.
   Operator steps: [Compare rendered chart snapshots](../../../../docs/how-to/compare-chart-rendered-snapshots.md).

Do not launch the example app to validate isolated `@terreno/ui` component changes unless the change also affects an app-level integration.

#### Driving the `/demo` prop controls

The controls are `@terreno/ui` `Field`s, **not native HTML inputs**:

- A `type: "select"` control renders a custom dropdown — there is **no `<select>` element**, so
  Playwright/CDP `selectOption`-style helpers do nothing. Click the field to open the option list,
  then click the option row. After opening, the field's `<input>` swaps its value for a
  `placeholder="Search..."`, which is a reliable signal that the list is open.
- A `type: "boolean"` control renders a toggle `<div>`; click it directly.

#### Objectively verifying icon fill, color, and icon family

Screenshots alone make solid-vs-outline and two similar greys hard to judge. Read computed styles
instead — both the Terreno `Icon` and `@expo/vector-icons` render **font glyphs**, so:

- **Which icon set is actually rendering** → computed `font-family` on the glyph element. This is
  the definitive check when a component migrates icon libraries: Terreno's `Icon` falls back to
  FontAwesome6 (`FontAwesome6Free-Solid` / `FontAwesome6Free-Regular`), whereas a direct
  `import Feather from "@expo/vector-icons/Feather"` reports `feather` and
  `import MaterialIcons from "@expo/vector-icons/MaterialIcons"` reports `material` (from
  `createIconSet(glyphMap, 'Material Icons', ...)` — the computed value is normalised, so don't
  expect the literal string `MaterialIcons`). Don't try to judge this from a screenshot — the
  glyphs look similar at small sizes. This whole procedure only applies to **font-backed** icons: a
  custom icon registered through `TerrenoProvider`'s icon registry takes precedence over the
  FontAwesome glyph set (`ui/src/Icon.tsx`) and may render SVG or any component, so probe its own
  markup rather than `font-family`.
- **Fill / `type` prop** (FontAwesome `Icon` only) → computed `font-family`:
  `FontAwesome6Free-Solid` for `type="solid"` vs `FontAwesome6Free-Regular` for `type="regular"`.
  Note that most `@expo/vector-icons` sets (Feather included) have **no solid variant**, so a
  component using them must signal selection some other way — usually a filled surface behind
  the glyph. When that is the design, verify the `backgroundColor` and `borderRadius` of the
  wrapping `Pressable` rather than the glyph's fill (see "Verifying a filled-surface selection
  cue" below).
- **Fill via a different icon *name*** (the strongest check, and the one to reach for with sets
  that ship paired outline/filled glyphs such as MaterialIcons' `thumb-up-off-alt` vs
  `thumb-up-alt`) → read the glyph element's **`textContent` codepoint**. `@expo/vector-icons`
  renders the icon as a single character from the icon font, so `el.textContent.codePointAt(0)`
  identifies exactly which icon name is rendering. Resolve the expected numbers from the shipped
  glyphmap so you are asserting against ground truth rather than a guess:

  ```bash
  # glyphmaps live under node_modules/**/@expo/vector-icons/build/vendor/.../glyphmaps/<Set>.json
  node -e 'const m=require("<path>/MaterialIcons.json");
    for (const n of ["thumb-up-off-alt","thumb-up-alt"]) console.log(n, m[n], "U+"+m[n].toString(16));'
  ```

  This matters because a broken name mapping still recolours correctly, so a colour-only check
  passes on a component whose fill never changes. Colour is not proof of fill; the codepoint is.
- **The icon font actually loaded** → a failed font load renders tofu boxes while the codepoint
  check still passes, so also assert `document.fonts.check('20px <family>')` and confirm the family
  appears with status `loaded` in `document.fonts`. To rule out fallback rendering, measure the
  glyph's advance width in the icon family versus a generic fallback family and check that they
  *differ* — icon glyphs are not guaranteed to be square, so treat a specific width (e.g. exactly
  20px) as a smell rather than a pass/fail rule, and prefer font-loading or network evidence. After a
  migration, assert the **probed glyph's** computed family is the new one; do not require the old
  family to be absent from `document.fonts`, since another element or an earlier mount in this SPA
  session can keep it registered.
- **Size** → computed `font-size` in px. `iconSizeToNumber` in `ui/src/Common.ts` maps
  `xs/sm/md/lg/xl/2xl` → `8/12/16/20/24/28`.
- **Color** → computed `color`, compared against `theme.text[...]` in `ui/src/Theme.tsx`.
  Watch out: the `text` color map and the surface/other maps use the **same token names for
  different primitives**. In the light theme `text.secondaryDark` is `secondary800` (`#092E3A`),
  **not** `secondary500` — always trace the map that the component actually reads
  (`Icon` uses `theme.text[color]`).

Read these from the icon element (the `Pressable`'s first element child), e.g. a one-shot probe
returning `{fontFamily, fontSize, color, disabled}` per button, and snapshot it before *and* after
each interaction. For a disabled no-op, assert the after-state is identical to the before-state,
then re-enable and repeat the same click to prove the hit target was live all along.

Measure geometry with the page at its default scale. Browser page zoom does *not* skew these
comparisons — `getBoundingClientRect()` and computed `font-size` are both CSS pixels — but a CDP
`Emulation.setPageScaleFactor`/`setDeviceMetricsOverride` scale factor or a pinch-zoomed
`visualViewport.scale` does change the mapping to device pixels. Record `window.devicePixelRatio`
and `visualViewport.scale` alongside the numbers you report so a mismatch is attributable.

#### Verifying a filled-surface selection cue (and its contrast)

When selection is shown by a background circle/pill instead of a glyph change, probe the
**`Pressable`** (not the glyph) for `backgroundColor` and `borderRadius`, and assert:

- selected → a concrete `rgb(...)` matching the intended `theme.surface[...]` token;
- unselected → `rgba(0, 0, 0, 0)` (transparent);
- `borderRadius` is exactly half the tap target at every size, otherwise it is a rounded square
  rather than a circle.

Also **compute contrast ratios from the rendered colors**, since a surface-only cue can be too
subtle where a solid-vs-outline cue never was. Walk up the DOM to find the first ancestor with a
non-transparent `backgroundColor` to get the real page background (the demo page surface is
`#F2F2F2`, not white), then apply the WCAG relative-luminance formula. Check both
glyph-on-surface (aim ≥4.5:1) and **surface-vs-page-background**, which WCAG 1.4.11 wants at ≥3:1
for a non-text state indicator — pale tokens like `secondary100` (`#B6CDD5`) land around 1.48:1 on
`#F2F2F2` and are worth flagging to design as a non-blocking observation. Muted-icon-on-`surface.disabled`
combinations tend to be ~2:1 grey-on-grey; that is cosmetic (disabled controls are exempt from
WCAG contrast) but still worth a screenshot and a note.

#### Verifying pixel geometry against a Figma spec

When a PR claims a component now matches a Figma frame, verify the numbers at **browser zoom 1**
and report what you actually measured rather than rounding to "matches":

- Glyph box → `getBoundingClientRect()` on the icon element; also cross-check computed `font-size`.
- Distance between two icons → measure **both** the tap-target centers and the glyph centers. If
  they disagree, the glyph is not centered in its pressable.
- Don't take a `gap` prop on trust: measure `next.left - prev.right` in the DOM. Terreno's spacing
  scale means `gap={2}` is 8px, so `24px target + 8px gap = 32px` between centers — verify that
  arithmetic instead of assuming it.
- Figma often specifies the gap between *icon boxes* while the DOM gap is between *tap targets*.
  With a 16px glyph in a 24px target these differ by 8px (16 vs 8) — both can be "correct" at once,
  so state which one you measured.

#### Painted ink vs the em box

`getBoundingClientRect()` on a glyph element returns the **em box** (equal to `font-size`), which is
not what a designer means by "the icon is 16px" — icon fonts pad their artwork inside the em box, so
a 20px MaterialIcons thumb paints about 16.5 x 14.9 px. When the spec is about the *visible* icon,
measure the ink:

1. **Screenshot pixel analysis (preferred).** Set `document.body.style.zoom = 8`, screenshot, compute
   the bounding box of non-background pixels, and divide by the zoom factor — validating that factor
   independently first (a known 32px centre distance should measure 256px).
2. **Canvas `TextMetrics`** — `measureText(glyph)` with `actualBoundingBoxLeft/Right/Ascent/Descent`
   in the normalized family at the same px size. Faster, but it rounds outward from the rasterized
   ink and can read 1-2px large. Use a **synchronous** IIFE; an async one returns an unserialized
   Promise (`{}`).

Report width and height separately. Icon glyphs are rarely square, so "make the ink exactly NxN" is
usually impossible with one font-size — give the font-size that satisfies each dimension and let the
author pick which one the Figma box is keyed to.

#### Flush (zero-gap) tap targets

When adjacent targets have no gap, assert `positive.right === negative.left` and a non-overlap check
rather than only the centre distance, and hit-test a few px either side of the shared edge with
`document.elementFromPoint` to prove neither target steals the other's clicks.

#### Prop tables come from generated TypeDoc, not the source

The demo Props table is rendered from `demo/ui-types-documentation.json` (mirrored into
`mcp-server/{src,dist}/docs/`). Those files are **git-ignored build output**, so a PR that removes or
renames a public prop in `ui/src/Common.ts` will still show the dead prop in a demo app started from
a stale copy. Regenerate with `bun run generate-types` in `demo/` before reading the Props table, and
report drift as a local staleness issue, not a missing commit.

Note `demoOptions.size` in `demo/story-config/*.config.tsx` is the demo *panel* sizing key used by
many configs — unrelated to a component's own `size` prop, and not stale metadata.

#### Traps when clicking small tap targets

Two things will silently produce bogus click results:

1. **Screenshot coordinates are not CSS coordinates.** The browser screenshot may be 1024px wide
   while `window.innerWidth` is 1600 (scale 0.64). If your click tool takes *screenshot-image*
   coordinates, multiply CSS coordinates by `screenshotWidth / innerWidth` first; Playwright/CDP
   `mouse.click` takes **viewport CSS pixels**, so pass `getBoundingClientRect()` values straight
   through and do NOT rescale. Know which space your tool uses — guessing wrong makes clicks land on
   nothing and look like a dead hit target.
2. **A fully-rounded pressable has a circular hit area.** With `borderRadius: tapTarget / 2` the
   bounding-box corners are not clickable — sweeping `document.elementFromPoint` over the box shows
   only ~84% of it hits the button. Always click the **center**, and if you need to characterise the
   real target, do the `elementFromPoint` pixel sweep rather than guessing.

Also probe the midpoint of the gap between two adjacent targets with `elementFromPoint`: if it
returns neither button, the hit areas don't touch and cannot steal each other's clicks. Compare the
tap-target size against WCAG 2.5.8 (24×24 CSS px); anything smaller may still pass via the spacing
exception if a 24px circle on each target wouldn't intersect the neighbour's, so report the number
rather than declaring a violation.

#### `accessibilityState.selected` does not reach the web DOM

react-native-web maps the `disabled` half of `accessibilityState` (you get `disabled` +
`tabindex="-1"`) but for `accessibilityRole="button"` it drops `selected` — no `aria-selected`,
`aria-pressed` or `aria-checked` is emitted. So a `Pressable` with
`accessibilityState={{selected: isSelected}}` renders a selected DOM node **identical** to an
unselected one apart from its content. Always verify this by dumping every attribute of both nodes
rather than trusting the source.

This matters most when a design unifies selected/unselected colors so glyph shape is the only visual
cue: there is then no non-visual cue at all, and docs claiming "selection is announced via
accessibility state" are false on web. The fix must be a **role-compatible** state: `aria-selected`
is only valid on selectable composite descendants (tab, option, row, gridcell), so it is wrong on a
button. Use `accessibilityRole="checkbox"` + `aria-checked` for a two-state control (see the
keyboard caveat below), or `aria-pressed` if a toggle-button role is available.

Confirmed root cause: `react-native-web` (checked at 0.21.2) only consumes **flat** props in
`dist/modules/createDOMProps/index.js` (`aria-checked`, `aria-selected`, `aria-disabled`, …) and
never reads `accessibilityState` at all. The `disabled` half only appears to work because
`Pressable`'s own `disabled` prop sets it through a separate path. Note RN 0.81 has no
`aria-pressed` prop and RNW has no mapping for `accessibilityRole="togglebutton"`, so
`accessibilityRole="checkbox"` + `aria-checked` is usually the only two-state option that is both
typed by RN and forwarded by RNW.

#### Changing `accessibilityRole` changes the rendered ELEMENT — always re-test the keyboard

This is the trap that a role fix is most likely to introduce, and no amount of attribute dumping
will catch it. RNW renders `accessibilityRole="button"` as a **real `<button type="button">`**
(verify on any Terreno `Button`: `/dev/Button?story=Variants` shows
`<button aria-label="…" type="button">`), so both **Space** and **Enter** activate it via browser
default with no JS. Any other role — `checkbox`, `switch`, `radio`, `tab` — renders a plain
`<div role="…" tabindex="0">`, where there is no browser default activation and RNW's Pressable
keyboard path wires **Enter only**. Switching `button` → `checkbox` therefore silently drops Space,
which for `role="checkbox"` is the canonical ARIA APG activation key (Enter isn't even required).

So after any `accessibilityRole` change, test with the real keyboard, not just clicks:

1. `Tab` to the control and confirm a visible focus ring.
2. Press **Space**; dump `aria-checked`/`aria-pressed` and the visible state.
3. Press **Enter**; dump again.
4. Report which keys actually toggle. If Space is dead on a `checkbox`/`switch`/`radio` role, that is
   a real keyboard-accessibility defect — suggest an explicit `onKeyDown` handling `" "` / `"Space"`
   with `preventDefault()` (to suppress page scroll), or backing the control with a real
   `<input type="checkbox">`.

When a component does add its own `onKeyDown`, check two things a native button gives you for free:
that Space does not scroll (test on a page with **real** scroll room and assert `scrollY`/`scrollTop`
is unchanged), and that a **held** key does not rapid-fire — `keydown` repeats while the key is down,
so the handler needs `if (event.repeat) return;`. A discrete-key-press harness cannot observe
auto-repeat, so read the source for the `event.repeat` guard rather than claiming it verified.

To decide whether it is a *regression* rather than pre-existing, read the previous commit's source
(`git show <prev>:path/to/Component.tsx | grep accessibility`) — if it used `accessibilityRole="button"`
it was a native button and Space used to work.

#### Baselining console warnings

The demo app emits pre-existing React-Native-Web deprecations on essentially every page
(`props.pointerEvents is deprecated`). Before blaming your component, load an unrelated component
page (e.g. `/demo/IconButton`) and diff the console output. Only warnings that appear on your page
and not the baseline are attributable to your change.

The `"shadow*" style props are deprecated. Use "boxShadow".` warning is fixed — `@terreno/ui` uses
`boxShadow` (see `createBoxShadow` in `ui/src/Utilities.tsx`) and `react-native-modalize` /
`react-native-actions-sheet` are patched in `patches/`. If it reappears, a new `shadow*` style prop
was introduced; do not re-add it to the baseline.

### `admin-frontend` and example app UI changes

Test `admin-frontend` changes in the example full-stack app.

1. Start the backend from the repo root:

   ```bash
   bun run backend:dev
   ```

   The backend runs on `http://localhost:4000`.

2. Seed login data in a separate terminal:

   ```bash
   cd example-backend && bun run seed
   ```

3. Start the frontend from the repo root:

   ```bash
   bun run frontend:web
   ```

   The frontend runs on `http://localhost:8082`.

4. Log in with the seeded admin account:
   - Email: `admin@example.com`
   - Password: `testpassword123`

5. Navigate to the changed admin screen.
   - Admin home: `http://localhost:8082/admin`
   - Model table: `http://localhost:8082/admin/<modelName>`
   - Configuration: `http://localhost:8082/admin/configuration`
   - Consent forms: `http://localhost:8082/admin/consent-forms`
   - Consent responses: `http://localhost:8082/admin/consent-responses`

6. Verify both the changed screen and the path that gets the user there.
   - For list/table changes: verify loading, populated, empty, pagination, sorting, and row navigation when applicable.
   - For form changes: verify create/edit validation, save loading, cancel/back navigation, and error handling.
   - For admin cards/navigation: verify the card appears, the label/copy is correct, and click navigation still works.

### Other frontend package changes

- `example-frontend` user-facing screens: use `bun run backend:dev`, `cd example-backend && bun run seed`, and `bun run frontend:web`, then log in with `test@example.com` / `testpassword123`, navigate to the changed feature, and exercise it.
- Demo-only story changes: use the demo app `/dev` route and the story being changed.
- Generated SDK or API-surface-only frontend changes: combine targeted automated checks with an example app login + feature smoke test when a rendered UI path is affected.

## Report format

Findings first when anything broke (what the user sees, repro, evidence, fix made or
open). Then **Result** (PASS / FAIL / UNVERIFIED, one line), **Flow under test**,
**Environment** (URLs, viewports, tool, database, commit), **Remaining risk**, and per
app × viewport: the checks table, the interaction steps, the DOM assertions, every
screenshot labelled, the recording, and the console log; then per simulator flow:
result, device, failure text, final screen, recording, log tail. Concise, but concrete
enough that a PR reviewer trusts it without re-running. **Result** is the worst outcome
across every required leg: any FAIL makes it FAIL, otherwise any UNVERIFIED leg makes it
UNVERIFIED. A required leg that did not run, such as the simulator for a mobile-focused
change, is UNVERIFIED with its blocker, never remaining risk. Only platforms the change
does not require go under remaining risk.

## GitHub Reviewer Evidence

Post UI verification evidence to GitHub through the PR body so reviewers can see it without local setup.

- Follow [`.github/PULL_REQUEST_TEMPLATE.md`](../../../../.github/PULL_REQUEST_TEMPLATE.md):
  one concise `Verification` row per exercised flow, naming the tested URL, the flow and
  state proved, and the Result line. Never include credentials.
- Save screenshots and videos under `/opt/cursor/artifacts` (or your scratchpad) and
  reference only decisive artifacts with HTML tags, e.g.
  `<video src="/opt/cursor/artifacts/admin_model_list_demo.mp4" controls></video>`.
  Use `RecordScreen` in Cursor Cloud for video walkthroughs.
- Use the PR management tool to create or update the PR body after artifacts exist.
  Without a tool that uploads files, or when `/opt/cursor/artifacts/` is missing or
  read-only, upload with the `attach-pr-media` skill and use the URLs it returns, or
  link the secret gist the repository's publish script created.
- Keep evidence minimal: one short video is preferred for interaction flows, plus one screenshot when it shows a static visual state more clearly.

## Rationalizations to reject

- "The build passes, so it works." Render it.
- "It's a one-line CSS change." Screenshot it, at phone width too.
- "I checked the happy path." Check error, empty, and loading states.
- "The screenshot looks right." Assert on the DOM as well.
- "There's a console error but it's probably unrelated." Explain it or fix it.
- "I'll mention it might need testing." Verify it or mark it UNVERIFIED.
- "It works on web, and it's React Native, so it works on the phone." Not for
  mobile-focused features. Run the Maestro flow, or direct simulator commands when the
  app has no Maestro, on the simulator.
- "Something is already on the port, I'll just use it." It may be staging. Stop and say
  the ports are taken.

## Cursor Cloud Notes

- Delegate GUI-driven verification to the `ui-verifier` subagent when your harness supports subagents; in Cursor Cloud, fall back to its built-in browser/GUI capability.
- For web apps on Bun 1.4+, use the documented [`terreno web`](../../docs/reference/cli.md#web-app-automation) flow to collect an agent-readable snapshot and final screenshot. This can prove static rendered state and complement the required GUI video for interaction flows.
- Use `RecordScreen` for user-facing video walkthroughs of interactive UI changes.
- Leave test servers running after verification so the user can continue testing.

## Final Response Checklist

- Lead with the Result line and the evidence link; include the decisive screenshot or
  video for UI changes.
- Prefix every command in the testing section with pass, warning, or fail status.
- Explain why each test or check was run, and which required checks each run passed.
- Mention any environment limitation only when it prevented expected UI verification,
  and then mark the affected flow UNVERIFIED with the blocker.
- Confirm PR evidence was posted or will be posted before the PR is opened/updated.

## Pixel Measurement: Derive the Screenshot Scale Empirically

When measuring painted ink (or any exact pixel geometry) from a zoomed screenshot, never assume
`saved screenshot px == zoom factor × CSS px`. The screenshot the harness writes to disk can be a
different size than the image it shows inline, and the browser window may have been resized between
runs.

Do this before dividing by the zoom factor:

1. Read `window.innerWidth` and compare it to the width of the saved PNG. If they are equal, one
   screenshot pixel is one CSS layout pixel and the zoom factor is the only divisor.
2. Cross-validate against a known layout pitch (e.g. two flush 32px targets must sit exactly
   `32 × zoom` screenshot px apart). If the pitch does not match, the scale assumption is wrong and
   every derived number is wrong.
3. Measure each glyph inside **its own element rect** (from `getBoundingClientRect()` at the same
   zoom), not across the whole image — otherwise adjacent labels and section bands leak into the
   bounding box.
4. Use the **modal colour of that sub-region** as the background reference rather than a hardcoded
   page background, and re-run the bbox at 2–3 thresholds (e.g. background delta > 10 / 30 / 60).
   A measurement that shifts with the threshold is an antialiasing artefact, not a result.
5. Report ink width and height separately per variant, plus the non-background pixel count — the
   count is what distinguishes a filled glyph from an outline glyph that shares the same bbox.
