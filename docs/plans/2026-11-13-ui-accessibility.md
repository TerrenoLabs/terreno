# Make @terreno/ui components accessible by default

`@terreno/ui` is the component library every Terreno app is built from, and its pitch is one codebase for iOS, Android and web. The 58.0.4 audit drove the demo app in Chromium and found that most controls are invisible to assistive technology: buttons have no role, checkboxes, switches, radios and tabs expose no state, every text field has the same name, toasts are silent, and modals lose the user's place. This plan fixes the semantics, names, state, focus, announcements, motion and touch targets of the existing components, and adds a browser test suite and a lint rule so they stay fixed. People using a screen reader, a keyboard or reduced motion feel the difference in every Terreno app without the app author writing any accessibility code. SelectField on web is planned separately in `ui-select-combobox`, because it is a rework of the picker.

## The idea

One contract, written once in `docs/explanation/ui-accessibility.md` and enforced in three places:

- **Props:** components use the real `role` prop plus `aria-*` state (React Native 0.88 maps both to native accessibility roles and state; React Native Web 0.21 renders them as ARIA). The invalid `aria-role` attribute (46 uses in 27 files, silently dropped on web because hyphenated JSX attributes are not type-checked) is removed and banned by a Biome plugin.
- **Web proof:** a new Playwright suite, `ui/e2e/accessibility/*.spec.ts`, runs against the demo's static export and asserts through `getByRole` and keyboard runs. It runs in CI in the job that already exports the demo.
- **Native proof:** unit tests assert the accessibility props each native host component receives, and five manual VoiceOver/TalkBack cases join the native regression suite. The audit was web-only, so nothing native is assumed.

No public prop is removed or renamed. Three things change for adopters, each following the audit's recommended fix, and the first two go to the owner at sign-off (Q1, Q2), as does the Box exception (Q4): `Heading` is exposed as a heading without a `level` prop; `Banner` shows a status icon by default; and on web React Native Web renders `role="button"` as a `<button>` element, `navigation` as `<nav>` and headings as `<h1>`–`<h6>` (its reset styles keep the look). Touch targets grow to 44 px as an invisible hit area, so no control changes size (Q3). A clickable `Box` gets no role by default, because Boxes wrap other buttons (Q4).

Rejected: growing the visual size of Button, IconButton and friends to 44 px. It reaches the same target size but shifts every adopter's layout in a patch release; it is parked as X2 for a major version. The Banner icon and heading levels are narrower: they do not resize or move controls across every screen, and each has a one-prop opt-out.

Rejected: fixing roles with `accessibilityRole` only. `role` + `aria-*` is one spelling for both platforms and is what the existing internal `LabeledCheckBox` already uses.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: accessibility browser suite, and IconButton gets a real button role | none | ui/e2e, ui/src/IconButton, CI smoke job, docs | Playwright: `getByRole("button")` finds the icon button and Space presses it |
| T2 | Replace every remaining `aria-role` with a real role | T1 | 26 files in ui/src, snapshots | Unit props + Playwright on three demo stories: no `aria-role`, no nested `<button>` |
| T3 | Ban `aria-role` with a Biome plugin | T2 | biome/plugins, package biome configs | A fixture file with `aria-role` fails `biome lint` |
| T4 | CheckBox becomes an interactive, labelled control | T2 | CheckBox, Common.ts, call sites | `getByRole("checkbox")` toggles with Space; `aria-checked` flips |
| T5 | BooleanField is a switch with state | T2 | BooleanField | `getByRole("switch", {name})` and `aria-checked` |
| T6 | RadioField is a radio group with checked state and a correct hint | T2 | RadioField, Radio | `getByRole("radiogroup")`, `radio` checked state; hint text |
| T7 | SegmentedControl exposes tabs and the selected tab | T2 | SegmentedControl | `getByRole("tab", {selected: true})` |
| T8 | Accordion trigger exposes expanded state and names its section | T2 | Accordion | `aria-expanded` flips; button named by title |
| T9 | Pagination is a labelled navigation with a current page | T2 | Pagination | "Previous page", "Page 3", `aria-current="page"`, bold current |
| T10 | Text fields are named by their title and announce helper and error text | T2 | TextField, fieldElements | `getByLabel(title)`; `aria-describedby` set with no `testID` |
| T11 | Toasts are announced on web, iOS and Android | T2 | ToastNotifications, Toast | `role="status"`/`alert` on web; native props and announce call |
| T12 | Modal has a name, sensible first focus, and returns focus | T2 | Modal | Dialog named by title; focus returns to the opener |
| T13 | Banner shows a status icon by default and announces itself | T4 | Banner | Icon visible without `hasIcon`; `role="status"`/`alert` |
| T14 | One reduced-motion hook used by every animated component | T5, T11 | new hook, 8 components | Unit: no animation when reduce motion is on; Playwright with emulated `prefers-reduced-motion` |
| T15 | 44 px hit area on default controls without changing layout | T6, T7, T8, T9, T12, T13, T14 | new helper, 9 components | Playwright: a click 5 px outside the visual edge presses; native `hitSlop` |
| T16 | Headings are headings by default | T13, T15 | Heading, Common.ts, 20 files with internal uses | `getByRole("heading", {level})` without a `level` prop |
| T17 | Reference docs, how-to, and changelog match what shipped | T3, T10, T15, T16 | docs, changelog | Docs checks pass; the accessibility suite is green end to end |

Tracer: component prop → compiled `@terreno/ui` → demo static export → real DOM in Chromium → `getByRole` + Space key, run by a new `ui` `test:e2e` script inside the CircleCI `smoke` job.
Chain reasons: T14 follows T5 and T11 because it rewrites the animation code in `BooleanField.tsx` and `ToastNotifications.tsx` that those tasks edit. T15 follows T6–T9, T12–T14 because it edits the pressables in the same files. T13 follows T4 and T16 follows T13 because all three edit `Common.ts`. T16 follows T15 because both edit `RadioField.tsx`, `Accordion.tsx` and `Modal.tsx`. The longest chain is T1 → T2 → T5 → T14 → T15 → T16 → T17; every link is a shared file, and T16 and T13's icon default can be dropped without touching another task if Q1 or Q2 is answered "no".
E2E: 13 specs (browser) under `ui/e2e/accessibility/`.
Regression: NATIVE-new-1 to NATIVE-new-5 → `docs/regression/ui-native.md` (screen-reader and reduce-motion behaviour on a device).
User guide: None — the guide covers the example app's features; no screen, label or step in it changes.
Design: None — no canvas; before-state screenshots are on PR #1705.
Out of scope: SelectField combobox (`ui-select-combobox`), visual 44 px sizes, arrow-key roving in tabs and radios, fields that own their `TextInput`, fonts, contrast, hard-coded colours, DataTable, prop aliases, new components (see Expansions).
Open risks: on web, controls that were `<div>`s become `<button>` elements, so adopter CSS or tests that select by tag change; the web hit-area overlay can sit over a neighbouring control when two targets are closer than 12 px; new roles change adopters' snapshot tests; default heading levels can produce a skipped-level outline in an adopter's page.
Elephant: nothing here is proven on a real phone until a person walks the five NATIVE cases with VoiceOver and TalkBack. The suite has `Last full run: never`, so native accessibility can ship "done" with only prop-level evidence.

## E2E tests

All specs are `browser` layer, live in `ui/e2e/accessibility/`, open demo stories at `/dev/<component>?story=Accessibility` from the static export, and run with `bun run --cwd ui test:e2e` (added in T1). They locate by `getByTestId` first and assert role, name and state with `getByRole` / `toHaveAttribute`, per `docs/testing/e2e.md`.

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `ui/e2e/accessibility/roles.spec.ts` | browser | An IconButton is a `button` with its accessible name, and Space presses it. After T2, three demo stories carry no `aria-role` attribute and no `<button>` nested in a `<button>`, and the modal close button is a `button` Space presses | T1, extended in T2 |
| E2 | `ui/e2e/accessibility/checkbox.spec.ts` | browser | A CheckBox with `onChange` is a `checkbox` named by its label; Space and click flip `aria-checked`; a disabled one does not change | T4 |
| E3 | `ui/e2e/accessibility/switch.spec.ts` | browser | A BooleanField is a `switch` named by its title; Space flips `aria-checked` | T5 |
| E4 | `ui/e2e/accessibility/radio.spec.ts` | browser | A RadioField is a `radiogroup` named by its title; one `radio` is checked; choosing another moves the checked state | T6 |
| E5 | `ui/e2e/accessibility/tabs.spec.ts` | browser | A SegmentedControl is a `tablist`; exactly one `tab` is selected; Space on another tab selects it | T7 |
| E6 | `ui/e2e/accessibility/accordion.spec.ts` | browser | The Accordion trigger is a `button` named by the title with `aria-expanded`; Enter collapses and the content leaves the page | T8 |
| E7 | `ui/e2e/accessibility/pagination.spec.ts` | browser | Pagination is a `navigation`; controls are named "Previous page", "Next page", "Page 3"; the current page has `aria-current="page"`; Previous is disabled on page 1 | T9 |
| E8 | `ui/e2e/accessibility/textField.spec.ts` | browser | A titled TextField with no `testID` is found by `getByLabel`; its `aria-describedby` resolves to the error text; two fields have different names | T10 |
| E9 | `ui/e2e/accessibility/toast.spec.ts` | browser | A success toast appears inside `role="status"`; an error toast inside `role="alert"` | T11 |
| E10 | `ui/e2e/accessibility/modal.spec.ts` | browser | The dialog is named by its title; focus starts inside the dialog, not on the backdrop; Escape returns focus to the opener; the close button is a `button` Space presses | T12 |
| E11 | `ui/e2e/accessibility/banner.spec.ts` | browser | A warning Banner with no `hasIcon` shows an icon and has `role="alert"`; an info Banner has `role="status"` | T13 |
| E12 | `ui/e2e/accessibility/motionAndTargets.spec.ts` | browser | With `prefers-reduced-motion: reduce` emulated, the page reports reduced motion and a toggled switch still reaches its final position; switching the emulation back is picked up live. A click 4 px above a default Button's visual edge presses it | T14, extended in T15 |
| E13 | `ui/e2e/accessibility/headings.spec.ts` | browser | Headings expose a level from their size without a `level` prop; `level="none"` is not a heading; a segmented control contains no heading | T16 |

## Regression cases

Destination: NATIVE → docs/regression/ui-native.md

These are operating-system screen-reader and motion behaviours. No layer in the e2e guide drives VoiceOver or TalkBack, and the repo has no device flows.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| NATIVE-new-1 | Controls announce role and state | On a phone running the demo app's development build with VoiceOver (iOS) or TalkBack (Android) on: open **Boolean field**, focus the switch, double-tap it; then open **CheckBox** → Accessibility and **Radio field** and focus one control on each | The switch is read as its title, "switch", and "on" or "off", and the state read changes after the double-tap. The checkbox is read as "checkbox, checked" or "not checked". A radio is read as "radio button" with "selected" on the chosen one | iOS, Android | E2–E4 cover web; manual on device | ui-accessibility |
| NATIVE-new-2 | A toast is spoken | Same build, screen reader on: open **Toast**, double-tap **Show success toast**, wait for it to clear, then double-tap **Show error toast** | Each toast's title is spoken once without moving screen-reader focus off the button. The error toast interrupts current speech | iOS, Android | E9 covers web; manual on device | ui-accessibility |
| NATIVE-new-3 | A modal takes and returns screen-reader focus | Same build, screen reader on: open **Modal**, double-tap **Open default modal**, swipe right through the sheet, then double-tap **Close modal** | When the sheet opens the screen reader reads its title, and swiping does not reach content behind the sheet. After closing, **Open default modal** can be reached and activated again | iOS, Android | E10 covers web; manual on device | ui-accessibility |
| NATIVE-new-4 | Reduce motion stops component animation | With Reduce Motion (iOS) or Remove animations (Android) turned on in system settings, in the same build: toggle a switch on **Boolean field**, show a toast on **Toast**, and open a modal on **Modal** | The switch thumb jumps to its new side, the toast appears and disappears without sliding, and the sheet appears without a slide. With the setting off, all three animate | iOS, Android | E12 covers web; manual on device | ui-accessibility |
| NATIVE-new-5 | Small controls are easy to hit | Same build, screen reader off: on **IconButton**, tap with a fingertip centred on the visible edge of a default icon button (about 1 mm outside it); on **Modal**, open a modal and tap right at the edge of the close "X" | Each tap presses the control: the icon button's action runs and the modal closes | iOS, Android | E12 covers web; manual on device | ui-accessibility |

## User guide

None — `docs/user-guide/` describes the example app's features in on-screen words (todos, account, admin, AI, documents). This plan changes how existing controls are exposed to assistive technology and adds a status icon to banners; no page's steps, labels or outcomes change. Developer-facing documentation is in T1 and T17.

## Design

None — no canvas. The audit's before-state screenshots are attached to PR #1705 and listed in `docs/audits/2026-11-12/ui-ux.md`: `kb-button-focus.png`, `kb-modal-open.png`, `kb-modal-focus.png`, `kb-textfield-focus.png`, `kb-toast.png`, `Banner-tall-light.png`, `CheckBox-desktop-light.png`, `Booleanfield-desktop-light.png`, `Radiofield-desktop-light.png`, `Segmentedcontrol-desktop-light.png`, `Accordion-desktop-light.png`, `Pagination-desktop-light.png`, `IconButton-mobile-light.png`, `Button-mobile-light.png`. T13 (Banner icon) and T9 (bold current page) are the only visible changes; each attaches an after screenshot of the same demo page in light and dark to the PR.

## Tasks

Conventions for every task:

- Unit tests are `ui/src/<Component>.test.tsx`, run with `bun test --only-failures <path>` from `ui/` (preload is configured), using `@testing-library/react-native`. They assert the props the host component receives. They cannot prove what the browser renders; the browser spec does that.
- Browser specs import the helpers T1 creates (`ui/e2e/helpers/demoExport.ts`) and run with `bun run compile && bun run --cwd demo export && bun run --cwd ui test:e2e`.
- Demo stories: each task adds a story keyed `Accessibility` to `demo/story-config/<Component>.config.tsx`, rendered by a component in `demo/stories/<Component>.stories.tsx`, with the testIDs its brief names. URL: `/dev/<config name>?story=Accessibility`.
- Web keyboard rule: React Native Web presses a `Pressable` on Space only for `role="button"`. Any other role (`checkbox`, `switch`, `radio`, `tab`) handles Space itself with the `onKeyDown` pattern in `ui/src/LabeledCheckBox.tsx:50-62`. T2 moves that handler to `ui/src/accessibility/pressOnSpace.ts`, and T4–T7 import it.
- State is always set twice, as `LabeledCheckBox.tsx:65-68` does: the `aria-*` attribute and the matching `accessibilityState` key (`checked`, `selected`, `expanded`, `disabled`). Unit cases below name the `aria-*` prop; assert the `accessibilityState` key with the same value in the same case.
- Each task runs the `accessibility-testing` skill on its story URL in light and dark (`bun run accessibility:scan`) and fixes violations on the nodes it changed. Contrast findings belong to `ui-polish`; name them in the PR, do not fix them.
- Supporting skills for every task: `accessibility-testing`, `terreno:verify-ui-changes`, `terreno:terreno-ui`, `terreno:terreno-frontend-tests`, `terreno:update-docs`.

- [ ] **T1** — Add the ui accessibility browser suite and give IconButton a real button role
  - Depends on: none
  - Files: ui/e2e/helpers/demoExport.ts, ui/e2e/accessibility.ts, ui/e2e/accessibility/roles.spec.ts, ui/e2e/smoke.spec.ts, ui/package.json, .circleci/continue-config.yml, scripts/ci/prepush/plan.ts, docs/testing/e2e/ui.md, docs/how-to/run-tests-locally.md, docs/explanation/ui-accessibility.md, ui/src/IconButton.tsx, ui/src/IconButton.test.tsx, demo/stories/IconButton.stories.tsx, demo/story-config/IconButton.config.tsx
  - Criteria:
    - `bun run --cwd ui test:e2e` serves `demo/dist/` on a free port and runs every `ui/e2e/accessibility/*.spec.ts` in Chromium; it exits 1 with "No demo web export" when `demo/dist/index.html` is missing. Verified by running it.
    - The static server and `openStory` helper live in `ui/e2e/helpers/demoExport.ts` and the existing smoke uses them; `bun run --cwd ui smoke` still passes.
    - The CircleCI `smoke` job runs `bun run --cwd ui test:e2e` after "Smoke every package"; `bun run check:circleci-parity` passes and `scripts/ci/prepush/plan.ts`'s `run-smoke` line names the new command.
    - `IconButton` renders `role="button"` (no `aria-role`). In Chromium, `getByRole("button", {name: "Save"})` resolves and Space runs its `onClick`.
    - `docs/explanation/ui-accessibility.md` exists and states the whole contract this IP implements: one table of component → role → state attributes → keyboard, the Space-key rule, the 44 px hit-area rule, the reduced-motion rule, heading levels, and how each is tested on web and native. `docs/testing/e2e/ui.md` gains an "Accessibility suite" section and a tier-table row.
  - Seam: the rendered demo story in Chromium (browser), plus `IconButton` rendered in a unit test
  - Interface: `bun run --cwd ui test:e2e` (script `bun e2e/accessibility.ts`); env `UI_E2E_BASE_URL` passed to specs; `openStory({page, component, story})` from `ui/e2e/helpers/demoExport.ts` waits for `demo-preview-root`. Story `IconButton` → `Accessibility` renders `<IconButton accessibilityLabel="Save" iconName="floppy-disk" onClick={...} testID="a11y-icon-button" />` and a `Text` with testID `a11y-icon-button-count` showing the press count, starting at `0`.
  - Cases:
    - unit: rendered IconButton's pressable has `role === "button"` and no `aria-role` prop; `aria-label === "Save"`
    - browser: `getByTestId("a11y-icon-button")` has attribute `role="button"`; `getByRole("button", {name: "Save"})` has count 1
    - browser: focus the button, press Space → `a11y-icon-button-count` text `1`; press Enter → `2`
    - browser: `page.locator("[aria-role]")` has count 0 on this story
    - driver: with `demo/dist` absent → exit code 1 and stderr contains `No demo web export`
  - Blast radius: `ui/e2e/smoke.spec.ts` reads the extracted helpers → `bun run --cwd ui smoke` is the case; knip must report no unused export (`bun run check:knip`)
  - Test skills: terreno-frontend-tests, accessibility-testing

- [ ] **T2** — Replace every remaining `aria-role` with a real role
  - Depends on: T1
  - Files: ui/src/Accordion.tsx, ui/src/ActionSheet.tsx, ui/src/Avatar.tsx, ui/src/Avatar.test.tsx, ui/src/Banner.tsx, ui/src/BooleanField.tsx, ui/src/Box.tsx, ui/src/CustomSelectField.tsx, ui/src/DateTimeActionSheet.tsx, ui/src/DismissButton.tsx, ui/src/DropdownPanel.tsx, ui/src/InfoModalIcon.tsx, ui/src/Link.tsx, ui/src/MobileAddressAutoComplete.tsx, ui/src/Modal.tsx, ui/src/MultiselectField.tsx, ui/src/PickerSelect.tsx, ui/src/RadioField.tsx, ui/src/SegmentedControl.tsx, ui/src/SelectBadge.tsx, ui/src/SocialLoginButton.tsx, ui/src/TextField.tsx, ui/src/Tooltip.tsx, ui/src/TypedSignatureField.tsx, ui/src/WebDropdownMenu.tsx, ui/src/WebDropdownMenu.test.tsx, ui/src/table/TableBoolean.tsx, ui/src/table/TableTitle.tsx, ui/src/LabeledCheckBox.tsx, ui/src/accessibility/pressOnSpace.ts, ui/src/accessibility/pressOnSpace.test.ts, ui/src/ariaRole.test.ts, ui/src/**/__snapshots__/*.snap (regenerated), ui/e2e/accessibility/roles.spec.ts
  - Criteria:
    - `grep -rn "aria-role" ui/src` returns nothing, including the 44 snapshot files that contain it today, which are regenerated and reviewed. `ui/src/ariaRole.test.ts` asserts it by reading every `.ts`, `.tsx` and `.snap` file under `ui/src`.
    - `pressOnSpace(handler)` in `ui/src/accessibility/pressOnSpace.ts` returns the `onKeyDown` props that call `handler` and `preventDefault` on `" "` or `"Spacebar"` and ignore other keys; `LabeledCheckBox` uses it.
    - Replacement follows this table exactly:

      | Old value | Where | New |
      | --- | --- | --- |
      | `button` (32 remaining) | every site except `Box` | `role="button"` |
      | `button` | `Box.tsx:523` (a `Box` with `onClick`) | no role. The attribute never did anything, and the comment at `Box.tsx:486-489` saying React Native translates `aria-role` is wrong. A default button role would nest `<button>` elements, because Boxes wrap other buttons. The existing explicit `accessibilityRole` prop still opts in. The comment is corrected. |
      | `checkbox` | `MultiselectField.tsx:36`, `table/TableBoolean.tsx:28` | `role="checkbox"` + `aria-checked={<its boolean>}` |
      | `combobox` | `CustomSelectField.tsx:78`, `MultiselectField.tsx:87` (non-interactive wrapper `View`s) | `role="group"`, label kept |
      | `image` | `Avatar.tsx:201`, `table/TableBoolean.tsx:53` | `role="img"` |
      | `header` | `table/TableTitle.tsx:14` | no role; drop the `aria-label` override so the visible title is the text |
      | `header`, `text` ×2 | `Modal.tsx:120,131,141` (title, subtitle, body wrappers) | no role, no `aria-label`, no hint: plain wrappers (T12 names the dialog, T16 gives the title a level) |
      | `adjustable` | `Modal.tsx:304` (native pull bar) | no role; hidden from assistive technology (`aria-hidden`, `importantForAccessibility="no-hide-descendants"`), since the close button offers the same action |

    - `Avatar.test.tsx` and `WebDropdownMenu.test.tsx` query `role`, not `aria-role`.
    - In Chromium, the three stories named in Cases have `[aria-role]` count 0 and `button button` count 0 (a tag selector, used because the assertion is about elements).
  - Seam: rendered components (unit) and rendered demo pages (browser)
  - Interface: no public prop changes. Unit tests read host props `role`, `aria-checked`, `aria-hidden`. `pressOnSpace(handler: () => void): {onKeyDown: (event) => void}`. The browser spec opens three existing stories with `openStory`: `Modal` → `Modals`, `Banner` → `Dismissible`, `Button` → `Variants`.
  - Cases:
    - unit `ariaRole.test.ts`: zero `.ts`, `.tsx` or `.snap` files under `ui/src` contain the string `aria-role` (excluding this test file)
    - unit `pressOnSpace`: key `" "` → handler called once and `preventDefault` called; key `"Enter"` → handler not called; `nativeEvent.key === " "` → handler called
    - unit: a `Box` with `onClick` has no `role` prop; with `accessibilityRole="button"` it has `accessibilityRole === "button"`; a `Box` with `onClick` wrapping a `Button` → pressing the inner button calls only the inner handler
    - unit: `DismissButton` pressable `role === "button"`; `Link` pressable `role === "button"`; Banner action pressable `role === "button"`
    - unit: `TableBoolean` with `isEditing` and `value: true` → `role === "checkbox"`, `aria-checked === true`; not editing → the icon wrapper `role === "img"`
    - unit: `Avatar` wrapper `role === "img"`, `aria-label === "<name>'s avatar"`
    - unit: `Modal` title wrapper has no `role` and no `aria-label` prop; native pull bar has `aria-hidden === true`
    - browser, on each of `Modal` → `Modals`, `Banner` → `Dismissible`, `Button` → `Variants`: `page.locator("[aria-role]")` count 0 and `page.locator("button button")` count 0
    - browser, `Modal` → `Modals`: click `modal-demo-open-default`; `getByTestId("modal-demo.dismiss")` has attribute `role="button"`; focus it and press Space → `modal-demo.title` count 0
  - Blast radius: adopters' snapshot tests change and pressables become `<button>` elements on web (both noted in the T17 changelog); `DataTable` reads `TableBoolean`/`TableTitle` → existing `DataTable` unit tests must stay green
  - Test skills: terreno-frontend-tests

- [ ] **T3** — Ban `aria-role` with a Biome plugin
  - Depends on: T2
  - Files: biome/plugins/no-aria-role.grit, ui/biome.jsonc, demo/biome.jsonc, example-frontend/biome.jsonc, admin-frontend/biome.jsonc, admin-spa/biome.jsonc, scripts/no-aria-role/plugin.test.ts, docs/explanation/ui-accessibility.md
  - Criteria:
    - A GritQL plugin, written like `biome/plugins/no-barrel-imports.grit`, reports an `error` on any JSX attribute named `aria-role` with the message "aria-role is not a React Native or ARIA attribute and is dropped on web. Use role (see docs/explanation/ui-accessibility.md)."
    - The plugin is listed in `plugins` of every package config that lints TSX: ui, demo, example-frontend, admin-frontend, admin-spa. `bun run lint` passes on the tree.
    - `docs/explanation/ui-accessibility.md` names the rule under "Enforcement".
  - Seam: `biome lint` as a child process on a fixture file
  - Interface: `bunx biome lint --config-path <ui dir> <fixture.tsx>` → non-zero exit and the message above when the fixture contains `<Pressable aria-role="button" />`; exit 0 for `<Pressable role="button" />`
  - Cases:
    - fixture `<Pressable aria-role="button" />` → exit ≠ 0, stdout/stderr contains `aria-role is not a React Native or ARIA attribute`
    - fixture `<View aria-role={someVar} />` → exit ≠ 0
    - fixture `<Pressable role="button" aria-label="x" />` → exit 0
    - fixture with the string `"aria-role"` in a comment or string literal only → exit 0
  - Blast radius: none
  - Test skills: none (Bun test spawning the Biome CLI; follow `scripts/check-source-rules/lib.test.ts` for layout)

- [ ] **T4** — Make CheckBox an interactive, labelled control
  - Depends on: T2
  - Files: ui/src/CheckBox.tsx, ui/src/CheckBox.test.tsx, ui/src/Common.ts, ui/src/LabeledCheckBox.tsx, ui/src/LabeledCheckBox.test.tsx, ui/src/ConsentFormScreen.tsx, ui/src/ConsentFormScreen.test.tsx, example-frontend/components/SyncTodosScreen.tsx, example-frontend/components/SyncTodosScreen.test.tsx, ui/src/login/TwoFactorChallengeScreen.tsx, ui/src/security/PasswordCard.tsx, ui/src/security/TwoFactorSettingsCard.tsx, ui/src/MultiselectField.tsx, ui/src/table/TableBoolean.tsx, demo/stories/CheckBox.stories.tsx, demo/story-config/CheckBox.config.tsx, ui/e2e/accessibility/checkbox.spec.ts
  - Criteria:
    - `CheckBoxProps` gains optional `onChange?: (selected: boolean) => void`, `label?: string`, `helperText?: string`, `disabled?: boolean`, `accessibilityLabel?: string`. With no `onChange`, CheckBox renders exactly as today (a decorative box, hidden from assistive technology with `aria-hidden`), so call sites that wrap it in their own pressable keep working.
    - With `onChange`, CheckBox is one pressable with `role="checkbox"`, `aria-checked`, `aria-disabled`, accessible name = `accessibilityLabel ?? label`, toggled by click, Enter and Space. `label` and `helperText` render next to the box as `LabeledCheckBox` does today.
    - `LabeledCheckBox.tsx` and its test file are deleted; the test's cases are ported to `CheckBox.test.tsx`. Its three call sites use `CheckBox` with `selected`/`onChange`/`label`. Their existing tests pass with the same testIDs.
    - The two wrapped checkboxes people meet first use the new API: the consent checkbox in `ui/src/ConsentFormScreen.tsx:292` and the todo checkbox in `example-frontend/components/SyncTodosScreen.tsx:139` become `CheckBox` with `onChange` and a label (the todo's title), keeping their testIDs. The remaining wrapped call sites (admin-frontend, `AppRolesList`, `blockRenderers`) are X9.
    - The checkbox pressables in `MultiselectField` and `TableBoolean` handle Space.
    - Development builds warn once (`console.warn`) when `onChange` is passed with neither `label` nor `accessibilityLabel`.
  - Seam: rendered `CheckBox` (unit) and demo story (browser)
  - Interface: `<CheckBox selected={boolean} onChange={(selected: boolean) => void} label="Trust this device" helperText? disabled? testID? />`. Story `CheckBox` → `Accessibility`: a controlled checkbox, `testID="a11y-checkbox"`, label "Trust this device", initially unchecked; a second, `testID="a11y-checkbox-disabled"`, label "Locked", `disabled`, unchecked.
  - Cases:
    - unit: no `onChange` → no element with `role === "checkbox"`; root has `aria-hidden === true`
    - unit: `onChange` + `selected: false` → pressable `role === "checkbox"`, `aria-checked === false`, `aria-label === "Trust this device"`; press → `onChange` called once with `true`
    - unit: `disabled` → press does not call `onChange`; `aria-disabled === true`
    - unit: `onChange` without `label`/`accessibilityLabel` → `console.warn` called once
    - unit `ConsentFormScreen`: the agreement checkbox has `role === "checkbox"` and `aria-checked === false`; pressing it sets `aria-checked === true`
    - unit `SyncTodosScreen` (example-frontend): a todo titled "Buy milk" renders an element with `role === "checkbox"` and `aria-label === "Buy milk"`
    - browser: `getByRole("checkbox", {name: "Trust this device"})` count 1, `aria-checked="false"`; focus + Space → `"true"`; click → `"false"`
    - browser: `a11y-checkbox-disabled` keeps `aria-checked="false"` after click and after Space
  - Blast radius: auth screens read `LabeledCheckBox` → their unit tests (`TwoFactorChallengeScreen`, `PasswordCard`, `TwoFactorSettingsCard`) must pass unchanged; admin-frontend and the other wrapped call sites pass no `onChange` → no change, covered by the "no onChange" unit case; `example-frontend/e2e` todo specs click the todo checkbox by testID → `bun run frontend:e2e` todos shard stays green
  - Test skills: terreno-frontend-tests

- [ ] **T5** — Expose BooleanField as a switch with state
  - Depends on: T2
  - Files: ui/src/BooleanField.tsx, ui/src/BooleanField.test.tsx, demo/stories/BooleanField.stories.tsx, demo/story-config/BooleanField.config.tsx, ui/e2e/accessibility/switch.spec.ts
  - Criteria: the pressable has `role="switch"`, `aria-checked={value}`, `aria-disabled={disabled}`, and accessible name = `title` (falls back to "Toggle" when there is no title). Space and Enter toggle on web. The visible "title" text is not announced twice. No prop changes.
  - Seam: rendered `BooleanField` (unit) and demo story (browser)
  - Interface: existing `BooleanFieldProps`. Story `Boolean field` → `Accessibility`: controlled field, `title="Email notifications"`, `testID="a11y-switch"`, initial `value: false`; second field `title="Locked"`, `disabled`, `value: true`, `testID="a11y-switch-disabled"`.
  - Cases:
    - unit: `value: true` → pressable `role === "switch"`, `aria-checked === true`, `aria-label === "Email notifications"`; press → `onChange(false)`
    - unit: `disabled` → press does not call `onChange`; `aria-disabled === true`
    - unit: no `title` → `aria-label === "Toggle"`
    - browser: `getByRole("switch", {name: "Email notifications"})` count 1 with `aria-checked="false"`; focus + Space → `"true"`; Enter → `"false"`
    - browser: the disabled switch keeps `aria-checked="true"` after click
  - Blast radius: `Field` and `FormContainer` render BooleanField → their unit tests stay green; switch testID `${testID}.switch` is unchanged
  - Test skills: terreno-frontend-tests

- [ ] **T6** — Expose RadioField as a radio group with checked state and a correct hint
  - Depends on: T2
  - Files: ui/src/RadioField.tsx, ui/src/RadioField.test.tsx, ui/src/Radio.tsx, demo/stories/RadioField.stories.tsx, demo/story-config/RadioField.config.tsx, ui/e2e/accessibility/radio.spec.ts
  - Criteria: the container has `role="radiogroup"` named by `title`. Each option is a pressable with `role="radio"`, `aria-checked`, name = `option.label ?? option.value`, and hint `Select <label> from list of options` (today it interpolates the option object and reads "[object Object]"). Space and Enter select. The decorative `Radio` circle is `aria-hidden`.
  - Seam: rendered `RadioField` (unit) and demo story (browser)
  - Interface: existing `RadioFieldProps`. Story `Radio field` → `Accessibility`: `title="Plan"`, options `[{label: "Free", value: "free"}, {label: "Pro", value: "pro"}]`, initial value `"free"`, wrapped in a `View testID="a11y-radio"`.
  - Cases:
    - unit: container `role === "radiogroup"`, `aria-label === "Plan"`
    - unit: two elements with `role === "radio"`; "Free" has `aria-checked === true`, "Pro" `false`
    - unit: the "Pro" option's `accessibilityHint === "Select Pro from list of options"`; an option with no label and value `"x"` → `"Select x from list of options"`
    - unit: press "Pro" → `onChange("pro")`
    - browser: `getByRole("radiogroup", {name: "Plan"})` count 1; `getByRole("radio", {name: "Free"})` is checked; focus "Pro" + Space → "Pro" checked and "Free" not
  - Blast radius: none (state stays in the consumer)
  - Test skills: terreno-frontend-tests

- [ ] **T7** — Expose SegmentedControl as tabs with a selected tab
  - Depends on: T2
  - Files: ui/src/SegmentedControl.tsx, ui/src/SegmentedControl.test.tsx, demo/stories/SegmentedControl.stories.tsx, demo/story-config/SegmentedControl.config.tsx, ui/e2e/accessibility/tabs.spec.ts
  - Criteria: the segment row has `role="tablist"`; each segment has `role="tab"`, `aria-selected`, and its item text as the name (a badge count is appended: "Inbox, 3"). Space and Enter select. The previous/next scroll pressables are `role="button"` named "Previous options" / "Next options" with `aria-disabled`. No prop changes; `onChange` stays index-based.
  - Seam: rendered `SegmentedControl` (unit) and demo story (browser)
  - Interface: existing `SegmentedControlProps`. Story `Segmented control` → `Accessibility`: `items={["Day", "Week", "Month"]}`, controlled, initial `selectedIndex: 0`, `testID="a11y-tabs"`.
  - Cases:
    - unit: one element `role === "tablist"`; three `role === "tab"`; index 0 `aria-selected === true`, others `false`
    - unit: press "Week" → `onChange(1)`
    - unit: with `badges` giving index 0 a count of 3 → tab 0 `aria-label === "Day, 3"`
    - unit: with `maxItems: 2` → scroll buttons have `role === "button"` and labels "Previous options" / "Next options"; previous has `aria-disabled === true` at the start
    - browser: `getByRole("tablist")` count 1; `getByRole("tab", {selected: true})` has text "Day"; focus "Month" + Space → selected tab text "Month", and exactly one tab is selected
  - Blast radius: none
  - Test skills: terreno-frontend-tests

- [ ] **T8** — Expose the Accordion's expanded state and name its trigger
  - Depends on: T2
  - Files: ui/src/Accordion.tsx, ui/src/Accordion.test.tsx, demo/stories/Accordion.stories.tsx, demo/story-config/Accordion.config.tsx, ui/e2e/accessibility/accordion.spec.ts
  - Criteria: the toggle pressable has `role="button"`, `aria-expanded={!collapsed}`, and name `title` (so it reads "Billing, expanded"). `aria-controls` points at the content region's id (from `useId`) while it is rendered. Toggle testID is unchanged (`${testID}.toggle` or `accordion-toggle`).
  - Seam: rendered `Accordion` (unit) and demo story (browser)
  - Interface: existing `AccordionProps`. Story `Accordion` → `Accessibility`: `title="Billing"`, `testID="a11y-accordion"`, child `<Text testID="a11y-accordion-content">Card ending 4242</Text>`, initially expanded.
  - Cases:
    - unit: expanded → toggle `aria-expanded === true`, `aria-label === "Billing"`; press → `aria-expanded === false`, `onToggle(true)` called, content not rendered
    - unit: `isCollapsed: true` → `aria-expanded === false` and no `aria-controls`
    - browser: `getByRole("button", {name: "Billing"})` has `aria-expanded="true"`; its `aria-controls` equals the id of the element containing `a11y-accordion-content`; focus + Enter → `aria-expanded="false"` and `a11y-accordion-content` count 0; Space → expanded again
  - Blast radius: none
  - Test skills: terreno-frontend-tests

- [ ] **T9** — Make Pagination a labelled navigation with a current page
  - Depends on: T2
  - Files: ui/src/Pagination.tsx, ui/src/Pagination.test.tsx, demo/stories/Pagination.stories.tsx, demo/story-config/Pagination.config.tsx, ui/e2e/accessibility/pagination.spec.ts
  - Criteria: the container has `role="navigation"` named "Pagination". Previous/next are `role="button"` named "Previous page" / "Next page" with `aria-disabled` at the ends. Each number is `role="button"` named "Page <n>"; the current one has `aria-current="page"` and bold text (weight, not only the accent colour). The "more" ellipsis is not a button: it is `aria-hidden` and not focusable. Hints "Click to go to …" are removed. Next does nothing on the last page.
  - Seam: rendered `Pagination` (unit) and demo story (browser)
  - Interface: existing `PaginationProps` (`totalPages`, `page`, `setPage`, `testID`). Story `Pagination` → `Accessibility`: controlled, `totalPages={10}`, initial `page={1}`, `testID="a11y-pagination"`.
  - Cases:
    - unit: `page: 3, totalPages: 10` → container `role === "navigation"`, `aria-label === "Pagination"`; element labelled "Page 3" has `aria-current === "page"`; "Page 1" has none
    - unit: `page: 1` → "Previous page" `aria-disabled === true`; press → `setPage` not called
    - unit: `page: 10, totalPages: 10` → "Next page" `aria-disabled === true`; press → `setPage` not called
    - unit: `page: 5, totalPages: 10` → no element with `role === "button"` has the ellipsis; the ellipsis wrapper has `aria-hidden === true`
    - unit: press "Page 2" → `setPage(2)`
    - browser: `getByRole("navigation", {name: "Pagination"})` count 1; `getByRole("button", {name: "Previous page"})` is disabled; `getByRole("button", {name: "Page 1"})` has `aria-current="page"`; click "Next page" → "Page 2" has `aria-current="page"` and "Page 1" does not
  - Blast radius: `DataTable` renders `Pagination` → its unit tests that find pagination controls by label "Pagination Button"/"Pagination Number" are updated here if any exist (`grep -rn "Pagination Button\|Pagination Number"` across the repo and fix every hit, including admin-frontend and example-frontend e2e)
  - Test skills: terreno-frontend-tests

- [ ] **T10** — Name text fields by their title and link helper and error text
  - Depends on: T2
  - Files: ui/src/TextField.tsx, ui/src/TextField.test.tsx, ui/src/fieldElements/FieldTitle.tsx, ui/src/fieldElements/FieldHelperText.tsx, ui/src/fieldElements/FieldError.tsx, ui/src/fieldElements/useFieldAccessibility.ts, ui/src/fieldElements/useFieldAccessibility.test.tsx, demo/stories/TextField.stories.tsx, demo/story-config/TextField.config.tsx, ui/e2e/accessibility/textField.spec.ts
  - Criteria:
    - A new hook `useFieldAccessibility({title, helperText, errorText, accessibilityLabel})` returns `{titleId, helperId, errorId, inputProps}` with ids from React `useId`. `inputProps` is `{"aria-label": accessibilityLabel ?? title ?? "Text input field", "aria-labelledby"?: titleId (web, when there is a title and no accessibilityLabel), "aria-describedby"?: space-joined ids of the rendered error then helper, "aria-invalid": Boolean(errorText)}`.
    - `FieldTitle`, `FieldHelperText` and `FieldError` accept `nativeID` and render it; `FieldError` no longer uses `testID` as its `nativeID`.
    - `TextField` uses the hook. With or without a `testID`, an error-state input's `aria-describedby` resolves to the error text. `testID`s resolve exactly as before.
    - `accessibilityHint="Enter text here"` is removed (it repeats on every field).
    - Every component that renders `TextField` (NumberField, EmailField, PhoneNumberField, TextArea and the rest) inherits this with no edit.
  - Seam: the hook (unit), rendered `TextField` (unit), demo story (browser)
  - Interface: as above. Story `Text field` → `Accessibility`, none of the fields has a `testID`; the wrapper `View` has `testID="a11y-text-fields"`: field A `title="First name"`; field B `title="Email"`, `errorText="Enter a valid email"`, `helperText="We never share it"`; field C no title, `accessibilityLabel="Search"`.
  - Cases:
    - hook: `{title: "Email"}` → `inputProps["aria-label"] === "Email"`, `aria-invalid === false`, no `aria-describedby`
    - hook: `{title: "Email", errorText: "Bad", helperText: "Hint"}` → `aria-describedby === "<errorId> <helperId>"`, `aria-invalid === true`
    - hook: `{}` → `aria-label === "Text input field"`; `{title: "Email", accessibilityLabel: "Work email"}` → `"Work email"`
    - hook: two instances → different `titleId`s
    - unit: `TextField` with `title="Email"`, `errorText="Bad"`, no `testID` → the `TextInput`'s `aria-describedby` equals the `nativeID` of the rendered `FieldError`
    - unit: `TextField` with `testID="login.email"` → error element still has testID `login.email.error`
    - browser: inside `a11y-text-fields`, `getByLabel("First name")` count 1; `getByLabel("Email")` count 1 with `aria-invalid="true"`; the element whose id equals the first token of its `aria-describedby` has text "Enter a valid email"; `getByLabel("Search")` count 1
  - Blast radius: every TextField wrapper → `bun run --cwd ui test:ci` stays green; snapshots under `ui/src/fieldElements/__snapshots__` are regenerated and reviewed; example-frontend and admin-spa Playwright suites that locate inputs by `getByLabel("Text input field")` (grep for the string across the repo) are fixed here
  - Test skills: terreno-frontend-tests

- [ ] **T11** — Announce toasts on web, iOS and Android
  - Depends on: T2
  - Files: ui/src/ToastNotifications.tsx, ui/src/ToastNotifications.test.tsx, ui/src/Toast.tsx, ui/src/Toast.test.tsx, demo/stories/Toast.stories.tsx, demo/story-config/Toast.config.tsx, ui/e2e/accessibility/toast.spec.ts
  - Criteria:
    - Politeness map: `error` and `warning` → assertive; `info`, `success` and no variant → polite.
    - Web: the toast container that is always mounted holds two live regions, `role="status"` + `aria-live="polite"` and `role="alert"` + `aria-live="assertive"`, both `aria-atomic`. Each toast renders inside the region its variant maps to, so it is announced on insert.
    - Android: the toast view sets `accessibilityLiveRegion` to `"polite"` or `"assertive"`.
    - iOS: showing a toast calls `AccessibilityInfo.announceForAccessibility("<title>. <subtitle>")` once (title only when there is no subtitle).
    - Custom `renderToast`/`renderType` output is wrapped the same way.
  - Seam: `useToast().show` through `ToastProvider` (unit, with `Platform.OS` set per case) and the demo story (browser)
  - Interface: existing `useToast()` API: `show(title, {variant, subtitle})`, `success`, `error`, `warn`, `info`. Story `Toast` → `Accessibility`: buttons `testID="a11y-toast-success"` (shows success toast "Saved") and `testID="a11y-toast-error"` (shows error toast "Could not save").
  - Cases:
    - unit, `Platform.OS = "ios"`: `show("Saved", {variant: "success"})` → `AccessibilityInfo.announceForAccessibility` called once with `"Saved"`; with `subtitle: "All changes stored"` → `"Saved. All changes stored"`
    - unit, `Platform.OS = "android"`: success toast view has `accessibilityLiveRegion === "polite"`; error toast `"assertive"`; `announceForAccessibility` not called
    - unit, `Platform.OS = "web"`: with no toast shown, elements with `role === "status"` and `role === "alert"` both exist and are empty; `announceForAccessibility` not called
    - unit: `warning` → assertive; no variant → polite
    - browser: before any click `getByRole("status")` and `getByRole("alert")` each have count 1; click `a11y-toast-success` → `getByRole("status")` contains text "Saved" and `getByRole("alert")` does not; click `a11y-toast-error` → `getByRole("alert")` contains "Could not save"
  - Blast radius: `ui/src/ToastNotifications.webModal.test.tsx` (toasts above an open modal) must stay green; `toast.catch` callers are unaffected (same API)
  - Test skills: terreno-frontend-tests

- [ ] **T12** — Give Modal a name, a sensible first focus, and focus return
  - Depends on: T2
  - Files: ui/src/Modal.tsx, ui/src/Modal.test.tsx, demo/stories/Modal.stories.tsx, demo/story-config/Modal.config.tsx, ui/e2e/accessibility/modal.spec.ts, ui/e2e/smoke.spec.ts
  - Criteria:
    - Web: the element with `role="dialog"` has `aria-labelledby` pointing at the title's id (`useId`) when `title` is set, otherwise `aria-label="Dialog"`. React Native Web's `Modal` forwards unknown props to the dialog element (`react-native-web/dist/exports/Modal/index.js:63,93`), so the attributes are passed to `RNModal`.
    - Web: the backdrop is not focusable and has no role (`tabIndex={-1}`, `aria-hidden` is not used because it would hide the dialog inside it; the backdrop press handler moves to a sibling layer behind the content). First focus always lands on the modal content container (the element with `modalTestIDs.root`, given `tabIndex={-1}`), so a screen reader reads the dialog's name and the first Tab reaches the first control. The blur at `Modal.tsx:241-250` stays (it prevents the aria-hidden warning); the opener is recorded before it.
    - Reproduce first: the task logs `document.activeElement` when the opener is pressed, after open, and after Escape, and records the result in the PR. The audit saw focus end on `<body>`; whether Terreno's blur runs before React Native Web records the opener depends on effect order and was not confirmed for this plan.
    - Web: the modal records `document.activeElement` during the render in which `visible` becomes true (before any effect, including the existing blur at `Modal.tsx:241-250`); when `visible` goes false or the modal unmounts, it focuses that element if it is still in the document.
    - Native: the sheet content sets `accessibilityViewIsModal` (iOS) and `importantForAccessibility="yes"` with the title as its `accessibilityLabel`.
    - The close control is `role="button"` named "Close modal". testIDs are unchanged.
  - Seam: rendered `Modal` (unit) and demo story (browser)
  - Interface: existing `ModalProps`. Story `Modal` → `Accessibility`: `Button testID="a11y-modal-open"` text "Open"; modal `testID="a11y-modal"`, `title="Delete todo"`, `primaryButtonText="Delete"`, `secondaryButtonText="Cancel"`. A second opener `a11y-modal-open-untitled` opens a modal with no title and one child `Text`.
  - Cases:
    - unit (web platform mock): `RNModal` receives `aria-labelledby` equal to the title element's `nativeID`; untitled → `aria-label === "Dialog"`
    - unit: backdrop pressable has `tabIndex === -1` and no `role`
    - unit (native platform mock): content root has `accessibilityViewIsModal === true` and `accessibilityLabel === "Delete todo"`
    - browser: click `a11y-modal-open` → `getByRole("dialog", {name: "Delete todo"})` count 1; `document.activeElement` is the modal content container (`getByTestId("a11y-modal")`, the root test id), not the backdrop
    - browser: Tab 6 times → focus never leaves the dialog, and after the first Tab every focused element has `role="button"`
    - browser: Escape → dialog count 0 and `a11y-modal-open` is focused; reopen, press `a11y-modal.primary` → `a11y-modal-open` is focused
    - browser: untitled modal → `getByRole("dialog", {name: "Dialog"})` count 1 and focus is on the modal content container
  - Blast radius: `IconButton` confirmation modal, `InfoModalIcon`, `GPTMemoryModal` and every screen with a modal read `Modal` → their unit tests stay green; the ui smoke's Modal step (`modal-demo.title`, `modal-demo.primary`) must still pass; `ToastNotifications.webModal.test.tsx` stays green
  - Test skills: terreno-frontend-tests

- [ ] **T13** — Show a status icon on Banner by default and announce it
  - Depends on: T4
  - Files: ui/src/Banner.tsx, ui/src/Banner.test.tsx, ui/src/Common.ts, demo/stories/Banner.stories.tsx, demo/story-config/Banner.config.tsx, ui/e2e/accessibility/banner.spec.ts
  - Criteria: `hasIcon` defaults to `true` (was `false`); `hasIcon={false}` still hides it. The icon is decorative (`aria-hidden`); the banner's name starts with the status word: "Info", "Warning" or "Alert". `status="info"` → `role="status"`; `warning` and `alert` → `role="alert"`. The action stays a separate `role="button"`. The dismiss button is named "Dismiss". The prop's doc comment in `Common.ts` records the new default.
  - Seam: rendered `Banner` (unit) and demo story (browser)
  - Interface: existing `BannerProps`. Story `Banner` → `Accessibility`: `<Banner id="a11y-info" status="info" text="Sync is paused" />` in `View testID="a11y-banner-info"`; `<Banner id="a11y-warning" status="warning" text="Storage almost full" />` in `View testID="a11y-banner-warning"`; `<Banner id="a11y-plain" status="alert" text="Offline" hasIcon={false} />` in `View testID="a11y-banner-plain"`.
  - Cases:
    - unit: no `hasIcon` prop → an icon element is rendered with `aria-hidden === true`; `hasIcon: false` → none
    - unit: `status: "info"` → root `role === "status"`, `aria-label === "Info: Sync is paused"`; `warning` → `role === "alert"`, `"Warning: Storage almost full"`; `alert` → `"Alert: Offline"`
    - browser: within `a11y-banner-warning`, `getByRole("alert")` count 1 and an `svg` or icon font glyph is visible; within `a11y-banner-info`, `getByRole("status")` count 1; within `a11y-banner-plain`, `getByRole("alert")` count 1 and no icon element
  - Blast radius: `OfflineBanner`, `SyncStatusBanner`, `WhatsNewBanner` and `UpgradeBanner`-style wrappers render `Banner` → their unit tests and snapshots are updated here; example-frontend screens gain an icon (visible change, recorded in T17's changelog). T13 depends on T4 only because both write `Common.ts`.
  - Test skills: terreno-frontend-tests

- [ ] **T14** — Add one reduced-motion hook and use it in every animated component
  - Depends on: T5, T11
  - Files: ui/src/useReducedMotion.ts, ui/src/useReducedMotion.test.tsx, ui/src/index.tsx, ui/src/Skeleton.tsx, ui/src/Button.tsx, ui/src/ActionSheet.tsx, ui/src/ModalSheet.tsx, ui/src/ToastNotifications.tsx, ui/src/BooleanField.tsx, ui/src/DraggableList.tsx, ui/src/SidebarNavigation.native.tsx, ui/src/Button.test.tsx, ui/src/BooleanField.test.tsx, ui/src/ToastNotifications.test.tsx, ui/src/ActionSheet.test.tsx, ui/src/ModalSheet.test.tsx, ui/src/DraggableList.test.tsx, ui/src/SidebarNavigation.test.tsx, demo/stories/BooleanField.stories.tsx, ui/e2e/accessibility/motionAndTargets.spec.ts
  - Criteria:
    - `useReducedMotion(): boolean` is exported from `@terreno/ui`. It is the hook now private to `Skeleton.tsx:66-100`, moved unchanged in behaviour: `AccessibilityInfo.isReduceMotionEnabled()` plus the `reduceMotionChanged` event, and on web `matchMedia("(prefers-reduced-motion: reduce)")` including its `change` event (the web listener is new). `Skeleton` imports it.
    - When it returns `true`: Button press animation is `none`; BooleanField, ToastNotifications, ActionSheet and ModalSheet set their animated values directly with no timing or spring (`duration: 0`); DraggableList and native SidebarNavigation skip their layout/slide transitions. State changes still happen.
    - `ActionSheet` is a class component: it reads the flag through a function-component wrapper prop, not a hook call inside the class.
  - Seam: the hook (unit) and each component rendered with the hook mocked (unit); demo story with Playwright `reducedMotion` (browser)
  - Interface: `import {useReducedMotion} from "@terreno/ui"`. Tests mock `AccessibilityInfo.isReduceMotionEnabled` to resolve `true` (see `ui/src/bunSetup.ts:423`). The `Boolean field` → `Accessibility` story from T5 gains `Text testID="a11y-reduced-motion"` rendering `reduced` or `full` from `useReducedMotion()`. The browser spec switches the setting with `page.emulateMedia({reducedMotion})`.
  - Cases:
    - hook: `isReduceMotionEnabled` resolves `true` → returns `true` after the effect; emits `reduceMotionChanged` `false` → returns `false`
    - hook (web): `matchMedia` matches → initial value `true`; `change` event with `matches: false` → `false`
    - unit Button: reduced motion on → the rendered pressable is not the scale-animation pressable (press animation resolves to `"none"`)
    - unit BooleanField: reduced motion on → after toggling, `Animated.spring` and `Animated.timing` are not called and the thumb's animated value equals its final value synchronously
    - unit ToastNotifications: reduced motion on → `Animated.timing`/`spring` called with `duration: 0` or not at all, and the toast is visible
    - unit ActionSheet: rendered through its wrapper with reduced motion on, `setModalVisible(true)` → the sheet content is rendered and `Animated.timing`/`Animated.spring` are called with `duration: 0` or not at all; with reduced motion off they are called with a non-zero duration (today's behaviour)
    - unit ModalSheet: reduced motion on, `visible: true` → content rendered and its animated value equals the open value synchronously
    - unit DraggableList: reduced motion on → item animated style uses no `withTiming`/`withSpring` transition (the reorder callback still fires with the new order)
    - unit SidebarNavigation (native file): reduced motion on, toggle open → `Animated.timing` not called with a non-zero duration and the drawer is rendered open
    - browser: `emulateMedia({reducedMotion: "reduce"})` → `a11y-reduced-motion` has text `reduced`; `emulateMedia({reducedMotion: "no-preference"})` without reloading → text `full` (the `change` listener works)
    - browser, reduced: click `a11y-switch` → `aria-checked="true"` and, with `expect.poll`, the thumb's bounding-box x is greater than before the click (the state change still happens). No fixed waits.
  - Blast radius: `Skeleton` reads the moved hook → `Skeleton.test.tsx` stays green; `ui/src/index.tsx` gains one export → `bun run check:knip` and the import benchmark budget (`performance:imports`) stay within limits
  - Test skills: terreno-frontend-tests

- [ ] **T15** — Give default controls a 44 px hit area without changing layout
  - Depends on: T6, T7, T8, T9, T12, T13, T14
  - Files: ui/src/accessibility/touchTarget.tsx, ui/src/accessibility/touchTarget.test.tsx, ui/src/Button.tsx, ui/src/IconButton.tsx, ui/src/Pagination.tsx, ui/src/Radio.tsx, ui/src/RadioField.tsx, ui/src/Accordion.tsx, ui/src/Banner.tsx, ui/src/Modal.tsx, ui/src/DismissButton.tsx, ui/src/DateTimeField.tsx, ui/src/Button.test.tsx, ui/src/IconButton.test.tsx, demo/stories/Button.stories.tsx, demo/story-config/Button.config.tsx, ui/e2e/accessibility/motionAndTargets.spec.ts
  - Criteria:
    - `touchTargetSlop({width, height}): {top, bottom, left, right}` returns `Math.max(0, Math.ceil((44 - size) / 2))` per axis (an unknown dimension gives 0 on that axis). `MIN_TOUCH_TARGET = 44`.
    - Native: each control below passes that slop as `hitSlop`. Web (React Native Web's `Pressable` ignores `hitSlop`): the control renders `<TouchTargetOverlay slop={...} />` as its last child, an `aria-hidden`, absolutely positioned, transparent `View` that extends past the control by the slop, so a click in the extended area bubbles to the pressable. The control's own box, and every adopter's layout, is unchanged.
    - Controls and resulting hit areas: Button default (34 high → 44), Button `sm` (28 → 44), IconButton default (32 → 44×44) and `sm` (28 → 44×44), Pagination buttons (32 → 44 high; width stays 32 so neighbours do not overlap), Radio option row (16 → 44 high), Accordion toggle (16 → 44×44; replaces the `hitSlop` that never worked on web), Banner action (24 → 44 high), Modal close (→ 44×44), DismissButton (24.5 → 44×44), DateTimeField calendar toggle (→ 44×44).
    - SegmentedControl is not changed: its segments are clipped by the rounded track (`overflow: "hidden"`), `md` is 36 px (above the WCAG 2.2 AA 24 px minimum) and `lg` is already 44 px. The explanation page says so.
    - No visual change: a screenshot of the Button demo page before and after is pixel-identical at 1280×800 (attach both to the PR).
  - Seam: the helper (unit), rendered controls (unit, native and web platform mocks), demo story (browser)
  - Interface: `touchTargetSlop({height: 32, width: 32})` → `{top: 6, bottom: 6, left: 6, right: 6}`; `<TouchTargetOverlay slop={{top, bottom, left, right}} />`. Story `Button` → `Accessibility`: one default `Button text="Save" testID="a11y-target-button"` with 60 px of empty space on every side, and `Text testID="a11y-target-count"` showing its press count from `0`; one default `IconButton testID="a11y-target-icon"` with the same spacing and `a11y-target-icon-count`; and a row of two default IconButtons 8 px apart, `a11y-target-pair-a` and `a11y-target-pair-b`, with counts `a11y-target-pair-a-count` and `a11y-target-pair-b-count`. Overlap rule: where two hit areas overlap, the later sibling wins; a click inside a control's own visible box always goes to that control.
  - Cases:
    - helper: `{height: 34}` → `{top: 5, bottom: 5, left: 0, right: 0}`; `{height: 28, width: 28}` → all 8; `{height: 44, width: 60}` → all 0; `{height: 16, width: 16}` → all 14
    - unit (native mock): default `IconButton` pressable `hitSlop` deep-equals `{top: 6, bottom: 6, left: 6, right: 6}`; `size="sm"` → all 8; default `Button` → `{top: 5, bottom: 5, left: 0, right: 0}`
    - unit (web mock): default `IconButton` renders one overlay child with `aria-hidden === true` and style `top: -6, bottom: -6, left: -6, right: -6`, `position: "absolute"`; no `hitSlop` prop
    - browser: read `a11y-target-button`'s bounding box; `page.mouse.click` at (centre x, top − 4) → `a11y-target-count` is `1`; click at (centre x, top − 12) → still `1`
    - browser: `a11y-target-icon` box is 32×32 (unchanged); click at (left − 5, centre y) → `a11y-target-icon-count` is `1`
    - browser: `a11y-target-button`'s bounding box height is less than 44 (layout unchanged) while the click 4 px above it presses
    - unit: the overlay sets no `pointerEvents` inline (React Native Web drops it from inline styles; see `.rulesync` ui rules)
    - browser: click the centre of `a11y-target-pair-a` → a-count `1`, b-count `0`; click the centre of `a11y-target-pair-b` → b-count `1`, a-count `1`; click 1 px inside `a11y-target-pair-a`'s right edge → a-count `2`, b-count `1`; click 1 px inside `a11y-target-pair-b`'s left edge → b-count `2`
  - Blast radius: every screen with these controls. The overlay must not swallow clicks meant for a neighbour: the pair cases above prove it in the browser. Run `bun run frontend:e2e` and the admin-spa Playwright suite once before Brew (stage-level check, not a new spec)
  - Test skills: terreno-frontend-tests

- [ ] **T16** — Expose Heading as a heading by default
  - Depends on: T13, T15
  - Files: ui/src/Heading.tsx, ui/src/Heading.test.tsx, ui/src/Common.ts, ui/src/SegmentedControl.tsx, ui/src/RadioField.tsx, ui/src/Accordion.tsx, ui/src/Modal.tsx, ui/src/Page.tsx, ui/src/Card.tsx, ui/src/login/LoginScreen.tsx, ui/src/UpgradeRequiredScreen.tsx, ui/src/AIRequestExplorer.tsx, ui/src/NotificationPreferences.tsx, ui/src/MultiselectField.tsx, ui/src/SignatureField.tsx, ui/src/Toast.tsx, ui/src/DateTimeActionSheet.tsx, ui/src/HeightActionSheet.tsx, ui/src/MarkdownEditor.tsx, ui/src/InfoModalIcon.tsx, ui/src/NotificationInbox.tsx, ui/src/Scorecard.tsx, ui/src/DonutChart.tsx, ui/src/blocks/blockRenderers.tsx, ui/src/Page.test.tsx, demo/stories/Heading.stories.tsx, demo/story-config/Heading.config.tsx, ui/e2e/accessibility/headings.spec.ts
  - Criteria:
    - `HeadingProps.level` becomes `1 | 2 | 3 | 4 | 5 | 6 | "none"`. When omitted, the level comes from `size`: `2xl` → 1, `xl` → 2, `lg` → 3, `md` (the default size) → 4, `sm` → 5. `level="none"` renders plain text, as an omitted level does today. An explicit number wins over the size.
    - Every internal `<Heading>` in `ui/src` is classified, because size alone gives the library's own screens a wrong outline:

      | Level | Uses |
      | --- | --- |
      | explicit `1` | `Page.tsx:66` (page title, which has no size and would default to 4), `login/LoginScreen.tsx:558`, `UpgradeRequiredScreen.tsx:34` |
      | explicit `2` | `Modal.tsx:124` (dialog title), `Card.tsx:126` (card title), `AIRequestExplorer.tsx:96`, `NotificationPreferences.tsx:50` |
      | explicit `3` | `Accordion.tsx:47` |
      | `"none"` (labels and values, not structure) | `SegmentedControl.tsx:121`, `RadioField.tsx:19`, `MultiselectField.tsx:95`, `SignatureField.tsx:30,55`, `Toast.tsx:235`, `DateTimeActionSheet.tsx:165,301`, `HeightActionSheet.tsx:41`, `MarkdownEditor.tsx:50,53,73`, `InfoModalIcon.tsx:36`, `NotificationInbox.tsx:87`, `Scorecard.tsx:51`, `DonutChart.tsx:141`, `blocks/blockRenderers.tsx:798` (metric value) |
      | default from size | the rest (`GPTChat`, `ProvisionalConsentSigner`, `WhatsNewBanner`, `asks/*`, the other `blocks/blockRenderers.tsx` titles, `login/LoginAccountList`, `signUp/Swiper`) |

      Before editing, the task re-runs `grep -rn "<Heading" ui/src` and classifies any use this table misses by the same rule: a screen or dialog title gets an explicit level, a label or value gets `"none"`.
    - The `level` doc comment in `Common.ts` describes the default and the opt-out.
  - Seam: rendered `Heading` (unit) and demo story (browser)
  - Interface: `<Heading size="lg">Title</Heading>` → `role="heading"`, `aria-level={3}`. Story `Heading` → `Accessibility` inside `View testID="a11y-headings"`: `<Heading size="2xl">Page</Heading>`, `<Heading size="lg">Section</Heading>`, `<Heading>Default</Heading>`, `<Heading size="xl" level={3}>Override</Heading>`, `<Heading level="none">Label</Heading>`.
  - Cases:
    - unit: `size="2xl"` → `role === "heading"`, `aria-level === 1`; `xl` → 2; `lg` → 3; no size → 4; `sm` → 5
    - unit: `size="xl" level={3}` → `aria-level === 3`; `level="none"` → no `role`, no `aria-level`
    - unit: SegmentedControl item renders no element with `role === "heading"`; a `Toast` title and a `SignatureField` title render none either
    - unit: `Page` with `title="Todos"` renders one element with `role === "heading"` and `aria-level === 1`; `Modal` title `aria-level === 2`; `Card` title `aria-level === 2`
    - browser: inside `a11y-headings`, `getByRole("heading", {level: 1, name: "Page"})`, `{level: 3, name: "Section"}`, `{level: 4, name: "Default"}`, `{level: 3, name: "Override"}` each have count 1; `getByRole("heading", {name: "Label"})` has count 0
    - browser: on the `Segmented control` → `Accessibility` story, `getByRole("heading")` inside `a11y-tabs` has count 0
  - Blast radius: 314 `<Heading>` uses in demo, example-frontend, admin-frontend and admin-spa gain a level. React Native Web renders `<h1>`–`<h6>` with its reset styles, so layout should not move: run `bun run ui:charts:compare`-style visual check is not available for pages, so the task screenshots the example-frontend Todos and Profile screens before and after and attaches both. Tests that count `getByRole("heading")` (grep the repo) are updated here.
  - Test skills: terreno-frontend-tests

- [ ] **T17** — Bring the reference docs, how-to and changelog in line with what shipped
  - Depends on: T3, T10, T15, T16
  - Files: docs/explanation/ui-accessibility.md, docs/reference/ui.md, docs/how-to/test-ui-accessibility.md, docs/testing/e2e/ui.md, changelog/unreleased/ui-accessibility.md, .rulesync/skills/accessibility-testing/SKILL.md
  - Criteria:
    - `docs/explanation/ui-accessibility.md`'s component table matches the roles, state attributes and keys the specs assert (one row per component in E1–E13), and names the SegmentedControl 36 px exception and the fields not yet covered (X3).
    - `docs/reference/ui.md`: the "TextField accessibilityLabel" section says the default name is the title; new short sections for `CheckBox` (`onChange`, `label`), `Heading` level defaults, `Banner` `hasIcon` default, `useReducedMotion`, and touch targets.
    - `docs/how-to/test-ui-accessibility.md` and the `accessibility-testing` skill source name `bun run --cwd ui test:e2e` as the place role, state and keyboard assertions for `@terreno/ui` live; `bun run skills:sync` is run so generated copies match.
    - `changelog/unreleased/ui-accessibility.md` has `category: Changed` and lists, in user terms: controls now expose roles and state; text fields are named by their title; toasts are announced; modals are named and return focus; `Banner` shows a status icon unless `hasIcon={false}`; `Heading` is a heading by default with `level="none"` to opt out; 44 px hit areas with no layout change; `CheckBox` accepts `onChange` and `label`; new `useReducedMotion` export. It ends with "What you may need to change": regenerate snapshots; on web, pressables are now `<button>` elements and a clickable `Box` needs `accessibilityRole="button"` to be announced as one; tests that found fields by the name "Text input field" or pagination by "Pagination Button".
    - `bun run check:changelog`, `bun run lint`, `bun run check:knip`, `bun run --cwd ui test:ci` and `bun run --cwd ui test:e2e` pass.
  - Seam: repository checks and the full accessibility suite
  - Interface: the commands in the last criterion
  - Cases: none (untestable: prose; the criterion's five commands are the proof, and Roast reads the explanation page against E1–E13)
  - Blast radius: none
  - Test skills: update-docs, update-agent-docs

## Assumptions

- A1. `role` and `aria-*` are the house spelling. React Native 0.88 maps `role`, `aria-checked`, `aria-selected`, `aria-expanded`, `aria-disabled`, `aria-hidden` and `aria-label` to native accessibility props; `LabeledCheckBox` already relies on this. `accessibilityState` is always set alongside the `aria-*` state, as that component does, so native does not depend on the mapping.
- A2. React Native Web 0.21.4 forwards extra props on `Modal` to the dialog element and already restores focus on unmount (`ModalFocusTrap.js:112-121`); Terreno's own blur at `Modal.tsx:241-250` probably defeats it, but effect order was not confirmed, so T12 reproduces first and records the opener itself. T12's first browser case confirms the prop forwarding; if it fails, T12 sets the attributes on the dialog node through a ref.
- A3. A transparent, absolutely positioned child that overflows a `Pressable` receives pointer events on web and the click bubbles to the pressable. T15's first browser case proves it. If a parent clips overflow (as SegmentedControl does), the control is listed as an exception, not resized.
- A4. Biome plugins listed in a package's `biome.jsonc` resolve relative to that file, as `demo/biome.jsonc` does for `no-barrel-imports.grit`.
- A5. The CircleCI `smoke` job is the right home for the suite: it already compiles, exports the demo and installs Chromium. The suite adds about one minute. `bun run check:circleci-parity` decides what else must name the new command.
- A6. The audit's "six other animated components" is seven in the code (Button, ActionSheet, ModalSheet, ToastNotifications, BooleanField, DraggableList, native SidebarNavigation); T14 covers all seven.
- A7. One PR for the whole IP, so docs written in T1 and reconciled in T17 ship in the same slice as the behaviour.

## Audit corrections

- 5.1 / C1: 34 of the 46 uses are `button`. The other 12 are `checkbox`, `combobox`, `header`, `image`, `text` and `adjustable`, which need the mapping in T2, not a blanket `role="button"`. Two test files assert on `aria-role` and change with it.
- 5.5 / C5: React Native Web already restores focus when a modal closes. The likely cause of the lost focus is Terreno's own blur of the opener (unconfirmed; T12 reproduces first).
- `Box.tsx:486-489` claims React Native translates `aria-role` to `accessibilityRole`. Neither React Native 0.88 nor React Native Web 0.21 contains the string; the attribute has never done anything on any platform.
- 5.6 / C6: 44 px is the platform guideline (and WCAG 2.5.5, AAA). WCAG 2.2 AA (2.5.8) requires 24 px. Radio, the modal close and the accordion chevron at 16 px fail AA; Button 34, IconButton 32 and Pagination 32 pass AA and miss the 44 px guideline.
- 5.12 / H4: seven components ignore reduced motion, not six.
- H10: plain-text headings are the documented behaviour today (`Common.ts:1317-1321`), added on purpose in #1613. T16 reverses that decision (Q1).
- 5.3 / C3: `TextField` already has an `accessibilityLabel` prop and `docs/reference/ui.md` tells authors to pass it; the bug is the default.
- Native rendering was not assessed by the audit. Every native claim in this plan is proven by a unit test on native props plus a NATIVE regression case.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 (raise at sign-off) | Should `Heading` be a heading when no `level` is passed? | Yes: level from size (`2xl`→1, `xl`→2, `lg`→3, `md`→4, `sm`→5), `level="none"` to opt out. | The audit's recommended fix; screen-reader heading navigation works with no author effort. It reverses the choice made in #1613 to keep unlevelled headings as plain text and touches 314 uses across the repo's apps. Inside the library every use is classified by hand (`Page` title is level 1, dialog and card titles 2, field labels and toast titles are not headings). In adopter code size is a guess at structure, so some pages get skipped levels; an explicit `level` fixes that. | Drop T16 and E13. Headings stay plain text unless `level` is set; the explanation page tells authors to pass it. No other task changes. | T16, T17 |
| Q2 (raise at sign-off) | Should `Banner` show its status icon by default? | Yes; `hasIcon={false}` opts out. | The audit's recommended fix: status is conveyed by colour alone today. It is a visible change in every app that shows a banner. | Keep `hasIcon` default `false`; T13 keeps the roles and the status word in the accessible name, and drops the icon criterion and its cases. | T13, T17 |
| Q3 | Should default controls reach 44 px by growing visually, or by growing only their hit area? | Hit area only, in this release. Visual sizes stay. | The audit allows either. Growing Button from 34 to 44 px resizes controls on every screen of every adopter, including production apps. An invisible hit area meets the same target-size goal with no layout change and can be undone. | T15 instead sets `minHeight`/`minWidth` 44 on default sizes and keeps `sm` dense; the changelog fragment becomes `Breaking` with an upgrade note in `mcp-server/src/docs/upgrades/`, and adopters re-check dense toolbars and tables. | T15, T17 |
| Q4 (raise at sign-off) | Should a `Box` with `onClick` be a button by default? | No. No role unless the author passes `accessibilityRole`. | Boxes wrap other buttons; a default role would nest `<button>` elements on web and hide inner controls from VoiceOver. Today's behaviour is "no role" on every platform, so nothing regresses. This departs from the audit's "use `role=\"button\"` everywhere": clickable Boxes (about 70 in `ui/src` by a rough grep, plus adopters' own) stay unannounced unless the author opts in, so finding 5.1 is closed for controls and left open for clickable Boxes. | Give `Box` `role="button"` when it has `onClick` and no pressable descendants can be assumed; needs an audit of every clickable Box in the repo's apps first. | T2 |
| Q5 | Should the interactive checkbox be `CheckBox` with `onChange`, or a second exported component? | `CheckBox` gains `onChange` and `label`; `LabeledCheckBox` is folded into it. | One component to learn. Call sites that pass no `onChange` keep working. | Export `LabeledCheckBox` as is and leave `CheckBox` decorative; T4 shrinks to an export, a story and the same spec. | T4 |
| Q6 | Is SegmentedControl a tab list or a radio group? | Tab list (`tablist`/`tab`/`aria-selected`). | It is used to switch views and the audit recommends it. It has no `tabpanel` to point at, which is allowed. | Use `radiogroup`/`radio`/`aria-checked`; T7's cases change role names only. | T7 |
| Q7 | Which toasts interrupt the screen reader? | `error` and `warning` are assertive; `info` and `success` are polite. | Matches the audit and common practice. | Change the map in T11; one line and two cases. | T11 |
| Q8 | Is prop-level unit proof plus five manual device cases enough for native? | Yes for this plan. | The repo has no device flows and the sandbox has no device. | Add a Maestro device flow per component using the Android emulator companion; about 2 more days and a new CI job. | T4–T15 |
| Q9 | Should the browser suite run in the `smoke` CircleCI job? | Yes. | It needs exactly what that job already builds. | A separate job with its own demo export; T1's CI criterion changes. | T1 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | SelectField as a single-tab-stop combobox on web (finding 5.11 / H7) | In scope for this group; a rework of `PickerSelect` and `WebDropdownMenu`, planned in its own IP `ui-select-combobox` | M | T2, T10 |
| X2 | Visual 44 px default sizes with a compact density option, in a major version | Q3's other answer | M | Q3 |
| X3 | Title, helper and error wiring for fields that own their `TextInput` (DateTimeField, OtpField, HeightField, CustomSelectField, MarkdownEditorField, address autocompletes) with `useFieldAccessibility` | Finding 5.3 names TextField; these have the same gap | M | T10 |
| X4 | Arrow-key roving focus in SegmentedControl tabs and RadioField | The ARIA authoring patterns expect it; Tab plus Space works without it | S | T6, T7 |
| X5 | BooleanField animation off the JS thread (finding H5): thumb on `transform` with the native driver, colour by cross-fade | Performance, not accessibility; T14 rewrites the same code | S | T14 |
| X6 | Run the axe scanner over every demo story in CI with a ratcheted baseline | Would catch regressions the role specs do not; blocked today by contrast findings owned by `ui-polish` | M | `ui-polish` |
| X7 | Maestro device flows for accessibility on the Android emulator companion | Q8's other answer | M | Q8 |
| X9 | Move the remaining wrapped `CheckBox` call sites (admin-frontend roles and AI views, `AppRolesList`, `blockRenderers`) to `CheckBox onChange` | T4 migrates only the consent and todo checkboxes | S | T4 |
| X8 | `RadioField` `disabled`, `errorText`, `helperText` and `testID` props (audit Q4) | Found while reading RadioField; prop additions belong to `ui-polish` | S | T6 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | How many questions go to the human before the plan is written? | "if there is a recommended answer, use that answer across the board, only bring me the most critical questions" | Every question is built on the audit's recommended fix where it gives one. Q1 and Q2 change a visible default in every adopter's app, so they are brought to the owner at sign-off, with Q4, the one place the plan departs from the audit's fix |

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagents), 18 findings (4 blocking): 15 fixed, 3 moved to questions (Q1, Q2 and Q4 raised at sign-off; Q1 and Q2 stay on the audit's recommended fix per D1), 0 rebutted.
Unchecked: A2 (React Native Web forwarding `aria-*` on `Modal`, and the cause of the lost focus) and A3 (the web hit-area overlay) need a running browser; T12 and T15 prove them in their first cases. T4 bundles the CheckBox API with two call-site migrations; split it if Roast finds it too wide.
