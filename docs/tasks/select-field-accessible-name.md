# SelectField accessible name

**Plan:** [select-field-accessible-name.md](../implementationPlans/select-field-accessible-name.md)
**Feature profile:** true

### Phase 1: Web searchable name

- [ ] **Task 1**: Title names the closed web searchable trigger
  - Delivers: `title="Insurance provider"` renders once, and the closed web searchable input’s accessible name is “Insurance provider” while its value is the selected option
  - Files: `ui/src/fieldElements/FieldTitle.tsx`, `ui/src/fieldElements/FieldTitle.test.tsx`, `ui/src/SelectField.tsx`, `ui/src/SelectField.web.test.tsx`, `ui/src/PickerSelect.tsx`, `ui/src/Common.ts`, `docs/reference/ui.md`, `changelog/unreleased/select-field-accessible-name.md`
  - Blocked by: none
  - Acceptance: `useId()` runs unconditionally and the id (colons removed) is passed to `FieldTitle` as `nativeID` only when `title` is non-empty. The web searchable `TextInput` sets `accessibilityLabelledBy` to that id and does not set `accessibilityLabel` to the title. Role is `combobox` with `aria-expanded` and `aria-haspopup="listbox"`. Closed value is the selected label. The chevron stays clickable, with `accessible={false}` and `tabIndex={-1}`. Browser proof: demo SelectField story, Playwright `getByRole('combobox', {name: 'Insurance provider'})` and the selected value (`toHaveValue` or the accessibility value), and the title string occurs once. `bun test ui/src/SelectField.web.test.tsx ui/src/fieldElements/FieldTitle.test.tsx`. JSDoc states that `title` is the visible label and the accessible name. `docs/reference/ui.md` has a SelectField accessible-name section. Changelog fragment category `Fixed`.
  - Docs: `docs/reference/ui.md`, JSDoc on `SelectField` `title` and `FieldTitle` `nativeID`, `changelog/unreleased/select-field-accessible-name.md`
  - Skills: `terreno-ui`, `update-docs`, `accessibility-testing`, `verify-ui-changes`

### Phase 2: Web non-searchable, open, select, disabled

- [ ] **Task 2**: Web name survives open, selection, rerender, and disabled
  - Delivers: searchable and non-searchable web triggers keep the title as the name while open, after a choice, after rerender, and when disabled; the selection stays the value
  - Files: `ui/src/PickerSelect.tsx`, `ui/src/SelectField.web.test.tsx`, `ui/src/PickerSelect.test.tsx`, `docs/reference/ui.md`
  - Blocked by: Task 1
  - Acceptance: `disableSearch` Pressable is a `combobox` named via `aria-labelledby`, and its option text is the value. Opening the menu leaves the trigger named; on the searchable input the name stays the title while the value becomes the query. Choosing an option restores the selected label as the value and leaves the name. Rerender with the same `title` keeps one title node and the same label id. `disabled` keeps the name and exposes disabled. Untitled web field still has no label id. Browser Playwright covers closed, open, after select, and disabled for both variants. `bun test ui/src/SelectField.web.test.tsx ui/src/PickerSelect.test.tsx`.
  - Docs: `docs/reference/ui.md` (open, disabled, non-searchable rows)
  - Skills: `terreno-ui`, `update-docs`, `accessibility-testing`, `verify-ui-changes`

### Phase 3: iOS, Android, and menu search

- [ ] **Task 3**: Native triggers and the menu search
  - Delivers: iOS and Android focused controls announce the title as the name and the selection as the value; the native menu search is named `Search {title} options`
  - Files: `ui/src/PickerSelect.tsx`, `ui/src/PickerSelect.test.tsx`, `ui/src/SelectField.test.tsx`, `ui/src/WebDropdownMenu.tsx`, `ui/src/WebDropdownMenu.test.tsx`, `docs/reference/ui.md`, `changelog/unreleased/select-field-accessible-name.md`
  - Blocked by: Task 1
  - Acceptance: With `Platform.OS` `ios`, the focused trigger has `accessibilityLabel` equal to `title` and `accessibilityValue.text` equal to the selected label, including `disableSearch`, the default searchable menu, and `disabled`. Inner text is not a second accessibility element. With `Platform.OS` `android`, the focused trigger (custom Pressable when search is on, native `Picker` when `disableSearch`) has `accessibilityLabelledBy` equal to the title `nativeID` and does not set `accessibilityLabel` or `accessibilityValue`. The selected label remains the control’s text. The `WebDropdownMenu` search input used by native searchable menus has accessible name `Search {title} options` while the trigger name stays `title`. Untitled native fields gain none of these props. `bun test ui/src/SelectField.test.tsx ui/src/PickerSelect.test.tsx ui/src/WebDropdownMenu.test.tsx` passes, including the existing suites. Docs and the changelog fragment describe the iOS and Android mechanisms.
  - Docs: `docs/reference/ui.md`, JSDoc on the picker labeling props and `searchAccessibilityLabel`, `changelog/unreleased/select-field-accessible-name.md`
  - Skills: `terreno-ui`, `update-docs`, `accessibility-testing`, `verify-ui-changes`
