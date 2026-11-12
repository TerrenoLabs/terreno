# @terreno/ui — technical UI/UX audit (via demo app)

Fix first: replace the invalid `aria-role` prop (46 uses, 27 files) with `role` / `accessibilityRole`. In the rendered web DOM almost every pressable in the library has no role at all.

## Capture

- Demo: `bun run demo:start` on port 8085 (dev Metro build, web), stopped after the audit. No code edited.
- Viewports: 1280x800 (desktop), 768x1024 (tablet), 375x812 (mobile). Dark mode via `?theme=dark` at 1280x800. Extra 1280x2400 and 375x2400 "tall" captures for Text field, DataTable, Banner, Card (light + dark).
- Screenshots: `/opt/cursor/artifacts/ui-audit/` (about 110 PNGs), named `<Component>-<desktop|tablet|mobile|tall|mtall>-<light|dark>.png`.
  - Desktop light (35 pages): home, Button, IconButton, Textfield, Selectfield, DateTimefield, CheckBox, Booleanfield, Radiofield, Modal, Toast, DataTable, Card, Page, Box, Spinner, Skeleton, Badge, Banner, Tooltip, Popover, Accordion, Segmentedcontrol, Pagination, FormContainer, Field, LineChart, BarChart, DonutChart, Avatar, ErrorPage, LoginScreen, Sidedrawer, Text, Heading.
  - Tablet + mobile light, desktop dark (17 pages each): Button, IconButton, Textfield, Selectfield, DateTimefield, CheckBox, Modal, Toast, DataTable, Card, Page, Badge, LineChart, Segmentedcontrol, Pagination, LoginScreen, Banner (+ Spinner, Skeleton, Tooltip in dark).
  - Keyboard run: `kb-button-focus.png`, `kb-modal-open.png`, `kb-modal-focus.png`, `kb-textfield-focus.png`, `kb-toast.png`.
- Playwright probes (Chromium, web only): Tab order and focus styles, Modal open/trap/Escape/return, rendered roles and ARIA state per page, live regions after a toast, touch-target sizes at 375px, document horizontal overflow at all three widths.
- Not assessed: native iOS/Android rendering (ActionSheet modal, native pickers, safe-area on device, haptics). Items that rest on native behaviour are marked SUSPECTED. About a third of the PNGs were opened and read; the rest were checked only by the scripted overflow/DOM probes.

## Findings

### Critical (blocks usability / accessibility)

| # | Before | After | Why |
| --- | --- | --- | --- |
| C1 | `aria-role="button"` on Pressables: 46 uses in 27 files, e.g. `/workspace/ui/src/IconButton.tsx:127`, `Accordion.tsx:61`, `RadioField.tsx:24`, `SegmentedControl.tsx:98`, `BooleanField.tsx:102`, `Banner.tsx:39`, `Modal.tsx:99`. `aria-role` is not a React Native or ARIA attribute, so RNW drops it. Measured: whole pages render exactly one `role="button"` (the one real `Button`), and 10 to 38 focusable `div`s with no role. | Use `role="button"` (or `accessibilityRole`) everywhere; add a lint rule banning `aria-role`. | Screen readers announce IconButton, switch, radio, segment, accordion trigger and banner action as plain text. RNW only maps Space to press for button roles: Space on the modal close X did nothing, Enter worked (verified). |
| C2 | No state semantics. On the CheckBox, Boolean field, Radio field, Segmented control, Accordion and Pagination pages the DOM contains zero `aria-checked`, `aria-expanded`, `aria-selected`, `aria-current`. `CheckBox` (`/workspace/ui/src/CheckBox.tsx:8-50`) is a bare `View`: no role, no label, no `onChange`, not focusable. | `role="switch"`/`checkbox`/`radio`/`tab` plus `accessibilityState` (`checked`, `expanded`, `selected`); `aria-current="page"` in Pagination; make `CheckBox` an interactive control (the internal `LabeledCheckBox.tsx:64-73` already does it correctly and is not exported). | State is conveyed only by color and position. A consumer cannot build an accessible checkbox, switch or radio group from the public API. |
| C3 | Every `TextField` has the accessible name "Text input field" even with a visible `title` (`/workspace/ui/src/TextField.tsx:361`); 8 of 8 inputs on the Text field page measured identical. `aria-describedby` points at `fieldTestIDs.error` (`TextField.tsx:359`), so it is unset unless the consumer passes a `testID`: the error-state input had `aria-invalid="true"` and `aria-describedby=null`. | Default `aria-label` to `title`; generate ids with `useId` for title, helper and error and wire `aria-labelledby` / `aria-describedby` independent of test ids. | A form of several fields reads as "Text input field" five times. Error text is never announced. Accessibility must not depend on a testing prop. |
| C4 | Toasts have no live region. After triggering a toast the page had no `role="alert"`, `role="status"` or `aria-live` node; no file in `ui/src` besides `Box.tsx` references `aria-live`/`accessibilityLiveRegion` (`/workspace/ui/src/Toast.tsx`, `ToastNotifications.tsx`). | `role="status"` + `aria-live="polite"` for info/success, `role="alert"` for error/warn; `accessibilityLiveRegion` on Android, `AccessibilityInfo.announceForAccessibility` on iOS. | The framework's primary feedback channel (`useToast`, `toast.catch`) is silent to screen-reader users. |
| C5 | Modal (web): `role="dialog" aria-modal="true"` but no `aria-label`/`aria-labelledby`. First focus lands on the 1280x800 backdrop Pressable, which is tabbable and has no role. The opener is blurred before open (`/workspace/ui/src/Modal.tsx:241-250`), so after Escape focus is on `<body>`, not the trigger. Close "X" target is 16x16. Screenshots `kb-modal-open.png`, `kb-modal-focus.png`. | Label the dialog from `title`; take the backdrop out of the tab order; move initial focus to the first control or the dialog container; remember and restore the opener; make the close control at least 44x44. | Trap and Escape work, but a keyboard user loses their place every time a modal closes, and the dialog is announced without a name. |
| C6 | Touch targets under 44px at 375px (measured): Button 34 high (`Button.tsx:200-204`, `sm` is 28), IconButton 32x32 / 28x28 with no `hitSlop` (`IconButton.tsx:156-158`), Pagination 32x32, SegmentedControl 32 high, calendar toggle 34x32, Banner action 24 high, Accordion chevron 16x16 (its `hitSlop` at `Accordion.tsx:62` has no effect on web), Radio 16x16 (`Radio.tsx:16-18`), modal close 16x16. | 44px minimum height on default sizes, or a default `hitSlop` plus padding on web; keep `sm` as an explicit dense opt-in. | Every default control misses the 44px floor on a library whose pitch is mobile-first universal apps. |

### High-impact (immediately noticeable)

| # | Before | After | Why |
| --- | --- | --- | --- |
| H1 | Two typefaces out of the box. Body and headings use the theme fonts; Button labels, field titles, helper/error text, banner text and dropdown items fall back to the system sans (Arial in Chromium). Cause: raw `react-native` `Text` with no `fontFamily` in 20 files, e.g. `/workspace/ui/src/Button.tsx:232`, `fieldElements/FieldTitle.tsx:22-34`, `FieldHelperText.tsx:19`, `FieldError.tsx:26`. Screenshots `Textfield-desktop-light.png`, `Button-desktop-light.png`, `Banner-tall-light.png`. | Route all text through the library `Text` or apply the theme font tokens in these files. | The most visible reason an unstyled Terreno app looks generic rather than designed: the button and the label next to it are in different fonts. |
| H2 | White text on the warning fill `#F36719` is 2.52:1, documented in the theme's own comment (`/workspace/ui/src/Theme.tsx:88,103,162,228`). Seen on warning Toast (12px body text) and warning Banner: `kb-toast.png`, `Banner-tall-light.png`. | Dark text on the warning fill, or the darker `warning200` in light mode as dark mode already does. | Fails WCAG AA (4.5:1) on the state that most needs to be read. |
| H3 | Hard-coded colors bypass the theme (77 literals outside `Theme.tsx`): `Badge.tsx:67-73`, `SelectBadge.tsx:38-43,151,171`, `ToastNotifications.tsx:355-364,439,760`, `PickerSelect.tsx:66,74,321-322,395,522`, `ActionSheet.tsx:36,135`, `Modal.tsx:310,332`, `Box.tsx:345`, `DraggableList.tsx:314`, `Avatar.tsx:264-265`. Another 14 call sites read `theme.primitives.*` directly (`Spinner.tsx:13-20`, `SegmentedControl`, `IconButton`). | Add semantic tokens (badge fills, overlay scrim, sheet surface, shadow) and consume them. | A consumer re-theming via `TerrenoProvider` cannot change these. SUSPECTED: light-gray native picker and action-sheet surfaces (`#f8f8f8`, `#f0f0f0`) in dark mode; web dark mode looked complete in the pages captured. |
| H4 | Reduced motion is honored only by `Skeleton` (`/workspace/ui/src/Skeleton.tsx:88-93`). Button press scale, ActionSheet, ModalSheet, Toast, BooleanField, DraggableList and native SidebarNavigation animate unconditionally. | One shared `useReducedMotion` hook (AccessibilityInfo + `prefers-reduced-motion` on web) used by every animated component. | Required check; currently one of seven animated components passes. |
| H5 | `BooleanField` runs four animations with `useNativeDriver: false`, including the thumb translate spring (`/workspace/ui/src/BooleanField.tsx:40-62`). | Translate on the native driver; cross-fade color with opacity or Reanimated `interpolateColor`. | JS-thread animation on the most common toggle; janks when the press handler does work. |
| H6 | Responsive checks are not reactive: `isNarrowViewport()` / `mediaQuery*()` read `Dimensions.get("window")` at call time (`/workspace/ui/src/MediaQuery.ts:24-48`), 15 call sites in 11 files (`Button.tsx:342`, `FieldTitle.tsx:19`). | Hook built on `useWindowDimensions`. | Resizing the browser or rotating a tablet leaves components in the old layout until something else re-renders. |
| H7 | SelectField on web takes three tab stops per field (an input, a second input, an 11x13 unlabeled div), opens its dropdown on focus, and exposes no `combobox`/`listbox`/`option` roles; the wrapper is a focusable div with no role (`web_picker`). Verified in the Tab log; `kb-button-focus.png`. | One tab stop with `role="combobox"`, `aria-expanded`, `aria-controls`; open on Enter/Space/ArrowDown; options as `role="option"`. | Tabbing through a form pops a menu open at every select, and assistive tech cannot identify the control. |
| H8 | DataTable at 375px: the table keeps its fixed width, is clipped by its container, and the pagination row is cut off mid-number (`DataTable-mobile-light.png`). No document-level horizontal scroll at 1280/768/375. Alternating rows use a heavy mid-gray. SUSPECTED: whether the clipped area scrolls horizontally by touch. | Keep pagination outside the scrolling region and sized to the viewport; visible scroll affordance; lighter stripe token. | The flagship data component is the one that visibly breaks on a phone. |
| H9 | The documented API does not exist. `/workspace/CLAUDE.md` shows `TextField label / onChangeText / error` and `Modal onPrimaryAction`; real props are `title / onChange / errorText` (`/workspace/ui/src/Common.ts:1108-1135`) and `primaryButtonOnClick` (`Common.ts:2776-2834`). `onChangeText` and `onPrimaryAction` occur 0 times in `Common.ts`. Button variants are listed as 4; there are 6 (`Common.ts:2419`). | Correct the examples, or better, add the conventional names as aliases. | Agents are told these names in the always-loaded project instructions, so first-prompt code fails typecheck. |
| H10 | `Heading` only emits `role="heading"` when `level` is passed (`/workspace/ui/src/Heading.tsx:44-46`); each demo page exposes one heading in the accessibility tree despite 6 to 10 visual headings. | Derive a default level from `size`. | Screen-reader heading navigation does not work by default. |

### Quick wins (polish)

| # | Before | After | Why |
| --- | --- | --- | --- |
| Q1 | `accessibilityHint={`Select ${option} from list of options`}` interpolates the option object (`/workspace/ui/src/RadioField.tsx:22`). | `option.label ?? option.value`. | Hint reads "Select [object Object] from list of options". |
| Q2 | Pagination controls are all labelled "Pagination Button" / "Pagination Number" (`/workspace/ui/src/Pagination.tsx:34,62`); the current page differs only by text color. | "Previous page", "Next page", "Page 3"; `aria-current`; weight or underline on the current page. | Color-only state, indistinguishable labels. |
| Q3 | Banner status (info / warning / alert) is conveyed by fill color alone unless `hasIcon` is set (`Banner-tall-light.png`). | Default status icon per status; `role="status"`/`alert`. | Color must not be the only signal. |
| Q4 | `RadioFieldProps` has no `testID`, `disabled`, `errorText` or `helperText` (`/workspace/ui/src/Common.ts:2888-2893`); 48 component files never reference `testID` (Card, Slider, TextArea, NumberField, PasswordField, SideDrawer, SectionDivider, ErrorPage among them; some forward props, not individually verified). | Extend `WithTestID` and the helper/error mixins everywhere. | The project's own Playwright rules require a testID on every interactive element. |
| Q5 | Dated defaults: Box shadow is a hard-coded opaque gray `2px 2px 2px rgba(153,153,153,1)` (`/workspace/ui/src/Box.tsx:345`); modal scrim and shadow are literals (`Modal.tsx:88,332`); the modal close is a small text-like "X". | Soft tokenized elevation scale; a proper close IconButton. | Cheap changes with a large effect on perceived quality. |
| Q6 | In narrow containers the BooleanField title wraps and the switch is pushed outside its parent (`Button-mobile-light.png`, `Selectfield-mobile-light.png`). | `flexShrink: 1` on the title, fixed-size switch. | Overflow at 375px. |
| Q7 | LoginScreen account chip at 375px breaks the email mid-word ("grace@exa / mple.com") (`LoginScreen-mobile-light.png`). | Single line with ellipsis, or stack "Not you?" below. | First screen every end user sees. |
| Q8 | Demo app: unknown routes silently render the home page (`/demo/TextField` vs the real `/demo/Text field`); catalog names mix styles ("Text field", "DataTable", "Segmented control"); on mobile the preview and controls stay side by side and "Dev Mode" is clipped; cold load logs dozens of FontAwesome/Material font-fetch timeouts (12s). | 404 with suggestions, one naming style, stacked layout under 768px, preload icon fonts. | The demo is the library's storefront. |

## Component API consistency

- **Press handlers:** `onClick` (7 interfaces: Button, IconButton, Banner, Modal's `primaryButtonOnClick`) vs `onPress` (2). Consistent enough, but it is the opposite of the React Native convention and of every peer library, so both humans and agents guess wrong. Offer `onPress` as an alias.
- **Field label:** `title` on fields (32 occurrences) vs `label` elsewhere (8). Peers use `label`. Error is `errorText` (7 interfaces), helper is `helperText` (8): consistent.
- **Value/onChange:** mostly `value` + `onChange(value)`, which is good. Exceptions: `SegmentedControl` is index-based (`items: string[]`, `selectedIndex`, `onChange(activeIndex)`, `Common.ts:1085-1092`); `CheckBox` uses `selected` with no handler; `Modal` handlers are typed `(value?: any)`.
- **Visibility:** `visible` (2) vs `isOpen` (3); `onDismiss` (3) vs `onClose` (3).
- **Size:** Button is `"default" | "sm"` (`Common.ts:2408`), others `"sm" | "md" | "lg"`.
- **State props:** `disabled` (20) and `loading` (8) are consistent. Button auto-shows loading while an async `onClick` is pending (`Button.tsx:258-281`), which is a strong default. RadioField has neither `disabled` nor error/helper props.
- **Test ids:** `testID` plus a typed `testIDs` map for sub-parts is a good pattern, applied to roughly two thirds of components.
- **Missing states:** empty state exists only as `DataTable.emptyContent` and chart `emptyText`; no shared EmptyState. Skeleton exists. Spinner has a 300ms show delay (good) and no label prop.

## Missing components versus peers (shadcn/ui, Tamagui, gluestack, Paper, Mantine)

Verified by listing `/workspace/ui/src` and `index.tsx` exports.

| Component | Status | Evidence |
| --- | --- | --- |
| Accordion, Avatar, Badge, Banner, Skeleton, Tooltip, Popover, Pagination, Slider, OTP, Side drawer, charts, Markdown editor, Signature, DraggableList | Present | `Accordion.tsx`, `Avatar.tsx`, `Skeleton.tsx`, `Tooltip.tsx`, `Popover.tsx`, `Pagination.tsx`, `OtpField.tsx`, `SideDrawer.tsx` |
| Bottom sheet | Present | `ActionSheet.tsx`, `ModalSheet.tsx` |
| Checkbox | Partial | `CheckBox.tsx` is display-only; interactive `LabeledCheckBox.tsx` is not exported |
| Switch | Partial | `BooleanField.tsx` only; no role/state (C1, C2) |
| Tabs | Partial | `SegmentedControl.tsx` only; no tablist/tabpanel, index-based |
| Combobox / autocomplete | Partial | `SelectField` has search; address autocompletes only; no async or creatable combobox |
| Form wrapper with validation | Partial | `FormContainer.tsx` renders a `<form>` and submit handling; no schema, field state or error mapping |
| File upload | Partial | `FilePickerButton.tsx`; no dropzone or progress |
| Menu | Partial | `WebDropdownMenu.tsx`, `DropdownPanel.tsx`; no context menu |
| Carousel | Partial | `Swiper` exported from `signUp/` only |
| Empty state | Absent | no component; only per-component props |
| Command palette | Absent | no match in `ui/src` |
| Stepper / wizard | Absent | no match |
| Breadcrumbs | Absent | no match |
| Progress bar | Absent | Spinner only |
| Dropzone, Chip/tag input, Timeline, Tree, Rating, Toggle group | Absent | no match |
| Date range picker | SUSPECTED absent | `DateTimeField` only; not exercised |

## Craft Report

- **Checked:** accessibility (roles, names, state, focus visibility, Tab order, Modal trap/Escape/return, live regions, touch targets, color-only signals, contrast from theme values, reduced motion), performance (animation drivers, non-reactive layout reads), responsive (1280/768/375, document overflow, fixed widths, safe-area usage in code), plus consumer API consistency, theming and component coverage. Web only, light and dark.
- **Passed:**
  - Visible focus on every focused element in the Tab runs (browser focus ring on pressables; custom 3px border on TextField, `kb-textfield-focus.png`).
  - Modal focus trap and Escape-to-close.
  - No document horizontal scroll at 1280, 768 or 375 on any captured page.
  - Dark mode complete on all captured web pages (`DataTable-desktop-dark.png`, `Card-desktop-dark.png`, `Toast-desktop-dark.png`, `LineChart-desktop-dark.png`).
  - `Button` renders a real `role="button"` with `accessibilityState`; DataTable cells expose button roles.
  - Safe-area insets used in `ActionSheet`, `Box`, `Page`, `SideDrawer`, `ToastNotifications`, `ListDetailLayout`.
  - Native-driver animations in `ActionSheet` and `SidebarNavigation.native`.
- **Changed:** none.
- **Verdict:** not ready to be called best-in-class on accessibility. Top priority is C1 to C4: one mechanical fix (`aria-role` to `role`), state attributes, field labelling, and a toast live region would move most components from unannounced to usable. H1 (single typeface) is the highest-return visual fix.

Next action: grep `aria-role` in `/workspace/ui/src` and decide whether C1 ships as one mechanical PR (about 27 files).
