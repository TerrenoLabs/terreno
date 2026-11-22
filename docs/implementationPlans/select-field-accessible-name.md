# SelectField accessible name

**Status:** Draft
**Roadmap:** Area=`ui`, Target=`Next`, Impact=`Fix`
**Branch:**
**Owner:**
**Created:** 2026-10-14

## Goal

When `SelectField` has a `title`, that string is the visible label once and the accessible
name of the focused dropdown. The selected option stays the control’s value. The association
holds while the menu is closed, open, after a selection, and after a rerender, including when
the field is disabled. Consumers pass `title` only.

## Non-Goals

- Labeling `TextField`, `MultiselectField`, `DateTimeField`, or other fields
- Changing `CustomSelectField`’s wrapper (`aria-label="Select dropdown"`) or `SelectBadge`
- `aria-describedby` for `errorText` or `helperText`
- A second visible label, a new required `SelectField` prop, or an `accessibilityLabel` override
- Rebuilding the menu into a full listbox (`role="option"`, `aria-activedescendant`)
- DOM queries, `data-testid` lookups, `MutationObserver`, or consumer patches
- Giving an untitled field a new accessible name

## Decisions

| Question | Decision |
| --- | --- |
| What is the accessible name? | The `title` string. `useId()` (colons removed) is the label id. `FieldTitle` receives it as `nativeID`. |
| How does web name the control? | `accessibilityLabelledBy` on the focused trigger, which React Native Web writes as `aria-labelledby`. The visible title is the name (WCAG 2.5.3). |
| How does web expose the value? | The trigger’s own value: the searchable input’s `value` when closed, and the non-searchable trigger’s option text. `aria-valuetext` is not used. ARIA allows it on range widgets, and React Native Web does not map `accessibilityValue.text` onto the DOM. |
| What role does the web trigger use? | `combobox`, with `aria-expanded` and `aria-haspopup="listbox"`. A plain button name replaces its contents, so the selection would disappear. |
| How does iOS name the control? | `accessibilityLabel={title}` on the focused trigger. React Native’s iOS view applies `accessibilityLabel` and `accessibilityValue`, and does not apply `accessibilityLabelledBy`. |
| How does iOS expose the value? | `accessibilityValue={{text: selectedLabel}}` on that same trigger. Inner text is not a second accessibility element. |
| How does Android name the control? | `accessibilityLabelledBy` set to the title `nativeID`. React Native Android calls `setLabeledBy`. |
| How does Android expose the value? | The selected option stays the control’s text. `accessibilityLabel` is not set on Android: TalkBack returns only the content description and drops the selection. `accessibilityValue.text` is not set either: Android applies `accessibilityValue` only when `min`, `now`, and `max` are all present. |
| What is the menu search name? | When `title` is set, the separate `WebDropdownMenu` search input (native searchable menus) is named `Search {title} options`. The trigger keeps `title`. |
| What happens to the web chevron? | It stays clickable and leaves the accessibility tree and tab order (`accessible={false}`, `tabIndex={-1}`). Escape already closes the web menu. A second name containing the title would compete with the combobox. |
| What if `title` is absent? | No label id, no new names. The existing `textInputProps.accessibilityLabel` placeholder stays only on the input that already receives it. |

## Architecture

`SelectField` owns the visible title. `RNPickerSelect` owns the focused control. The label id
is created in `SelectField` and passed down. `useId()` runs on every render; the id is applied
only when `title` is non-empty.

| Platform | Focused control | Name | Value |
| --- | --- | --- | --- |
| Web, search on (default) | Trigger `TextInput` | `aria-labelledby` → `FieldTitle` | Input `value` (selection when closed, query while open) |
| Web, `disableSearch` | Trigger `Pressable` | `aria-labelledby` → `FieldTitle` | Option text inside the combobox |
| iOS, search on or off | Trigger `Pressable` (search on uses the custom menu; search off uses the modal picker trigger) | `accessibilityLabel={title}` | `accessibilityValue.text` = selected label |
| Android, search on (default) | Custom-menu `Pressable` | `accessibilityLabelledBy` | Selected label as the control’s text |
| Android, `disableSearch` | Native `Picker` | `accessibilityLabelledBy` | Picker’s selected item text |
| Native menu search | `WebDropdownMenu` search `TextInput` | `Search {title} options` | The query |

Web search lives in the trigger, so that input keeps the title as its name while open. The
native menu renders a separate search field and receives `searchAccessibilityLabel`.

Disabled fields keep the same name and value. `disabled` remains on the control.

The current `textInputProps.accessibilityLabel: title ?? placeholder` reaches only some
`TextInput`s. Titled fields stop using it. The placeholder label remains for untitled fields
on that input.

## UI

```tsx
<SelectField
  title="Insurance provider"
  options={[{label: "Aetna", value: "aetna"}]}
  value="aetna"
  onChange={setProvider}
/>
```

Sighted users see “Insurance provider” once. Assistive technology gets that string as the
name and “Aetna” as the value.

## Phases

1. Web searchable trigger: label id, `FieldTitle` id, `aria-labelledby`, value, hidden chevron.
2. Web non-searchable trigger, open state, selection, disabled, rerender.
3. iOS and Android triggers, plus the native menu search name.

## Feature Flags & Migrations

None. Existing `title` props gain the name. No consumer change.

## Not Included / Future Work

- `CustomSelectField` still wraps `SelectField` in a control named “Select dropdown”. That
  wrapper can be what assistive technology focuses. Fixing it is a separate change.
- Untitled search fields still use the placeholder “Search…”. Placeholders are not labels
  (WCAG 3.3.2). This slice leaves untitled fields as they are.
- Other form fields still render `FieldTitle` without an id.

## Files to Create / Modify

- `ui/src/SelectField.tsx`
- `ui/src/SelectField.test.tsx`
- `ui/src/SelectField.web.test.tsx` (browser-backed name assertion, or the demo Playwright check named in the tasks)
- `ui/src/fieldElements/FieldTitle.tsx`
- `ui/src/fieldElements/FieldTitle.test.tsx`
- `ui/src/PickerSelect.tsx`
- `ui/src/PickerSelect.test.tsx`
- `ui/src/WebDropdownMenu.tsx`
- `ui/src/WebDropdownMenu.test.tsx`
- `ui/src/Common.ts` (JSDoc on `title` and any new picker props)
- `docs/reference/ui.md`
- `changelog/unreleased/select-field-accessible-name.md`

## Task List

[docs/tasks/select-field-accessible-name.md](../tasks/select-field-accessible-name.md)

## Acceptance Criteria

- [ ] A titled searchable `SelectField` exposes `title` as the accessible name of the closed trigger, and the title text is on screen once
- [ ] A titled non-searchable `SelectField` exposes the same name
- [ ] The name is present while the menu is closed, while it is open, after a selection, and after a rerender
- [ ] The selected option is the value: input value or combobox text on web, `accessibilityValue.text` on iOS, control text on Android
- [ ] The web chevron is not a second named control
- [ ] The native menu search is named `Search {title} options` and the trigger stays named `title`
- [ ] A disabled titled field keeps the name and the disabled state
- [ ] A field without `title` keeps today’s placeholder labeling and gains no new name
- [ ] iOS uses `accessibilityLabel` and `accessibilityValue`; Android uses `accessibilityLabelledBy` and the selected text
- [ ] Existing `SelectField` and `PickerSelect` tests pass
- [ ] `docs/reference/ui.md`, JSDoc, and `changelog/unreleased/select-field-accessible-name.md` describe `title` as the visible label and the accessible name, including the iOS and Android mechanisms
