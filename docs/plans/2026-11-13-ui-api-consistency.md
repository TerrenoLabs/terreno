# Accept the prop names people guess in @terreno/ui

`@terreno/ui` names its props differently from React Native and from every peer library:
`onClick` where others say `onPress`, `title` where others say `label`, `errorText` for `error`,
`onChange` for `onChangeText`. People and coding agents guess the conventional names, and the
first screen of a new app fails typecheck. Some components also miss the props the rest of the
library has: RadioField cannot be disabled or show an error, and a dozen components take no
`testID`. This plan makes the conventional names work alongside the existing ones and fills
those gaps. No existing prop is removed, renamed or deprecated.

Source: audit `docs/audits/2026-11-12/ui-ux.md` "Component API consistency", Q4, and the
`REPORT.md` section 5 "API consistency" paragraph. Look and layout fixes are in the sibling plan
`docs/plans/2026-11-13-ui-polish.md`.

## The idea

- **Aliases at the component, not in the interfaces.** No exported props interface changes.
  Each component's signature accepts its existing props type or an alias form of it, built from
  shared types in one new file. A shared resolver maps alias names to the existing names before
  the component body runs. Existing JSX, wrappers that `extends ButtonProps`, and the demo's
  generated prop tables keep working. One edge changes: `ComponentProps<typeof Button>` becomes
  a union, so adopter code that reads `.onClick` from it must narrow (see Open risks).
- **Strictness is kept.** A handler that is required today stays required: you must pass
  `onClick` or `onPress`. Rejected: making both optional on the interface (loses the compile
  error for a Button with no handler) and turning the interfaces into union types (breaks
  `interface X extends ButtonProps` in adopters' code).
- **Existing name wins.** If both names are passed, the existing one is used and a development
  warning names the duplicate.
- **Gaps filled.** RadioField gets `testID`, `disabled`, `errorText`, `helperText`. Components
  with no `testID` get one. Button accepts `size="md"`.

Alias table (the whole contract):

| Component | Existing name | Also accepted |
| --- | --- | --- |
| Button, IconButton | `onClick` | `onPress` |
| TextField, TextArea, EmailField, NumberField, PhoneNumberField, SelectField, CustomSelectField, MultiselectField, BooleanField, DateTimeField, RadioField, Slider, SignatureField, TypedSignatureField, SignatureCaptureField | `title` | `label` |
| the same fields, where the component renders `errorText` today (not BooleanField) | `errorText` | `error` |
| TextField, TextArea, EmailField, NumberField, PhoneNumberField | `onChange` | `onChangeText` |
| Modal | `visible` | `isOpen` |
| Modal | `onDismiss` | `onClose` |
| Modal | `primaryButtonOnClick`, `secondaryButtonOnClick` | `onPrimaryAction`, `onSecondaryAction` |
| Button | `size="default"` | `size="md"` |

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Alias types and resolver; Button accepts `onPress` | none | `ui/src/propAliases.ts`, `Button.tsx`, `index.tsx` | unit + type tests |
| T2 | IconButton accepts `onPress` | T1 | `IconButton.tsx` | unit + type tests |
| T3 | Fields accept `label`, `error`, `onChangeText` | T1 | 15 field components | unit + type tests |
| T4 | Modal accepts `isOpen`, `onClose`, `onPrimaryAction`, `onSecondaryAction` | T1 | `Modal.tsx` | unit + type tests |
| T5 | Button accepts `size="md"` | T1 | `Common.ts`, `Button.tsx` | unit |
| T6 | RadioField takes `testID`, `disabled`, `errorText`, `helperText` | T3, T5 | `Common.ts`, `RadioField.tsx`, RadioField demo story | unit |
| T7 | `testID` on the components that lack one | T6 | `Common.ts`, 8 components | unit |
| T8 | Reference docs and changelog | T1–T7 | docs, changelog | checks listed in the task |

Tracer: T1, `<Button text="Save" onPress={fn} />` compiles and the press calls `fn`, through
the shared resolver every later alias uses.
E2E: None — additive props on single components; the ui e2e guide puts these at the unit tier.
Regression: None — no hard-to-automate change.
User guide: None — no example-app screen or step changes.
Design: None — no canvas; the only new visuals are RadioField's disabled and error states, built from existing field parts.
Out of scope: deprecating existing names, value-based SegmentedControl, interactive CheckBox,
new components (see Expansions).
Open risks: file overlap with `ui-polish` and `ui-accessibility`; an adopter's wrapper typed
with `ButtonProps` does not gain the alias until it is retyped; `ComponentProps<typeof Button>`
(and the same for IconButton, the aliased fields and Modal) becomes a union, so adopter code
that reads a renamed key from it, or `Omit`s it, needs a narrow or should use the exported
`ButtonProps` instead. The changelog says so.
Elephant: two valid names for the same prop, kept forever, means every doc, generator template and agent rule must pick one to teach, and nothing in this plan stops them from drifting apart.

## E2E tests

None — every criterion is a prop accepted by one component and observable in a unit render or
at compile time. `docs/testing/e2e/ui.md` ("Add an e2e test") sends a changed component
behaviour to a unit test next to it; no flow crosses the frontend and backend.

## Regression cases

None — no hard-to-automate change.

## User guide

None — `docs/user-guide/` describes what an example-app user does; nothing they see or do
changes.

## Design

None — no canvas. Existing components render the same pixels. RadioField's new disabled and
error states reuse `FieldError`, `FieldHelperText` and `theme.text.extraLight`; T6 captures
screenshots of them for the PR.

## Tasks

Shared rules for every task:

- Unit tests use `renderWithTheme` and run with `bun test --only-failures <path>` from `ui/`.
- Type tests are `.test.tsx` cases that only need to compile: valid usages as plain JSX, invalid
  ones under `// @ts-expect-error`. `bun run typecheck` (which includes tests) is their runner;
  an unused `@ts-expect-error` fails it.
- Test skills for every task: `terreno:terreno-frontend-tests`, `terreno:terreno-ui`.
- Reference docs and changelog are written once, in T8 (Assumption A1).

- [ ] **T1** — Add shared alias types and resolver, and accept onPress on Button
  - Depends on: none
  - Files: ui/src/propAliases.ts, ui/src/propAliases.test.ts, ui/src/Button.tsx, ui/src/Button.test.tsx, ui/src/index.tsx
  - Seam: exported function `resolveAliases`; rendered `Button`; compile-time types
  - Interface: `propAliases.ts` exports the following. `index.tsx` re-exports by name only
    `WithRequiredAlias` and `WithOptionalAlias` (types an adopter's wrapper can use); the
    resolver, the maps and the reset stay internal:
    - `resolveAliases<P>({props, aliases, component}: {props: object; aliases: Record<string, string>; component: string}): P`
      — `P` is the component's existing props type (for example `ButtonProps`), so the body
      reads existing names with no cast. `aliases` maps alias name → existing name. Returns a
      new object without the alias keys.
      For each alias key present with a value other than `undefined`: if the existing key is
      `undefined`, the existing key takes the alias value; if both are set, the existing value
      is kept and, when `__DEV__` is true, `console.warn` is called once per component+alias
      pair with `"<component>: both <existing> and <alias> were passed; <existing> is used."`
    - `WithRequiredAlias<P, K, A extends string>` — for a required prop. For each member `M`
      of `P` (it must distribute over unions, so it can be nested and applied to props types
      that are already unions, such as SelectField's): `M | (Omit<M, K> & {[key in A]: M[K]})`
    - `WithOptionalAlias<P, K, A extends string>` — for an optional prop, also distributive:
      `M & {[key in A]?: M[K]}`
    - `resetAliasWarnings(): void` — clears the warn-once memory; exported from
      `propAliases.ts` only (not from the package root), for tests' `beforeEach`
    - Wiring pattern, the same in T1–T4: the exported component becomes a thin outer function
      typed with the alias form; it calls `resolveAliases<XProps>` and renders the existing
      component (still typed `FC<XProps>`, body untouched) with the result. `memo` wrappers
      stay on the inner component.
    - named maps `PRESS_ALIASES = {onPress: "onClick"}`,
      `FIELD_ALIASES = {label: "title", error: "errorText"}`,
      `CHANGE_TEXT_ALIASES = {onChangeText: "onChange"}`,
      `MODAL_ALIASES = {isOpen: "visible", onClose: "onDismiss", onPrimaryAction: "primaryButtonOnClick", onSecondaryAction: "secondaryButtonOnClick"}`
    - `Button` is typed `WithRequiredAlias<ButtonProps, "onClick", "onPress">` and resolves
      with `PRESS_ALIASES` first. `ButtonProps` in `Common.ts` is not edited.
  - Cases:
    - `resolveAliases({props: {onPress: f}, aliases: PRESS_ALIASES, component: "Button"})` →
      `{onClick: f}`; no `onPress` key in the result
    - `{onClick: g, onPress: f}` → `{onClick: g}`; `console.warn` called once with
      `"Button: both onClick and onPress were passed; onClick is used."`; a second identical call
      does not warn again
    - `{onPress: undefined, onClick: g}` → `{onClick: g}`, no warning
    - props with no alias keys → equal to the input, other keys untouched
    - `<Button text="Save" onPress={fn} />` → pressing calls `fn` once (after the 500 ms
      debounce rule the existing Button tests already follow); an async `fn` shows the loading
      spinner exactly as `onClick` does
    - `<Button text="Save" onClick={fn} />` behaves as before
    - `withConfirmation` + `onPress`: `fn` runs only after the confirmation modal's primary
      button
    - types: `<Button text="x" onPress={fn} />` and `<Button text="x" onClick={fn} />` compile;
      `<Button text="x" />` is `@ts-expect-error`; `const p: ButtonProps = {text: "x", onClick: fn}`
      compiles; `interface MyProps extends ButtonProps {}` compiles;
      `const q: React.ComponentProps<typeof Button> = p` compiles (a `ButtonProps` value is
      still assignable to the component's props)
    - every warning case calls `resetAliasWarnings()` in `beforeEach`
  - Blast radius: none (no state; `ButtonProps` unchanged)
  - Acceptance: cases pass; `bun run typecheck` and `bun run --cwd ui test:ci` pass. After
    `bun run demo:generate-types`, the `ButtonProps` entry in the generated (git-ignored)
    `demo/ui-types-documentation.json` has `onClick` and no `onPress`.

- [ ] **T2** — Accept onPress on IconButton
  - Depends on: T1
  - Files: ui/src/IconButton.tsx, ui/src/IconButton.test.tsx
  - Seam: rendered `IconButton`; compile-time types
  - Interface: `IconButton` is typed `WithRequiredAlias<IconButtonProps, "onClick", "onPress">`
    and resolves with `PRESS_ALIASES`. `IconButtonProps` is not edited.
  - Cases:
    - `<IconButton iconName="check" accessibilityLabel="Done" onPress={fn} />` → press calls
      `fn` once
    - with `onClick={g}` and `onPress={f}` → `g` called, `f` not called
    - `withConfirmation` + `onPress` → `fn` only after confirming
    - types: neither handler → `@ts-expect-error`; each handler alone compiles
  - Blast radius: none
  - Acceptance: cases pass; `bun run typecheck` passes.

- [ ] **T3** — Accept label, error and onChangeText on form fields
  - Depends on: T1
  - Files: ui/src/CustomSelectField.tsx, ui/src/Slider.tsx, ui/src/SignatureField.tsx, ui/src/TypedSignatureField.tsx, ui/src/SignatureCaptureField.tsx, ui/src/TextField.tsx, ui/src/TextArea.tsx, ui/src/EmailField.tsx, ui/src/NumberField.tsx, ui/src/PhoneNumberField.tsx, ui/src/SelectField.tsx, ui/src/MultiselectField.tsx, ui/src/BooleanField.tsx, ui/src/DateTimeField.tsx, ui/src/RadioField.tsx, ui/src/fieldAliases.test.tsx
  - Seam: rendered field components; compile-time types
  - Interface: each of the 15 listed components (every exported field whose props have
    `title`) resolves `FIELD_ALIASES` at its entry, using
    the T1 wiring pattern. `title` → `label` is typed with `WithOptionalAlias` where `title` is
    optional, and with `WithRequiredAlias` on RadioField and MultiselectField, where `title` is
    required (`Common.ts:2889`, `:3751`). Where the component renders `errorText` today, `errorText` → `error`
    uses `WithOptionalAlias`. Two exceptions: `BooleanField` declares `errorText` but never
    renders it (`ui/src/BooleanField.tsx`), so it gets `label` only (see X9); RadioField gains
    `errorText`, and the `error` alias with it, in T6.
    The five text-entry components (TextField, TextArea, EmailField, NumberField,
    PhoneNumberField) also resolve `CHANGE_TEXT_ALIASES` and are typed with
    `WithRequiredAlias<…, "onChange", "onChangeText">`. `onChangeText` receives the same string
    `onChange` receives (`OnChangeCallback`). EmailField, NumberField and PhoneNumberField
    compute their own validation error and pass it down as `errorText`; they resolve aliases at
    their own entry, before that logic, so a consumer's `error` is treated exactly as a
    consumer's `errorText` is today and no duplicate warning fires. No interface in `Common.ts`
    is edited. `PasswordField` is excluded: it is an empty stub with no props
    (`ui/src/PasswordField.tsx`).
  - Cases:
    - `<TextField label="Email" value="" onChangeText={fn} error="Required" helperText="h" />`
      → text `Email` and `Required` are rendered; typing `a` calls `fn("a")`
    - the same with `title`/`onChange`/`errorText` renders identically (deep-equal trees)
    - `<TextField title="A" label="B" onChange={fn} />` → `A` rendered, `B` not; one warning
      `"TextField: both title and label were passed; title is used."`
    - for each of the 15 components: rendered with `label="Field label"` and no `title` → text
      `Field label` present (table-driven, with each component's minimum valid props)
    - `<EmailField error="Taken" value="not-an-email" onChange={fn} />` → text `Taken` is shown,
      exactly as `errorText="Taken"` renders today, and `console.warn` is not called
    - for each component that renders `errorText` today (all listed except BooleanField and
      RadioField; the test first proves the premise with `errorText="Bad"`): `error="Bad"` →
      text `Bad` present
    - `onChangeText={fn}` with valid input, each compared against a twin rendered with
      `onChange={g}` given the same input (`fn` and `g` receive identical arguments):
      TextField and TextArea `"x"` → `fn("x")`; EmailField `"a@b.co"` → `fn("a@b.co")`;
      NumberField `"5"` → `fn("5")`; PhoneNumberField `"2025550123"` → whatever formatted
      string `g` receives
    - invalid input calls neither name, as today: EmailField `"x"`, NumberField `"x"` → `fn`
      not called
    - types: `<RadioField options={[]} value="" onChange={fn} />` with neither `title` nor
      `label` → `@ts-expect-error`; with `label="L"` alone compiles; same pair for
      MultiselectField
    - types: `<TextField />` with neither `onChange` nor `onChangeText` → `@ts-expect-error`;
      `<SelectField label="S" options={[]} value="" onChange={fn} />` compiles;
      `<SelectField onChangeText={fn} … />` → `@ts-expect-error` (not a text-entry field)
  - Blast radius: none
  - Decomposition note: `label`/`error` and `onChangeText` stay in one task because they are one
    resolver call in the same files; splitting would only add a serial link.
  - Acceptance: cases pass; `bun run typecheck` passes; no committed snapshot changes.

- [ ] **T4** — Accept isOpen, onClose, onPrimaryAction and onSecondaryAction on Modal
  - Depends on: T1
  - Files: ui/src/Modal.tsx, ui/src/Modal.test.tsx
  - Seam: rendered `Modal`; compile-time types
  - Interface: `Modal` resolves `MODAL_ALIASES` using the T1 wiring pattern. `visible` and
    `onDismiss` are required today, so each uses `WithRequiredAlias`, nested (`visible` |
    `isOpen`, then `onDismiss` | `onClose`); because the type distributes, the result is the
    four combinations and each still requires one name from each pair.
    `primaryButtonOnClick` and `secondaryButtonOnClick` are optional, so they use
    `WithOptionalAlias`. `ModalProps` is not edited.
  - Cases:
    - `<Modal isOpen title="T" onClose={fn} />` → title `T` visible; dismissing calls `fn`
    - `<Modal isOpen={false} title="T" onClose={fn} />` → text `T` is not visible, identical to
      `visible={false}` (compare with a twin render rather than asserting an empty tree)
    - `<Modal visible onDismiss={d} primaryButtonText="OK" onPrimaryAction={p} />` → pressing
      `OK` calls `p` once
    - `secondaryButtonText="Cancel" onSecondaryAction={s}` → pressing `Cancel` calls `s`
    - `primaryButtonOnClick={a}` and `onPrimaryAction={b}` together → `a` called, `b` not
    - types: `<Modal onDismiss={fn} />` (no `visible`/`isOpen`) → `@ts-expect-error`;
      `<Modal visible />` (no `onDismiss`/`onClose`) → `@ts-expect-error`;
      `<Modal onClose={fn} />` → `@ts-expect-error`; `<Modal isOpen />` → `@ts-expect-error`;
      `<Modal visible onClose={fn} />` and `<Modal isOpen onDismiss={fn} />` compile
  - Blast radius: none
  - Acceptance: cases pass; `bun run typecheck` passes.

- [ ] **T5** — Accept size "md" on Button
  - Depends on: T1
  - Files: ui/src/Common.ts, ui/src/Button.tsx, ui/src/Button.test.tsx
  - Seam: rendered `Button`
  - Interface: `ButtonProps.size` becomes `"default" | "md" | "sm"`. `"md"` renders exactly as
    `"default"`. The default stays `"default"`. This widens a union; it is the plan's only edit
    to an existing props member.
  - Cases:
    - `<Button text="x" size="md" onClick={fn} />` and `size="default"` → deep-equal rendered
      trees
    - `size="sm"` unchanged (label `fontSize: 14`)
    - no `size` → same tree as `"default"`
  - Blast radius: none
  - Acceptance: cases pass; `bun run typecheck` passes.

- [ ] **T6** — Give RadioField testID, disabled, errorText and helperText
  - Depends on: T3, T5
  - Files: ui/src/Common.ts, ui/src/RadioField.tsx, ui/src/RadioField.test.tsx, demo/stories/RadioField.stories.tsx
  - Seam: rendered `RadioField`
  - Interface: `RadioFieldProps` extends `WithTestID`, `HelperTextProps`, `ErrorTextProps` and
    adds `disabled?: boolean` and `testIDs?: FieldTestIDs`. Test ids follow the field convention
    used by `BooleanField` (`resolveTestId` helpers): root `testID`, each option
    `<testID>.option.<value>`, error and helper from `FieldTestIDs`. When `disabled`, pressing
    an option does not call `onChange`, and option text uses `theme.text.extraLight`. Error
    and helper render through `FieldError` / `FieldHelperText`. `errorPosition` is implemented
    today only inside `TextField`, so RadioField places the error itself: before the first
    option for `"above"` (the default), after the last for `"below"`.
    RadioField's outer alias type gains `WithOptionalAlias<…, "errorText", "error">` in this
    task, and its resolver call already maps it. The demo story gains a disabled and an error variant.
    Roles and checked state are owned by `ui-accessibility` and are not changed here.
  - Cases (options `[{label: "A", value: "a"}, {label: "B", value: "b"}]`, `value="a"`):
    - `testID="rf"` → `getByTestId("rf")`, `getByTestId("rf.option.a")`,
      `getByTestId("rf.option.b")` exist
    - press `rf.option.b` → `onChange("b")` once
    - `disabled` + press `rf.option.b` → `onChange` not called
    - `errorText="Pick one"` → text `Pick one` rendered; `helperText="Any"` → `Any` rendered
    - `error="Pick one"` (alias) → text `Pick one` rendered, and
      `<RadioField label="t" error="e" options={[]} value="" onChange={fn} />` compiles
    - default `errorPosition` → the error node comes before the first option in tree order
    - `errorPosition="below"` → the error node comes after the last option in tree order
    - no `testID` → renders without error, no `testID` props set
    - none of the new props → tree equal to today's
  - Blast radius: `RadioField` is used by ask controls (`ui/src/asks/`) → their existing tests
    still pass unchanged
  - Acceptance: cases pass; `bun run --cwd ui test:ci` and `bun run --cwd demo test:ci` pass.
    Frontend verification (`verify-ui-changes` skill): screenshots of the RadioField demo story's
    disabled and error variants, light and dark, saved to
    `/opt/cursor/artifacts/ui-api-consistency/` and attached to the PR.

- [ ] **T7** — Add testID to components that lack one
  - Depends on: T6
  - Files: ui/src/Common.ts, ui/src/SignatureField.tsx, ui/src/SectionDivider.tsx, ui/src/ErrorPage.tsx, ui/src/SideDrawer.tsx, ui/src/Slider.tsx, ui/src/DismissButton.tsx, ui/src/InfoTooltipButton.tsx, ui/src/Radio.tsx, ui/src/testIdCoverage.test.tsx
  - Seam: rendered components
  - Interface: eight components take no `testID` today: `SignatureField` (an interactive
    field: `SignatureFieldProps` has none and the component spreads no rest), `SectionDivider` (typed `React.FC<{}>`,
    props declared in its own file), `ErrorPage`, `SideDrawer`, `Slider`, `DismissButton`,
    `InfoTooltipButton`, `Radio` (props in `Common.ts`). Each props type extends `WithTestID`
    and the root element carries the `testID` through `toTestProps`
    (`ui/src/testing/resolveTestId.ts`). `DismissButton`'s root is its pressable; `SideDrawer`
    puts `testID` on the drawer content container. Verify, without changing, that these already
    accept and forward `testID`: `Card`, `EditableCard`, `TimezonePicker`, `EmailField`,
    `NumberField`, `PhoneNumberField`, `TextArea`.
  - Cases (table-driven in `testIdCoverage.test.tsx`, each with minimum valid props):
    - for each of the 8 components: rendered with `testID="x"` → `getByTestId("x")` exists
      (`SectionDivider`'s root is `aria-hidden`, so its row queries with
      `{includeHiddenElements: true}`, as `ui/src/Card.test.tsx` does)
    - rendered without `testID` → the tree equals today's
    - for each of the 7 already-covered components: `testID="f"` → `getByTestId("f")` exists
      (if one fails, fix the forward in that file and add it to the commit)
  - Blast radius: none
  - Acceptance: cases pass. Audit correction: of the 48 top-level files with no `testID`
    reference, most are not components (utilities, providers, theme) or forward props through
    a spread; the eight above are the gaps confirmed by reading each file. Left out on purpose
    and listed in Q6: `Body`, `Image`, `UpgradeRequiredScreen`, `DraggableList`. `ModalSheet.tsx`
    exports no component of that name and `PasswordField` is an empty stub, so neither is
    covered.

- [ ] **T8** — Document the aliases and regenerate prop docs
  - Depends on: T1, T2, T3, T4, T5, T6, T7
  - Files: docs/reference/ui.md, changelog/unreleased/ui-conventional-prop-names.md, changelog/unreleased/ui-radiofield-and-testid-coverage.md
  - Seam: repository checks
  - Interface:
    - `docs/reference/ui.md`: a "Conventional prop names" section with the alias table from
      this plan, the rule that the existing name wins with a development warning, and one
      sentence that existing names stay supported and are not deprecated; RadioField's new
      props; the list of components that gained `testID`; Button `size="md"`.
    - Changelog fragments, both `Added`. The prop-names fragment notes that
      `ComponentProps<typeof Button>` (and the other aliased components) is now a union and
      points to the exported props interfaces.
    - No upgrade note: nothing is breaking, changed or deprecated.
    - Run `bun run demo:generate-types` (the output is git-ignored, nothing to commit) and
      check the generated `RadioFieldProps` entry lists `disabled`, `errorText`, `helperText`
      and `testID`, so the demo's prop table shows them.
    - Tell the `docs-match-the-code` plan, in the PR description, that `label`, `error`,
      `onChangeText`, `onPress` and `onPrimaryAction` are now valid, so its doc fixes may keep
      or replace those names.
  - Cases: none (untestable: prose and a generated file; verified by the checks below)
  - Blast radius: none
  - Acceptance: `bun run check:changelog`, `bun run lint`, `bun run --cwd demo test:ci` exit 0.

## Assumptions

- A1. "Docs in the same slice" is met at the PR: T8 writes the reference docs and changelog
  once, because `docs/reference/ui.md` is one file. T8 blocks Brew.
- A2. `Common.ts` is the single props file, so T5 → T6 → T7 are ordered only because they write
  it. T1–T4 avoid it by keeping alias types in `propAliases.ts`.
- A3. Aliases need no new demo story: the reference docs show them and the demo's prop tables
  keep listing the existing names from the unchanged interfaces.
- A4. `__DEV__` is defined in the ui test setup (`ui/src/bunSetup.ts`); if it is not, the
  resolver treats an undefined `__DEV__` as development.
- A5. Every listed field resolves aliases at its own entry, so wrappers that destructure
  `title`, `onChange` or `errorText` before rendering `TextField` see existing names only.
- A6. The proposed alias types were not compiled during planning. If the distributive form
  cannot express a component's props (for example a discriminated union that `Omit` flattens
  badly), T1's implementer writes that component's alias union by hand; the type cases are the
  contract, not the helper's shape.

## Audit corrections

- "`onClick` (7 interfaces)": `Common.ts` declares a top-level `onClick` on five interfaces
  (`BoxPropsBase`, `ButtonProps`, `DismissButtonProps`, `IconButtonProps`,
  `TableIconButtonProps`; `LinkProps` declares one as well) and `onPress` on two (`SocialLoginButtonProps`, `HyperlinkProps`).
  The plan aliases Button and IconButton, the two a new app reaches for.
- "48 component files never reference `testID`": see T7; eight gaps fixed, four left to Q6.
- `PasswordField` is exported but is an empty stub (`ui/src/PasswordField.tsx`); the audit
  lists it among components missing `testID` as if it worked.
- "Button variants are listed as 4; there are 6" and the wrong prop names in `CLAUDE.md` belong
  to `docs-match-the-code`.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 | Should aliases be typed at the component (interfaces unchanged), or added to the exported props interfaces? | At the component | Keeps required handlers required and cannot break `extends ButtonProps` in adopters' code | Adding to interfaces makes `onClick`/`onChange`/`visible`/`onDismiss` optional in the type; T1–T4 are retyped (runtime unchanged), and wrappers typed with the interfaces gain the aliases for free | T1, T2, T3, T4 |
| Q2 | Should the existing names be deprecated in favour of the conventional ones? | No. Both stay, indefinitely | The owner's production app and every adopter use the existing names; deprecation buys churn, not capability | Add `@deprecated` tags and a three-minor window per the versioning policy, plus a codemod task | T8 |
| Q3 | Which names should docs and generators teach? | Keep teaching the existing names; list the aliases once in the reference | One taught name avoids drift; `docs-match-the-code` owns the examples | That plan switches examples to the conventional names; no change here | T8 |
| Q4 | When both names are passed, which wins? | The existing name, with a development warning | Existing code never changes behaviour when someone adds an alias by mistake | Alias wins or a thrown error in development: a one-line change in `resolveAliases` and its tests | T1 |
| Q5 | Should `onPress` also be accepted on Box, DismissButton and TableIconButton? | Not now | Button and IconButton cover the guesses; Box's `onClick` is optional and rarely guessed | Add one task per component, same pattern | none |

| Q6 | Should `Body`, `Image`, `UpgradeRequiredScreen` and `DraggableList` also take `testID`? | Not in this plan | `Body` and `Image` are passive wrappers, `UpgradeRequiredScreen` is a whole screen with its own internal ids, and `DraggableList` needs per-item ids that deserve a design; none blocks a first app's tests | Add them to T7 (root `testID` each; `DraggableList` also `<testID>.item.<key>`) | T7 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Value-based SegmentedControl (`options`, `value`, `onChange(value)`) beside the index-based props | Audit "Value/onChange" exception | S | `ui-accessibility` (tab roles) |
| X2 | Interactive, exported CheckBox (`LabeledCheckBox` exists, unexported) | Audit C2 and "Missing components"; owned by `ui-accessibility` | S | `ui-accessibility` |
| X3 | Type Modal handlers without `any` (`(value?: any) => …`) | Audit "Value/onChange" | S | T4 |
| X4 | `isOpen`/`onClose` vs `visible`/`onDismiss` aliases on SideDrawer, Popover and sheets, in both directions | Audit "Visibility" | S | T1 |
| X5 | `sm`/`md`/`lg` size scale on Button | Audit "Size" | M | `ui-accessibility` (touch targets decide the sizes) |
| X6 | Spinner label prop | Audit "Missing states" | S | `ui-accessibility` |
| X8 | Implement or remove the empty exported `PasswordField` stub (TextField `type="password"` already covers it) | Found while verifying the alias list | S | none |
| X9 | Make `BooleanField` render `errorText` (it declares the prop and ignores it), then give it the `error` alias | Found while verifying the alias list | S | `ui-polish` T11 (same file) |
| X7 | A lint or codegen check that MCP templates, rules and docs teach one name per prop | The Elephant | M | Q3 |

## Decisions

None.

## Dependencies on other plans

- `ui-polish` (sibling) writes `Button.tsx`, `IconButton.tsx`, `RadioField.tsx`,
  `BooleanField.tsx`, `Modal.tsx`, `DateTimeField.tsx`, `MultiselectField.tsx` and `Common.ts`.
  No logical dependency. Build this plan after `ui-polish` merges, or rebase; do not run both
  builds at once.
- `ui-accessibility` edits the same components for roles, labels and touch targets, and owns
  RadioField's role and checked state. Same rule: one at a time.
- `docs-match-the-code` owns the wrong prop names in `CLAUDE.md` and other docs. After this
  plan, `label`, `error`, `onChangeText`, `onPress` and `onPrimaryAction` typecheck, which
  changes what that plan must fix (Q3).
- `batteries` owns app-facing SchemaForm/ResourceList; it should use the existing names.

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagent each), 19 findings: 17 fixed, 1 moved to questions or expansions, 1 rebutted
- Round 1 (3 blocking, 9 other). Blocking: `PasswordField` is an empty stub → removed from the alias table, T3 and T7 (X8). Blocking: `title` is required on RadioField and MultiselectField → those use the required-alias form, with type cases. Blocking: the testID gap list was wrong → re-derived by reading each file. Rebutted: splitting T3 (same files, one resolver call).
- Round 2 (2 blocking, 5 other). Blocking: BooleanField never renders `errorText` → excluded from `error` (X9). Blocking: `onChangeText` cases used input the validating wrappers drop → per-component valid inputs and an invalid-input case. The rest fixed; four components without `testID` moved to Q6.
- Couldn't assess, carried as risk: the alias types were not compiled (A6: the type cases are the contract); whether `<Modal isOpen={false}>` renders nothing in the unit environment on the native branch (T4's test writer asserts the title is absent rather than an empty tree); what typedoc emits for alias-typed signatures (T1 acceptance checks `ButtonProps` only).
