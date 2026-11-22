# Make SelectField a real combobox on web

`SelectField` is the dropdown every Terreno form and the admin panel use. On web it is a custom menu built in `PickerSelect.tsx` and `WebDropdownMenu.tsx`. The 58.0.4 audit tabbed through a form in Chromium and found that each select takes three tab stops, pops its menu open as soon as focus lands on it, has no arrow-key navigation, and tells assistive technology nothing: no `combobox`, `listbox` or `option` role. This plan makes it one tab stop that opens on a key press, moves through options with the arrow keys, and is announced as a combobox with its label, state and selected option. Keyboard and screen-reader users feel it in every form; mouse and touch behaviour stays the same. It builds on `ui-accessibility`, which adds the browser test suite and the field-labelling hook this plan uses.

## The idea

The web trigger becomes the single focusable element and carries the ARIA 1.2 combobox contract: `role="combobox"`, `aria-expanded`, `aria-controls` → the menu's `role="listbox"`, `aria-activedescendant` → the highlighted `role="option"`. DOM focus stays on the trigger while the menu is open, so there is nothing else to tab to. Opening is an explicit action (click, Enter, Space, ArrowDown, or typing), never a side effect of focus.

Everything new is gated to `Platform.OS === "web"`. That matters because the same custom dropdown also renders on iOS and Android whenever the select is searchable, which is the default (`PickerSelect.tsx:855-857`). Native keeps today's behaviour, including open-on-focus (on a phone, focus is a tap), and unit cases under iOS and Android mocks pin that. Public props and the `web_picker`, `text_input` and `web_dropdown_*` test ids stay. `SelectBadge`, which shares `WebDropdownMenu`, is unchanged: the listbox semantics are opt-in through a prop only `PickerSelect` sets.

Rejected: swapping in a native `<select>` on web. The code comment at `PickerSelect.tsx:181-183` records why the custom menu exists (identical styling across browsers), and search-in-trigger cannot be done with `<select>`.

Rejected: moving focus into the menu. The searchable variant needs the caret to stay in the trigger input while arrows move the highlight.

## The plan

**Do not start until `ui-accessibility` is merged.** T1 writes into the `ui/e2e/accessibility` suite and `test:e2e` script that plan's T1 creates; T1, T2 and T4 edit lines its T2 rewrites (`aria-role` in `PickerSelect.tsx` and `WebDropdownMenu.tsx`); T3 uses the `useFieldAccessibility` hook from its T10. `Depends on:` lines below list only this plan's task IDs, because the task graph validates IDs per plan.

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: reproduce the tab stops, then make the web select one tab stop that opens on press, not focus | none | PickerSelect, new spec | Playwright: one Tab moves past a select; focus alone leaves the menu closed; click and typing open it |
| T2 | The non-searchable web menu keeps focus on its trigger | T1 | PickerSelect | Trigger is `document.activeElement` while the menu is open |
| T3 | The trigger is a labelled combobox with expanded state and error text | T2 | PickerSelect, SelectField | `getByRole("combobox", {name})`, `aria-expanded`, `aria-describedby` |
| T4 | The menu can be a listbox of options with a selected option | none | WebDropdownMenu | `role="listbox"`, `option` with `aria-selected`; SelectBadge unchanged |
| T5 | Keyboard: open, move, select, close | T3, T4 | PickerSelect, WebDropdownMenu | Playwright keyboard run with `aria-activedescendant` |
| T6 | Docs and changelog | T5 | docs, changelog | Checks pass; contract page row matches the spec |

Tracer: `SelectField` → `PickerSelect` web trigger → real Tab key presses in Chromium against the demo export, in the `ui/e2e/accessibility` suite.
Chain reason: T1 → T2 → T3 → T5 all rewrite the trigger in `PickerSelect.tsx`; each needs the previous one's trigger shape.
E2E: 1 spec (browser), `ui/e2e/accessibility/select.spec.ts`, grown by T1, T2, T3 and T5.
Regression: A11Y-new-1 → `docs/regression/ui-accessibility.md`, a new suite Brew creates (what a screen reader says in Safari and Chrome).
User guide: None — no example-app page describes how to operate a dropdown; steps that say "choose" an option still hold.
Design: None — no canvas; before state is `Selectfield-desktop-light.png`, `Selectfield-mobile-light.png` and `kb-button-focus.png` on PR #1705.
Out of scope: SelectBadge, MultiselectField, CustomSelectField, address autocompletes, async or creatable options, any native change (see Expansions).
Open risks: unit tests in ui and admin-frontend open selects through `web_picker`/`text_input`, some by focus; how the example-frontend and admin-spa Playwright suites open a select was not traced, so both suites run before Brew. Screen-reader support for `aria-activedescendant` on an `<input>` varies by browser, and only Chromium runs in CI.
Elephant: people are used to "focus the field and type to search". After this, tabbing into a searchable select and typing must still open and filter, including right after Escape, or forms will feel broken to fast keyboard users who never knew they relied on open-on-focus.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `ui/e2e/accessibility/select.spec.ts` | browser | With focus on the field before a select, Tab lands on the select and the menu stays closed; one more Tab per select reaches the field after them. Clicking opens. Typing opens and filters, also after Escape. Focus stays on the trigger while a menu is open. The trigger is a `combobox` named by its title with `aria-expanded` and its error text. Arrow keys open the `listbox` and move `aria-activedescendant`; Enter selects and closes; Escape closes with focus on the trigger | T1, extended in T2, T3, T5 |

Runs with `bun run compile && bun run --cwd demo export && bun run --cwd ui test:e2e` (script added by `ui-accessibility` T1).

## Regression cases

Destination: A11Y → docs/regression/ui-accessibility.md (no suite declares `A11Y` yet; Brew creates the file with its `Area:` line and adds it to `docs/regression/README.md`, then runs `bun run check:regression-suites`)

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| A11Y-new-1 | A screen reader announces a select and its active option | On a Mac, open the demo app's **Select field** page in dev mode and choose the **Accessibility** story, turn on VoiceOver, and in Safari and then Chrome: Tab to the **Colour** select, press the down arrow twice, then Enter | On focus VoiceOver says "Colour", "combo box" and "collapsed". After the first arrow it says "expanded" and the highlighted option's name; after the second, the next option's name. After Enter it says the chosen option as the field's value | Web (Safari, Chrome) | E1 covers attributes in Chromium; the speech is manual | ui-select-combobox |

## User guide

None — no user-guide page gives steps for operating a dropdown beyond choosing an option, which is unchanged for pointer users.

## Design

None — no canvas. Before-state screenshots on PR #1705: `Selectfield-desktop-light.png`, `Selectfield-mobile-light.png`, `kb-button-focus.png`. The only visual change is a highlight on the keyboard-active option (T5), which reuses the existing hover style; T5 attaches light and dark screenshots of the open menu.

## Tasks

Shared story for every task, added in T1: `Select field` → `Accessibility` in `demo/stories/SelectField.stories.tsx` and `demo/story-config/SelectField.config.tsx`. Inside `View testID="a11y-select"`, in this order: `TextField title="Before" testID="a11y-select-before"`; `View testID="a11y-select-search"` wrapping `SelectField title="Colour" requireValue` (no `testID`) with options Red/`red`, Green/`green`, Blue/`blue`, controlled, initial value `"red"`; `View testID="a11y-select-plain"` wrapping `SelectField title="Size" requireValue disableSearch` (no `testID`) with options Small/`s`, Medium/`m`, Large/`l`, controlled, initial value `"m"`, `errorText="Pick a size"`; `TextField title="After" testID="a11y-select-after"`; `Text testID="a11y-select-value"` showing the Colour value and `Text testID="a11y-select-size"` showing the Size value. Both selects set `requireValue`, so no placeholder option is listed. A `SelectField` `testID` does not reach the DOM (both triggers render `web_picker` / `text_input`), which is why each select sits in its own wrapper `View`: "the Colour trigger" below means `getByTestId("a11y-select-search").getByTestId("web_picker")`.

"Menu open" is observed as: an element with test id `web_dropdown_backdrop` exists (the prefix is `web_dropdown`, `PickerSelect.tsx:847`). Options keep their test ids `web_dropdown_option_<value>`.

Supporting skills for every task: `accessibility-testing`, `terreno:verify-ui-changes`, `terreno:terreno-ui`, `terreno:terreno-frontend-tests`, `terreno:update-docs`.

- [ ] **T1** — Make the web select one tab stop that opens on press, not on focus
  - Depends on: none
  - Files: ui/src/PickerSelect.tsx, ui/src/PickerSelect.test.tsx, demo/stories/SelectField.stories.tsx, demo/story-config/SelectField.config.tsx, ui/e2e/accessibility/select.spec.ts
  - Criteria:
    - Reproduce first: before editing, the task records the Tab log on the story (each focused element's tag, role, test id and size) in the PR description. The audit reported three stops per select (an input, a second input, an 11×13 unlabeled div) and open-on-focus, measured on a dev build and not re-measured for this plan. If the log shows a different count or cause, the task says so and fixes what the log shows.
    - Web: each select contributes exactly one tab stop. The chevron is not focusable (`tabIndex={-1}`, `aria-hidden`); it still toggles on click.
    - Web: focus alone never opens the menu. Today the searchable trigger has no press handler; a click opens it only because it focuses the input (`onFocus={handleWebSearchFocus}`, `PickerSelect.tsx:770`). On web that `onFocus` is removed and the `web_picker` wrapper gets a click handler that opens the menu when it is closed, so a click on an already-focused closed trigger also opens it.
    - Web, searchable: a printable key pressed while the menu is closed opens it with that one character as the query, handled in `onKeyDown`, not by appending to the selected label the input shows while closed (`PickerSelect.tsx:776`, `:702-708`).
    - Native (iOS, Android): unchanged; `onFocus` still opens.
    - In `PickerSelect.test.tsx`, the shared helper `openSearchableWebPicker` (`:217`, eight call sites) opens by pressing `web_picker` on web instead of firing `focus`; the "renders web dropdown and opens on focus" test (`:256`) becomes "opens on press, not on focus"; the disabled test (`:302`) stays as is; focus-opens cases are added under iOS and Android mocks.
    - `web_picker` and `text_input` test ids are unchanged.
  - Seam: demo story in Chromium (browser); `RNPickerSelect` rendered with web, iOS and Android platform mocks (unit)
  - Interface: existing `SelectFieldProps`; no new public prop.
  - Cases:
    - browser: focus `a11y-select-before`, Tab → focus is inside `a11y-select-search`; `web_dropdown_backdrop` count 0; Tab → focus inside the `Size` select, backdrop count 0; Tab → `a11y-select-after` focused (3 Tabs for 2 selects)
    - browser: Shift+Tab twice from `a11y-select-after` → focus inside `Colour`, backdrop count 0
    - browser: click the `Colour` trigger → backdrop count 1; press Escape → 0; click the same, still focused, trigger → 1
    - browser: Tab to `Colour`, type `g` → backdrop count 1; `web_dropdown_option_green` visible; `web_dropdown_option_red` count 0
    - browser: click `Colour`, Escape, then type `g` → only `web_dropdown_option_green` is listed (query is "g", not "Redg")
    - unit (web): chevron pressable `tabIndex === -1`; firing `focus` on `text_input` does not call `onOpen`; pressing `web_picker` calls `onOpen` once
    - unit (iOS and Android mocks): firing `focus` on `text_input` calls `onOpen` once (unchanged)
  - Blast radius: `AdminModelForm`, ask controls and every form use SelectField → `ui/src/asks/AskCard.test.tsx`, `ui/src/table/TableBadge.test.tsx`, `admin-frontend/src/widgets/aiObservability/experiments/AiExperimentNewView.test.tsx` and `admin-frontend/src/isolated/aiObservabilityExperiments.isolated.tsx` (all use `web_picker`/`text_input`) stay green or are updated here where they open by focus; `ui/src/SelectField.test.tsx` stays green; run `bun run frontend:e2e` and the admin-spa Playwright suite once before Brew
  - Test skills: terreno-frontend-tests

- [ ] **T2** — Keep focus on the trigger while the non-searchable web menu is open
  - Depends on: T1
  - Files: ui/src/PickerSelect.tsx, ui/src/PickerSelect.test.tsx, ui/e2e/accessibility/select.spec.ts
  - Criteria: today the `disableSearch` web path blurs the active element on open (`PickerSelect.tsx:192-199`) and renders the menu in a React Native `Modal`, because `keepTriggerFocus` is only true for the searchable trigger (`:831`). On web, `keepTriggerFocus` is passed as `true` for both triggers, so the menu uses the fixed overlay, and the blur effect is removed. `renderMenuInBodyPortal` keeps its one meaning: whether that overlay is portalled to `document.body`. Native is unchanged (still the `Modal`).
  - Seam: demo story (browser); `RNPickerSelect` with web and Android mocks (unit)
  - Interface: no prop change.
  - Cases:
    - browser: click the `Size` trigger → backdrop count 1 and `document.activeElement` is the `Size` trigger (`web_picker` inside `a11y-select-plain`)
    - browser: click `web_dropdown_option_l` → backdrop count 0, `a11y-select-size` text `l`
    - browser: open `Size`, click the backdrop → closed, value unchanged (`m`)
    - unit (web, `disableSearch`): `WebDropdownMenu` receives `keepTriggerFocus === true`; opening does not call `blur` on the active element
    - unit (Android, `disableSearch: false`): `WebDropdownMenu` receives `keepTriggerFocus === false` and `presentation === "centered"` (unchanged)
  - Blast radius: selects inside a `Modal` or `ActionSheet` on web now render the menu as a fixed overlay rather than a nested modal → add a unit case with `renderMenuInBodyPortal` true and false, and check the admin form's select inside its edit screen by running the admin-spa Playwright suite before Brew
  - Test skills: terreno-frontend-tests

- [ ] **T3** — Expose the trigger as a labelled combobox with state and error text
  - Depends on: T2
  - Files: ui/src/PickerSelect.tsx, ui/src/PickerSelect.test.tsx, ui/src/SelectField.tsx, ui/src/SelectField.test.tsx, ui/e2e/accessibility/select.spec.ts
  - Criteria: on web the trigger (the search `TextInput`, or the `Pressable` when `disableSearch`) has `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls` = the menu id while open, `aria-disabled` when disabled, and `aria-autocomplete="list"` when searchable. Its name is the field `title`; with no title, the placeholder. `SelectField` calls `useFieldAccessibility` (from `ui-accessibility` T10), gives `FieldTitle`, `FieldError` and `FieldHelperText` its ids, and passes `inputProps` down, so `aria-describedby` points at the rendered error and helper text and `aria-invalid` is set, with or without a `testID`. The `Pressable` branch ignores `textInputProps` today (`PickerSelect.tsx:792-826`), so the props are spread onto it explicitly. Native: only the existing `accessibilityLabel` is passed, as today.
  - Seam: rendered `SelectField` (unit, web mock) and demo story (browser)
  - Interface: `RNPickerSelect` gains two internal props: `menuId: string` (from `useId` in `SelectField`) and `triggerAccessibilityProps: {"aria-label": string; "aria-labelledby"?: string; "aria-describedby"?: string; "aria-invalid": boolean}` (the hook's `inputProps`). No public `SelectFieldProps` change.
  - Cases:
    - unit: `title="Colour"`, closed → trigger `role === "combobox"`, `aria-expanded === false`, `aria-label === "Colour"`, `aria-haspopup === "listbox"`, no `aria-controls`
    - unit: opened → `aria-expanded === true`, `aria-controls === menuId`
    - unit: `disableSearch`, `errorText="Pick a size"`, no `testID` → the `Pressable` has `aria-invalid === true` and `aria-describedby` equal to the error element's `nativeID`
    - unit: `disabled` → `aria-disabled === true`
    - unit (iOS mock): trigger has no `role === "combobox"`
    - browser: `getByRole("combobox", {name: "Colour"})` and `{name: "Size"}` each count 1 with `aria-expanded="false"`; click "Colour" → `"true"`
    - browser: the "Size" combobox's `aria-describedby` resolves to an element with text "Pick a size"; its visible text is "Medium"
  - Blast radius: none beyond T1's
  - Test skills: terreno-frontend-tests

- [ ] **T4** — Let the dropdown menu render as a listbox of options
  - Depends on: none
  - Files: ui/src/WebDropdownMenu.tsx, ui/src/WebDropdownMenu.test.tsx
  - Criteria: `WebDropdownMenu` gains `listbox?: {menuId: string; label: string; activeIndex?: number}`. Only when it is set and `Platform.OS === "web"`: the option container has `role="listbox"`, `id` = `menuId` and `aria-label` = `label`; each option has `role="option"`, id `${menuId}-option-${String(option.value)}` (by value, because the menu receives an already-filtered list and has no original index), `aria-selected`, `tabIndex={-1}`, and the option at filtered index `activeIndex` carries `dataSet={{active: "true"}}` (rendered as `data-active="true"`) and the hover background; the backdrop is `aria-hidden` with `tabIndex={-1}`. Without `listbox` (as `SelectBadge` calls it) and on native, rendering is exactly as today: options stay tabbable buttons. Option test ids are unchanged. Click selection is unchanged.
  - Seam: rendered `WebDropdownMenu` (unit, web and iOS mocks)
  - Interface: `<WebDropdownMenu listbox={{menuId: "m1", label: "Colour", activeIndex: 1}} options={[{label:"Red",value:"red"},{label:"Green",value:"green"}]} selectedValue="green" visible keepTriggerFocus testIDPrefix="web_dropdown" onClose={fn} onSelect={fn} />`
  - Cases:
    - one element `role === "listbox"` with id `m1` and `aria-label === "Colour"`
    - two elements `role === "option"` with ids `m1-option-red`, `m1-option-green`; "Green" `aria-selected === true`, "Red" `false`; both `tabIndex === -1`
    - the option with test id `web_dropdown_option_green` has `dataSet.active === "true"`; `web_dropdown_option_red` does not
    - backdrop has `aria-hidden === true` and `tabIndex === -1`; pressing it calls `onClose` once
    - pressing "Red" calls `onSelect` with the red option (unchanged)
    - no `listbox` prop → no element has `role` `listbox` or `option`, and options have no `tabIndex` of -1
    - iOS mock with `listbox` set → no `role === "listbox"`
  - Blast radius: `SelectBadge` is the other consumer (`WebDropdownMenu.tsx:119`) → `SelectBadge` unit tests stay green with no edit, proven by the "no `listbox` prop" case
  - Test skills: terreno-frontend-tests

- [ ] **T5** — Operate the select from the keyboard
  - Depends on: T3, T4
  - Files: ui/src/PickerSelect.tsx, ui/src/PickerSelect.test.tsx, ui/src/WebDropdownMenu.tsx, ui/src/WebDropdownMenu.test.tsx, ui/e2e/accessibility/select.spec.ts
  - Criteria: on web, with focus on the trigger:
    - closed: ArrowDown, ArrowUp and Alt+ArrowDown open the menu with the selected option active (the first option when nothing is selected). Enter opens it on both triggers. Space opens it on the non-searchable trigger; on the searchable one Space is a typed character (T1's rule).
    - open: ArrowDown/ArrowUp move the active option and stop at the ends. Home/End jump to the first/last option on the non-searchable trigger only. The active option is scrolled into view and referenced by the trigger's `aria-activedescendant`. Typing in the searchable trigger filters and makes the first match active. Enter selects the active option, closes and calls `onChange`; Enter with no matching option does nothing. Tab closes and moves on without selecting.
    - Escape has one owner: the existing document listener in `WebDropdownMenu.tsx:393-410`, which now always applies on web because T2 put both triggers on the overlay. `PickerSelect` adds no Escape handler. Escape closes without changing the value and leaves focus on the trigger.
    - `PickerSelect` owns the other keys in the trigger's `onKeyDown` and passes `listbox={{menuId, label, activeIndex}}` to the menu.
  - Seam: demo story in Chromium (browser); key events on the trigger (unit, web mock)
  - Interface: as T4's `listbox` prop. "Active option" in a browser case means the element whose id equals the trigger's `aria-activedescendant`.
  - Cases:
    - browser, "Size" (Small, Medium, Large; value Medium): focus trigger, ArrowDown → listbox visible, active option text "Medium"; ArrowDown → "Large"; ArrowDown → still "Large"; ArrowUp → "Medium"; Home → "Small"; ArrowUp → still "Small"; End → "Large"; Enter → backdrop count 0, `a11y-select-size` text `l`, trigger text "Large", trigger focused
    - browser, "Size": Space → open; Escape → closed, `a11y-select-size` unchanged, trigger focused. Alt+ArrowDown → open. ArrowUp while closed → open with the selected option active
    - browser, "Colour" (value Red): Enter → open, active "Red"; type `bl` → one option, "Blue", active, and the trigger's `aria-activedescendant` ends with `-option-blue`; Enter → `a11y-select-value` text `blue`, closed
    - browser, "Colour": open, type `zz` → no options; Enter → still open, `a11y-select-value` unchanged
    - browser, "Colour": Tab to it, press Space → the menu opens with query " " and the value is unchanged (Space did not select)
    - browser, "Colour" open: Tab → closed, `a11y-select-value` unchanged, focus inside the "Size" select
    - browser: in every open state above, `document.activeElement` is the trigger
    - unit: Escape while open → `onClose` called exactly once
    - unit: ArrowDown on a disabled select → `onOpen` not called
    - unit (iOS mock): `WebDropdownMenu` receives no `listbox` prop
  - Blast radius: none beyond T1's and T2's
  - Test skills: terreno-frontend-tests

- [ ] **T6** — Document the select's keyboard and screen-reader contract
  - Depends on: T5
  - Files: docs/explanation/ui-accessibility.md, docs/reference/ui.md, changelog/unreleased/ui-select-combobox.md
  - Criteria: the explanation page (created by `ui-accessibility` T1) gains a SelectField row and a key table matching E1, and says the contract is web-only and that `SelectBadge` is not covered. `docs/reference/ui.md` gets a "SelectField keyboard" section. The changelog fragment is `category: Changed` and says: on web a select no longer opens when it receives focus; it opens on click, Enter, Space, the arrow keys or typing; it is one tab stop; it is announced as a combobox; tests that opened a select by focusing it must click or press a key instead. `bun run check:changelog`, `bun run lint`, `bun run --cwd ui test:ci` and `bun run --cwd ui test:e2e` pass.
  - Seam: repository checks
  - Interface: the four commands above
  - Cases: none (untestable: prose; the commands are the proof and Roast reads the key table against E1)
  - Blast radius: none
  - Test skills: update-docs

## Assumptions

- A1. `ui-accessibility` is merged before this starts (see the note above the plan table).
- A2. The audit's "three tab stops" was measured on a Metro dev build and not re-measured here; T1 reproduces it before changing anything. The code confirms open-on-focus (`PickerSelect.tsx:770`) and a separately focusable chevron (`PickerSelect.tsx:778-790`).
- A3. React Native Web forwards `role`, `aria-activedescendant`, `aria-controls` and `aria-expanded` on `TextInput` and `Pressable`, and `dataSet` as `data-*`. Not checked against a running export; T3's first browser case proves it, and if it fails the attributes are set through a ref.
- A4. Native is left alone. Searchable selects on iOS and Android render the same custom dropdown, and non-searchable ones use the platform picker; the audit assessed neither, so every new attribute and key handler is gated to web and unit cases pin the native props.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 | Should a select still open when it receives keyboard focus on web? | No. It opens on click, a key press, or typing. | Tabbing through a form should not pop menus; this is the audit's finding. Typing still opens a searchable select, so type-to-search keeps working. | Keeping open-on-focus undoes the finding; T1 would keep only the single tab stop. | T1 |
| Q2 | Does Tab on an open menu select the highlighted option? | No. Tab closes and moves on. | Matches the ARIA select-only pattern and avoids accidental changes. | Tab selects the active option first; one case in T5 flips. | T5 |
| Q3 | Should `SelectBadge`, MultiselectField and CustomSelectField get the same contract now? | Not in this plan. | They are different components; SelectField is the one the audit measured. `SelectBadge` shares the menu and is deliberately left as is. | Add them as further tasks (about 2 more days). | none |
| Q4 | Should the searchable select on iOS and Android get screen-reader semantics too? | Not in this plan. | Not assessed by the audit and not testable here without a device. | Add native roles in T4 behind unit cases and add VoiceOver/TalkBack regression cases to `docs/regression/ui-native.md`. | T3, T4 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Combobox semantics for SelectBadge, MultiselectField, CustomSelectField and the address autocompletes | Same gap, different components | M | T5 |
| X2 | Async and creatable options | Audit's missing-components list; owned by `ui-polish` | L | T5 |
| X3 | Type-ahead on the non-searchable select (jump to the option starting with the typed letter) | Native `<select>` does this | S | T5 |
| X4 | Screen-reader semantics for the custom dropdown on iOS and Android | Q4's other answer | M | T4 |
| X5 | Run the accessibility suite in WebKit and Firefox | Only Chromium runs today | S | `ui-accessibility` T1 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | How many questions go to the human before the plan is written? | "if there is a recommended answer, use that answer across the board, only bring me the most critical questions" | Built on the recommendations above |

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagents), 16 findings (4 blocking): 15 fixed, 1 moved to questions (native semantics, Q4), 0 rebutted. Cross-plan prerequisites stay in prose above the plan table because the task graph validates IDs per plan.
Unchecked: the three-tab-stop count on a static export, and whether the fixed overlay is placed correctly for a select inside a web `Modal` (T2's blast-radius case); both need a running build.
