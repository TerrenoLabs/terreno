# @terreno/ui

React Native UI component library (a large component library). Layout (Box, Page, Card), forms (TextField, SelectField), display (Text, DataTable), actions (Button), feedback (Modal, Toast), and theming via TerrenoProvider.

## Key exports

- Layout: `Box`, `Page`, `SplitPage`, `Card`, `DashboardGrid`
- Forms: `TextField`, `SelectField`, `DateTimeField`, `CheckBox`
- Display: `Text`, `Heading`, `Badge`, `DataTable`, `LineChart`, `BarChart`, `AreaChart`, `DonutChart`
- Actions: `Button`, `IconButton`, `Link`
- Feedback: `Spinner`, `Modal`, `Toast`
- Notifications: `NotificationBell`, `NotificationInbox`, `NotificationPreferences`
- AI chat: `GPTChat`, `AskCard` (agent asks in the transcript), `SimpleAskCard` (an ask's simple card for narrow layouts)
- Authentication: `SocialLoginButton`, `LoginScreen`, `SignUpScreen`
- Theming: `TerrenoProvider`, `useTheme`, custom icon registry (`icons` prop)
- **Type re-exports:** `StyleProp`, `ViewStyle` (re-exported from react-native to avoid version conflicts)

## Performance-sensitive imports

Use a component subpath when startup parse and evaluation cost matters:

```typescript
import {Box} from "@terreno/ui/Box";
import {DataTable} from "@terreno/ui/DataTable";
import {Icon} from "@terreno/ui/Icon";
```

Every compiled UI module is available through `@terreno/ui/<Module>`. Existing
`@terreno/ui/dist/<file>` imports still resolve to the compiled `.js` / `.d.ts` files. The root import remains fully
supported and is convenient when startup cost is not material:

```typescript
import {Box, DataTable, Icon} from "@terreno/ui";
```

Heavy optional widgets (`GPTChat`, `AskCard`, `EmojiSelector`, `MarkdownEditor`, consent flows, `LineChart`, `BarChart`, `AreaChart`, `DonutChart`, and related admin tools) are
re-exported from the root entry through lazy boundaries. Importing them from `@terreno/ui` stays type-compatible, but
their implementation modules load on first render instead of during the initial root import. `DashboardGrid` stays eager.
their implementation modules load on first render instead of during the initial root import. `MarkdownView` and
`DataTable` header info defer `react-native-markdown-display`; `EmojiSelector` defers `emoji-datasource` until open.

For the smallest cold-start graph, keep using subpaths for screens that only need a few primitives (for example
`import {Button} from "@terreno/ui/Button"`).

## Type Re-exports

@terreno/ui re-exports commonly-used React Native types to help consumers avoid version conflicts:

``````typescript
import {StyleProp, ViewStyle} from "@terreno/ui";

// Use these instead of importing from react-native directly
const customStyle: StyleProp<ViewStyle> = {
  flex: 1,
  backgroundColor: "#fff",
};
``````

**Benefits:**
- Avoids version mismatches between your app's react-native and @terreno/ui's react-native
- Ensures type compatibility when passing styles to @terreno/ui components
- Simplifies imports (one package instead of two)

### DashboardGrid

Eager layout-only wrapping grid. Default columns `{sm: 1, md: 2, lg: 3}`. Children stay caller-supplied `Card`s. Cell width is `(rowWidth - gap × (columns - 1)) / columns` so flex `gap` does not wrap extra columns.

```tsx
<DashboardGrid>
  <Card>
    <LineChart data={points} legendLabel="Signups" />
  </Card>
</DashboardGrid>
```

### LineChart

Single-series line chart drawn with `react-native-svg`. Empty data shows `emptyText` (default `"No data"`). `loading` shows a `Spinner`. Press or hover a point for `{label}: {value}`.

```tsx
<LineChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  legendLabel="Signups"
  testID="signups"
/>
```

Hit targets use `Box` `onClick`, so testIDs are `{testID}.point.{index}-clickable`.

### BarChart

Single-series bar chart on the same owned-SVG contract as `LineChart` (empty, loading, legend, tooltip).

```tsx
<BarChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  legendLabel="Signups"
  testID="signups-bar"
/>
```

### AreaChart

Filled area plus line on the same owned-SVG contract as `LineChart`.

```tsx
<AreaChart
  data={[{label: "Mon", value: 3}, {label: "Tue", value: 5}]}
  legendLabel="Signups"
  testID="signups-area"
/>
```

### DonutChart

One slice per `{label, value}` point. Per-slice `color` overrides the theme paint. Legend is one row per slice (`legendLabel` is ignored).

```tsx
<DonutChart
  data={[{label: "Open", value: 3}, {color: "#112233", label: "Closed", value: 5}]}
  testID="status-donut"
/>
```

### Chart visual regression

`bun run ui:charts:compare` screenshots `http://localhost:8085/demo/chart-visual-gallery`
and diffs each fixture against `demo/rendered-snapshots/<id>.png`.
`bun run ui:charts:update-snapshots` rewrites those goldens. Fixture ids live in
`demo/chartVisual/fixtureCatalog.ts`. Operator steps:
[Compare rendered chart snapshots](../how-to/compare-chart-rendered-snapshots.md).

## Notification components

Presentational only — no syncdb import. Wire data from your app's sync layer.
These components are not in the isolated UI component demo; see `example-frontend`.

### `NotificationBell`

| Prop | Type | Description |
|---|---|---|
| `unreadCount` | `number` | Badge hidden when `0` |
| `onPress` | `() => void` | Opens the inbox (host owns visibility) |
| `renderBadge` | `({unreadCount, testID}) => ReactNode` | Replaces the default unread-count badge |
| `renderIcon` | `({testID}) => ReactNode` | Replaces the default bell icon |
| `testID` | `string` | Default `notification-bell` |

Custom renderers keep the built-in 40×40 tap target, positioning, toggle callback, and
accessible unread-count label. `renderBadge` runs only when `unreadCount > 0`.

### `NotificationInbox`

List-only; wrap in `SideDrawer`, `Modal`, or a sheet in the host screen.

| Prop | Type | Description |
|---|---|---|
| `items` | `NotificationInboxItem[]` | Rows to render |
| `isLoading` | `boolean` | Shows spinner |
| `onMarkRead` / `onMarkUnread` | `(item) => void` | Toggle `readAt` via syncdb |
| `onDismiss` | `(item) => void` | Archive the row (`archivedAt` via syncdb) |
| `onOpen` | `(item) => void` | Tap handler (e.g. Expo Router for `href`) |

`NotificationInboxItem.archived` is optional. Archived rows receive an `Archived` label
and do not expose dismiss or read-state actions.

### `NotificationPreferences`

| Prop | Type | Description |
|---|---|---|
| `preferences` | `{inapp, mail, push, sms}` | Current toggles |
| `onChange` | `(channel, value) => void` | Per-channel updates |

## Component Behaviors

### Button Layout Behavior

Buttons automatically size to their content unless `fullWidth` is specified:

``````typescript
// Button takes only the space it needs
<Box direction="column">
  <Button text="Save" onClick={handleSave} />  {/* Auto-sized */}
</Box>

// Button stretches to full width
<Box direction="column">
  <Button text="Save" onClick={handleSave} fullWidth />  {/* Full width */}
</Box>
``````

Internally, Button sets `alignSelf: 'flex-start'` when `fullWidth={false}` to prevent stretching in column layouts.

A label stays on one line by default, so a long label can make the button wider than its container.
Set `wrapText` to keep the button inside its container instead: the label wraps onto centered lines
and the button grows taller. A `size="sm"` button grows from its 28px height instead of clipping the
second line. `SimpleAskCard` and `AskCard` set `wrapText` on their answer buttons, because their
labels come from the agent.

```tsx
<Box direction="row" width={160}>
  <Button onClick={handleSave} text="Save all changes now" wrapText />
</Box>
```

### TextField password visibility

`type="password"` masks the value and renders a show/hide eye control at the end of the field.
The control is uncontrolled — the field tracks whether the value is revealed and starts hidden.
A disabled field cannot be revealed.

``````typescript
<TextField
  title="Password"
  type="password"
  value={password}
  onChange={setPassword}
  autoComplete="current-password"
/>
``````

Pass `showVisibilityToggle={false}` where revealing the value is unacceptable, such as a shared or
on-camera screen:

``````typescript
<TextField showVisibilityToggle={false} title="Password" type="password" value={password} onChange={setPassword} />
``````

`Field` with `type="password"` renders the same control, and so do `LoginScreen` and `SignUpScreen`
password fields.

The toggle's test id defaults to `{testID}.visibility-toggle`, and `testIDs.visibilityToggle`
overrides it:

| Element | test id |
| --- | --- |
| Input | `{testID}` |
| Label | `{testID}.label` |
| Error | `{testID}.error` |
| Helper | `{testID}.helper` |
| Show/hide toggle | `{testID}.visibility-toggle` |

### DropdownPanel

`DropdownPanel` is the compositional dropdown behind the DataTable filter popovers. A
trigger opens an anchored panel of arbitrary composed content with an optional
Apply / Clear / Cancel footer, so it also fits non-filter panels (bulk actions, column
pickers, sort menus).

``````typescript
<DropdownPanel
  label="Filters"
  onApply={applyDraft}
  onCancel={resetDraft}
  onClear={clearDraft}
  onOpenChange={(isOpen) => isOpen && seedDraft()}
  width={340}
>
  <FilterSelectMenu title="Due date" options={DUE_DATE_OPTIONS} value={dueDate} onChange={setDueDate} />
  <FilterBoolean title="Urgent tasks only" value={urgentOnly} onChange={setUrgentOnly} />
</DropdownPanel>
``````

> `Filter` is the former name and stays exported as a deprecated alias (with `FilterProps`)
> until Terreno 58. The `FilterSelectMenu` / `FilterBoolean` / `FilterAccordion` /
> `FilterChangesBadge` controls keep their names.

#### Positioning

The panel never renders inside its parent's clipping or stacking context: on web it is
portaled to `document.body` with fixed positioning, and on native it is teleported to the
`TerrenoProvider` portal host (falling back to an inline absolute overlay when no host is
mounted). `computeDropdownPanelLayout` then anchors it to the measured trigger:

| Situation | Behavior |
| --- | --- |
| Panel fits beside the trigger | Left edges line up (`align="start"`) |
| Left-aligned panel would cross the right viewport edge | Right edges line up instead (`align="auto"`, the default) |
| Panel is wider than the viewport | Narrowed to the viewport minus the 8px screen margins |
| Less than 160px below the trigger, and more above | Flipped above the trigger |
| Content taller than the space on screen | Panel body scrolls; the footer stays pinned |

Pass `align="start"` or `align="end"` to pin the side explicitly, and `maxPanelHeight` to
cap the height below what the viewport allows.

#### Trigger

The default trigger is a `Button` (or a compact icon trigger with `iconOnly`). Style it
with `triggerVariant` (any `Button` variant), `triggerSize`, and `fullWidth`, or replace
it entirely with `renderTrigger` when the design needs chrome the button variants do not
cover:

``````typescript
<DropdownPanel
  fullWidth
  renderTrigger={({isOpen, toggle}) => <MyPill active={isOpen} onPress={toggle} />}
  width={300}
>
  {fields}
</DropdownPanel>
``````

`variant` still sets both the trigger and the Apply button; `triggerVariant` and
`applyButtonVariant` override each independently.

### GPTChat

Streaming chat surface for `@terreno/ai`. Histories, messages, submit, and optional MCP/tools stay under consumer control.

Pass `mascot` when the app owns a character. Terreno ships none. The node renders only while `currentMessages` is empty, centered in the chat panel above the suggested prompts. The empty hero uses the message viewport height as a minimum so short content stays centered, while taller mascots still scroll. Streaming feedback shares that centered hero instead of creating a second pane. Omit the prop for the default empty chat.

The composer row (attachment picker, tools, input, Send) is vertically centered, so controls stay aligned with the input as it grows. The attachment cell is omitted when `onAttachFiles` is not provided.

```tsx
<GPTChat
  currentMessages={[]}
  histories={histories}
  mascot={
    <Box alignItems="center">
      <Heading size="lg">🦊</Heading>
    </Box>
  }
  onCreateHistory={onCreateHistory}
  onDeleteHistory={onDeleteHistory}
  onSelectHistory={onSelectHistory}
  onSubmit={onSubmit}
/>
```

Operator steps: [Add a GPT chat mascot](../how-to/add-gpt-chat-mascot.md). Demo story: `GPTChat` → `Mascot`.
The example AI screen demonstrates a consumer selecting one of four bundled mascot
images once per mount.

#### Asks

`GPTChat` shows an [agent ask](agent-ui-asks.md) as an `AskCard` in the transcript. Set `ask` on
the ask's `tool-call` message and pass `onAskSubmit`:

```tsx
<GPTChat
  askErrors={askErrors}
  currentMessages={currentMessages}
  histories={histories}
  onAskSubmit={handleAskSubmit}
  onCreateHistory={onCreateHistory}
  onDeleteHistory={onDeleteHistory}
  onSelectHistory={onSelectHistory}
  onSubmit={onSubmit}
/>
```

| Prop or field | Type | Description |
| --- | --- | --- |
| `GPTChatMessage.ask` | `ChatAsk` | On a `tool-call` message: the ask (`kind`, `input`), its `toolCallId`, `status` (`pending`, `answered`, or `cancelled`), and optional `response` and `simple` card. The chat shows an `AskCard` instead of the tool call. |
| `onAskSubmit` | `(submission: {toolCallId, response}) => void \| Promise<void>` | Called when the user answers a pending ask. `response` is the answer envelope. The pressed control shows a loading state until the promise settles. Without it, asks show but cannot be answered. |
| `askErrors` | `Record<string, AskValidationError[]>` | Errors for the last answer to each ask, keyed by tool call id, such as the `fields` of a 400 `Invalid askResponse`. Shown inside the card. |
| `resolveAskFiles` | `AskFilesResolver` | Turns the files picked for a `files` ask into the refs its answer sends. Defaults to `resolveAskFilesAsDataUrls`. Pass an uploader to send `{fileId}` refs; see [Accept uploads with or without GCS](../how-to/agent-ui-asks.md#accept-uploads-with-or-without-gcs). |

- The ask's `tool-result` message stays in `currentMessages` but is not shown. Keep it: message
  indexes must match the stored `prompts` rows that ratings use. When `ask.response` is unset, the
  card reads the answer from that message.
- A pending ask takes focus when it appears: DOM focus on the card, labelled with the ask's
  `title`, on web; accessibility focus on the question, an accessibility header, on native.
- Answered and cancelled asks collapse to a one-line summary.

The example AI screen, `example-frontend/app/(tabs)/ai.tsx`, handles the stream events, saved
rows, answers, and errors. Steps: [Add agent asks to a chat](../how-to/agent-ui-asks.md).

### AskCard

One agent ask in a chat transcript: controls while it is pending, a summary line after. `GPTChat`
renders it for messages with `ask`. Render it directly in a custom transcript. A saved ask whose
input no longer validates, or whose `accept` answer has no `content` object, shows the generic
line ("You answered this question.") and no sent values.

```tsx
<AskCard ask={ask} errors={errors} onSubmit={handleAskSubmit} testID="plan-ask" />
```

| Prop | Type | Description |
| --- | --- | --- |
| `ask` | `ChatAsk` | The ask. Pending asks are interactive. Answered and cancelled asks show a summary. |
| `errors` | `AskValidationError[]` | Errors for the last answer, shown under the controls |
| `onSubmit` | `AskSubmitHandler` | Called with `{toolCallId, response}`. Without it, the card cannot be answered: buttons and the select are disabled, and radio and checkbox options show as plain text. When the promise it returns rejects, the ask stays open and the card shows "Your answer could not be sent. Try again." until the next answer. |
| `promptRef` | `React.Ref<Text>` (React Native) | Receives the question's native text, which is an accessibility header. `GPTChat` uses it to move screen reader focus to a pending ask on native. |
| `resolveAskFiles` | `AskFilesResolver` | For a `files` ask: turns the picked files into refs on Submit. Defaults to data URLs. `GPTChat` passes its own `resolveAskFiles`. |
| `testID` | string | Defaults to `ask-card`. `GPTChat` passes `gpt-ask-<toolCallId>`. |

A saved ask whose input no longer passes `validateAskInput` shows "This question cannot be shown.
Send a message to continue." while pending, and "You answered this question." once answered.

`choice` controls:

| Ask | Controls |
| --- | --- |
| The simple card has a button for every option (`handoff: false`), and every option label is at most 20 characters | The card's buttons as quick replies, then Skip unless `allowDecline` is `false`. A tap answers. |
| Up to 8 options | `RadioField`, then Submit (`submitLabel`) and Skip |
| More than 8 options | Searchable `SelectField`, then Submit and Skip |
| `select: "many"` | `MultiselectField` with a hint such as "Choose 1 to 3.", then a `TextField` titled `otherLabel` (default "Other") when `allowOther` is `true`, then Submit and Skip |

The selection starts on the ask's `default`. Submit is enabled only when `validateAskResponse`
accepts the selection. For `select: "many"`, the answer lists the checked ids in option order and
sends the Other text trimmed, leaving `other` out when the field is blank. When the checked
options and the Other text add up to more than `maxSelected`, the checkboxes say so ("You chose
4. Choose at most 3."). An Other text over 500 characters, or a server error at `content.other`,
shows on the Other field. When `ask.simple` is absent, the card derives it with `toSimpleCard`. An
ask whose input fails `validateAskInput` shows "This question cannot be shown. Send a message to
continue." instead of controls.

`confirm` controls: the simple card's two buttons in its order, the approve button (`confirmLabel`,
default "Confirm") first and the deny button (`denyLabel`, default "Cancel") last. The approve
button uses the `destructive` variant when the ask sets `destructive: true`, else `primary`; the
deny button uses `ghost`. Skip follows only when `allowDecline` is `true`. A tap answers
`{"confirmed": true}` or `{"confirmed": false}`. Without `onSubmit`, both buttons are disabled.

`markdown` controls: a `MarkdownEditorField` (edit and preview, at most 320 pt tall) that starts
on the ask's `initial` draft and shows `placeholder` while empty, then Submit (`submitLabel`) and
Skip unless `allowDecline` is `false`. Under the editor a hint gives the length and the bounds,
such as "1,240 / 2,000 characters. At least 20." Submit is enabled only when
`validateAskResponse` accepts the text, and it sends `{markdown, changed}` with `changed` true
when the text differs from `initial`. Text over `maxLength`, or a server error at
`content.markdown`, shows on the editor. Without `onSubmit`, the editor and both buttons are
disabled. An answered markdown ask shows the sent text under its summary; text over 280
characters shows a preview cut at a word, with Show all and Show less.

`form` controls: one field per entry in `fields`, in order, titled with the field's `label`
("(required)" appended for required fields) and its `helperText`, then Submit (`submitLabel`) and
Skip unless `allowDecline` is `false`. Each field uses the `@terreno/ui` control for its type:

| Field `type` | Control | Sends |
| --- | --- | --- |
| `text`, `email`, `url` | `TextField` (`text`, `email`, `url`) | The trimmed text |
| `phone` | `TextField` (`phoneNumber`) | E.164, such as `+14155552671`, when the number parses (as a US number without a country code); else the trimmed text |
| `number` | `TextField` | A number when the text is plain decimal notation; else the text, so validation says why |
| `textarea` | `TextArea` | The trimmed text |
| `date` | `DateTimeField` (`date`) | `YYYY-MM-DD` |
| `time` | `DateTimeField` (`time`) with its time zone picker (the device's zone to start) | 24-hour `HH:mm` as shown; the zone is not sent |
| `datetime` | `DateTimeField` (`datetime`) with a time zone picker | An ISO datetime with the chosen zone's offset, such as `2026-10-01T09:30:00-07:00` |
| `boolean` | `BooleanField` | `true` or `false`, always |
| `select` | `SelectField` | The option id |
| `multiselect` | `MultiselectField` | The checked option ids |

Fields start on their `default`. Blank fields are left out of `values`. Submit is enabled only
when `validateAskResponse` accepts the values and no date, time, or datetime field holds an
unfinished entry. `DateTimeField` reports that through `onEntryStatusChange`, such as
"0 / 5 / 026": the field says "Enter a complete date, or clear it." until the user finishes it,
and clearing every part leaves the field out. After the user edits a field, it says what is
wrong in plain words, such as "Enter a number from 1 to 500." or "This field is required." A
server error whose path is `content.values.<id>` (or an item under it) shows on that field until
the user edits it; other errors show under the form. Without `onSubmit`, every field and both
buttons are disabled. An answered form lists each sent field as its label and a readable value
(Yes or No, option labels, "Oct 1, 2026", "9:30 AM", text shortened to one line of 80
characters) under its summary.

`files` controls: a hint built from the counts and types, such as "Up to 3 files: images, PDFs or
text files.", then a "Choose files" `FilePickerButton` ("Add files" once some are picked), the
picked files as an `AttachmentPreview` with a remove control on each, then Submit (`submitLabel`,
default "Submit") and Skip unless `allowDecline` is `false`. The picker offers Photo Library only
when `accept` has `image`, and its document picker offers only the accepted MIME types. It allows
several files when `maxFiles` is more than 1 and is disabled once `maxFiles` files are picked.
Submit is enabled only when `validateAskResponse` accepts the picked names, types, and sizes. On
Submit, the card calls `resolveAskFiles` with the picked files and sends `{files: refs}`; Submit
shows a spinner and Skip is disabled until the answer is sent. When the ask ends another way while
the resolver runs, such as an answer from another tab, its refs are not sent. If the resolver throws, the ask
stays open and the card shows "The files could not be sent. Try again, or pick them again." Server
errors, such as `MIME_MISMATCH`, show under the picked files. Each file's type is
`selectedFileMimeType(file)`, so a CSV a picker reports as `application/vnd.ms-excel` is sent as
`text/csv`.

| How the ask ended | Summary |
| --- | --- |
| `files` `accept` | You sent `<n>` files: `<filenames>`, or You sent 1 file: `<filename>` |
| `form` `accept` | You sent the form (`<n>` fields) |
| `markdown` `accept` | You approved the draft as is (`changed: false`), or You edited the draft (`<n>` characters) |
| `confirm` `accept` | You confirmed: `<confirmLabel>`, or You declined: `<denyLabel>`, with the default labels when the ask sets none |
| `choice` `accept` | You chose: `<option labels>`. With Other text, it adds "`<otherLabel>`: `<text>`" (the label defaults to "Other"), or shows only that when no option was checked. An empty `select: "many"` answer shows "You chose none of the options." |
| `decline` | You skipped this question. |
| `cancel` with `user_sent_message` | Not answered: you sent a message instead. |
| `cancel` with `one_ask_at_a_time` | Not asked: the assistant asked another question first. |
| Any other `cancel`, or status `cancelled` without a response | This question was cancelled. |
| Status `answered` without a response | You answered this question. |

| Element | testID |
| --- | --- |
| Card | `{testID}` |
| Quick reply row | `{testID}-quick-replies` |
| Quick reply or Skip button | `{testID}-button-<button id>`, such as `{testID}-button-option:team` or `{testID}-button-skip` |
| Confirm button row | `{testID}-confirm-buttons` |
| Confirm approve or deny button | `{testID}-button-approve`, `{testID}-button-deny` |
| Radio options (up to 8) | `{testID}-radio` |
| Select | `{testID}-select` |
| Checkboxes (`select: "many"`) | `{testID}-multiselect` |
| Other text field | `{testID}-other` |
| Markdown editor, and its text input | `{testID}-editor`, `{testID}-editor-input` |
| Sent markdown under an answered ask, and its Show all toggle | `{testID}-answer`, `{testID}-answer-toggle` |
| Form field, and its wrapper | `{testID}-field-<field id>` (a `BooleanField` switch is `{testID}-field-<field id>.switch`), `{testID}-form-field-<field id>` |
| Sent form values under an answered ask | `{testID}-answer` |
| Files hint, picker, and picked files | `{testID}-hint`, `{testID}-picker`, `{testID}-selected` |
| Files that could not be sent | `{testID}-resolve-error` |
| Radio or checkbox options as plain text, without `onSubmit` | `{testID}-options` |
| Submit | `{testID}-submit` |
| Answer errors | `{testID}-errors` |
| Summary | `{testID}-summary` |
| Ask that cannot be shown | `{testID}-invalid` |
| Answer that could not be sent | `{testID}-submit-error` |

Types: `AskCardProps`, `ChatAsk`, `ChatAskState`, `ChatAskStatus`, `AskSubmission`,
`AskSubmitHandler`, `AskFilesResolver`. Demo story: `AskCard`.

File ref helpers:

| Export | Description |
| --- | --- |
| `AskFilesResolver` | `(files: SelectedFile[]) => Promise<AskFileRef[]>`. Throw to keep the ask open. |
| `resolveAskFilesAsDataUrls` | The default resolver: every file as a `{url}` data URL |
| `selectedFileToDataUrlRef(file)` | One picked file as `{filename, mimeType, size, url}`. The data URL's media type is `selectedFileMimeType(file)`, and `size` is the decoded byte count. |
| `selectedFileMimeType(file)` | The picked file's normalized type. When the picker reports none, `application/octet-stream`, or `application/vnd.ms-excel` (Windows reports CSV files so), the type comes from the extension: `.csv`, `.gif`, `.jpeg`, `.jpg`, `.json`, `.pdf`, `.png`, `.txt`, `.webp`. Otherwise the reported type is kept. |
| `normalizeMimeType(mimeType)` | Drops parameters and lowercases: `Text/CSV; charset=utf-8` becomes `text/csv` |

`FilePickerButton` props used by the files card, also available to any caller:

| Prop | Type | Description |
| --- | --- | --- |
| `documentTypes` | `string[]` | MIME types the document picker offers. Defaults to PDF, text, CSV, and JSON. An empty list hides Document. |
| `includeImages` | boolean | Offer Photo Library. Defaults to `true`. When `false`, the button opens the document picker directly. |
| `text` | string | Shows an outline button with this label instead of the paperclip icon |

`SelectedFile.size` is the file's size in bytes when the picker reports it.

### SimpleAskCard

Any agent ask as its [simple card](agent-ui-asks.md#simple-cards): the title, the question, and up
to three full-width buttons that each send an exact answer. Use it in narrow layouts, such as a
watch-sized preview. It reads the card's `kind` only to word the handoff line.

```tsx
const [runTurn] = useGpthistoriesTurnMutation();

<SimpleAskCard
  card={pendingAsk.simple}
  onPress={(button) =>
    runTurn({
      body: {buttonId: button.id, surface: "compact", toolCallId: pendingAsk.toolCallId},
      id: historyId,
    })
  }
  pendingButtonId={sendingButtonId}
/>
```

| Prop | Type | Description |
| --- | --- | --- |
| `card` | `SimpleCard` | `pendingAsk.simple` from the server, or `simple` on an `{ask}` event |
| `onPress` | `(button: SimpleCardButton) => void \| Promise<void>` | Called with the pressed button. Send `{toolCallId: card.toolCallId, buttonId: button.id}` to the history's [`turn` action](agent-ui-asks.md#headless-endpoints), or send `button.response` as the answer. |
| `pendingButtonId` | string? | The button whose answer is still sending. It shows a spinner, the other buttons are disabled, and presses are ignored. |
| `testID` | string? | Defaults to `simple-ask-card` |

- A card with `handoff: true` shows "Continue on your phone" under the question, because its
  buttons cannot give every answer. A `markdown` card shows "Edit on your phone" instead, a
  `form` card "Fill it in on your phone", and a `files` card "Upload on your phone".
- Button styles map to `Button` variants the same way as `AskCard` quick replies: `primary` to
  `primary`, `default` to `outline`, `destructive` to `destructive`, and `cancel` to `ghost`.

| Element | testID |
| --- | --- |
| Card | `{testID}` |
| Continue on your phone, or Edit on your phone | `{testID}-handoff` |
| Button | `{testID}-button-<button id>`, such as `{testID}-button-option:team` |

Types: `SimpleAskCardProps`, and `SimpleCard` and `SimpleCardButton` from `@terreno/blocks`. Demo
story: `SimpleAskCard`. Its demo answers a plan card on a watch-sized 198×242 pt screen, and its
"Every fixture" story draws every valid fixture's card at that size.

### SplitPage

Master-detail layout. Pass `listViewData` plus `renderListViewItem` for the list, and
`renderContent` for the detail pane. On large screens both panes stay visible. On small
screens the detail replaces the list until the user goes back.

```typescript
import {SplitPage, Text} from "@terreno/ui";

<SplitPage
  listViewData={[{id: "1", name: "Inbox"}]}
  renderListViewItem={({item}) => <Text>{item.name}</Text>}
  renderContent={(index) => <Text>{index === undefined ? "Select an item" : "Detail"}</Text>}
/>
```

### Page Back Navigation

Set `backButton` to render the standard header back arrow. By default it calls `router.back()`; provide `onBack` when the screen needs a deterministic destination instead of browser history.

```typescript
<Page backButton onBack={() => router.push("/admin")} title="Operations">
  <OperationsDashboard />
</Page>
```

### Button Press Animation

Buttons use a scale animation by default. Set `pressAnimation="opacity"` for an opacity response or
`pressAnimation="none"` when surrounding motion already provides feedback:

``````typescript
<Button text="Save" onClick={handleSave} pressAnimation="opacity" />
``````

Disabled and loading buttons use a non-interactive pressable regardless of the selected animation.

## Authentication Components

### SocialLoginButton

Branded social login buttons for OAuth authentication with Google, GitHub, and Apple.

``````typescript
import {SocialLoginButton} from "@terreno/ui";
import {authClient} from "@/store/authClient";

<SocialLoginButton
  provider="google"  // "google" | "github" | "apple"
  variant="primary"  // "primary" | "outline"
  onPress={async () => {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "yourapp://auth/callback",
    });
  }}
  loading={isLoading}
  fullWidth
/>
``````

**Features:**
- Proper brand colors for each provider (follows brand guidelines)
- Built-in icons (FontAwesome 6)
- Primary and outline variants
- Loading states with spinner
- Automatic text: "Continue with {Provider}"

### LoginScreen

Complete login screen with email/password and optional social providers.

``````typescript
import {LoginScreen} from "@terreno/ui";
import {authClient} from "@/store/authClient";

<LoginScreen
  onEmailLogin={async ({email, password}) => {
    await authClient.signIn.email({email, password});
  }}
  onSocialLogin={async (provider) => {
    await authClient.signIn.social({provider, callbackURL: "yourapp://auth"});
  }}
  socialProviders={["google", "github", "apple"]}
  onForgotPassword={() => navigation.navigate("ForgotPassword")}
  onSignUp={() => navigation.navigate("SignUp")}
/>
``````

### SignUpScreen

Complete signup screen with email/password and optional social providers.

``````typescript
import {SignUpScreen} from "@terreno/ui";
import {authClient} from "@/store/authClient";

<SignUpScreen
  onEmailSignUp={async ({email, password, name}) => {
    await authClient.signUp.email({email, password, name});
  }}
  onSocialLogin={async (provider) => {
    await authClient.signIn.social({provider, callbackURL: "yourapp://auth"});
  }}
  socialProviders={["google", "github"]}
  onSignIn={() => navigation.navigate("Login")}
  requireName
  requireTermsAcceptance
/>
``````

**Learn more:** [Configure Better Auth](../how-to/configure-better-auth.md)

## Testing Utilities

@terreno/ui provides test helpers for writing component tests with @testing-library/react-native.

### renderWithTheme

Wraps components in ThemeProvider for testing.

``````typescript
import {renderWithTheme} from "@terreno/ui";
import {describe, it, expect} from "bun:test";

describe("MyComponent", () => {
  it("renders correctly", () => {
    const {getByTestId} = renderWithTheme(<MyComponent testID="my-comp" />);
    expect(getByTestID("my-comp")).toBeTruthy();
  });
});
``````

**Why:** Most @terreno/ui components require ThemeProvider context to access theme values.

### TapToEdit testIDs

Pass `testID` on `TapToEdit`. The Field input uses that id. Action controls suffix it:

| Control | test id |
| --- | --- |
| Edit (pencil) | `{testID}.edit-clickable` |
| Cancel | `{testID}.cancel` |
| Clear | `{testID}.clear` |
| Save | `{testID}.save` |

```typescript
<TapToEdit
  testID="profile.name"
  setValue={setName}
  onSave={saveName}
  title="Name"
  value={name}
/>
// Edit:  profile.name.edit-clickable
// Cancel / Clear / Save: profile.name.cancel, .clear, .save
```

### createCommonMocks

Creates mock functions for common component callbacks.

``````typescript
import {createCommonMocks} from "@terreno/ui";

const mocks = createCommonMocks();
// Returns: {onBlur, onChange, onEnter, onFocus, onIconClick, onSubmitEditing}

<TextField
  value="test"
  onChange={mocks.onChange}
  onBlur={mocks.onBlur}
  onFocus={mocks.onFocus}
/>

// Assert mock was called
expect(mocks.onChange).toHaveBeenCalledWith("new value");
``````

### setupComponentTest / teardownComponentTest

Lifecycle helpers for test setup and cleanup.

``````typescript
import {setupComponentTest, teardownComponentTest} from "@terreno/ui";

describe("MyForm", () => {
  let mocks;

  beforeEach(() => {
    mocks = setupComponentTest(); // Returns createCommonMocks()
  });

  afterEach(() => {
    teardownComponentTest(); // No-op in Bun (auto-cleanup)
  });

  it("submits form", () => {
    // Test with mocks
  });
});
``````

## Date Utilities

Luxon-based helpers for date comparison and formatting.

``````typescript
import {
  isToday,
  isTomorrow,
  isYesterday,
  isThisYear,
  isWithinWeek,
  getIsoDate,
} from "@terreno/ui";

const date = DateTime.now();

if (isToday(date)) console.log("Today!");
if (isTomorrow(date)) console.log("Tomorrow!");
if (isYesterday(date)) console.log("Yesterday!");
if (isThisYear(date)) console.log("This year!");
if (isWithinWeek(date)) console.log("Within 7 days!");

// Convert to ISO date string
const isoString = getIsoDate(date); // "2026-02-15"
``````

### Timezone Utilities

``````typescript
import {getTimezoneOptions} from "@terreno/ui";

// Get USA timezones only
const usaTimezones = getTimezoneOptions("usa");
// Returns: [{label: "Pacific Time", value: "America/Los_Angeles"}, ...]

// Get worldwide timezones
const allTimezones = getTimezoneOptions("worldwide");
// Returns: [{label: "UTC", value: "UTC"}, {label: "New York", value: "America/New_York"}, ...]
``````

**Use case:** Populate SelectField with timezone choices.

## Address Utilities

Google Places API integration helpers for address handling.

### formatAddress

``````typescript
import {formatAddress} from "@terreno/ui";

const address = {
  street: "123 Main St",
  city: "San Francisco",
  state: "CA",
  zipCode: "94102",
};

const formatted = formatAddress(address);
// "123 Main St, San Francisco, CA 94102"
``````

### processAddressComponents

Parses Google Places API address_components into structured data.

``````typescript
import {processAddressComponents} from "@terreno/ui";

// From Google Places API response
const components = place.address_components;

const parsed = processAddressComponents(components);
// Returns: {street, city, state, zipCode, country, county}
``````

### findAddressComponent

``````typescript
import {findAddressComponent} from "@terreno/ui";

const city = findAddressComponent(components, "locality");
const state = findAddressComponent(components, "administrative_area_level_1", "short_name");
``````

### Validation

``````typescript
import {isValidGoogleApiKey, formattedCountyCode} from "@terreno/ui";

if (!isValidGoogleApiKey(apiKey)) {
  console.error("Invalid Google API key");
}

// Format US county codes
const county = formattedCountyCode("6075"); // "6075" (Santa Cruz County, CA)
``````

## Media Query Helpers

Responsive design utilities for breakpoints and device detection.

``````typescript
import {
  mediaQuery,
  mediaQueryLargerThan,
  mediaQuerySmallerThan,
  isMobileDevice,
} from "@terreno/ui";

// Read the current breakpoint
if (mediaQuery() === "md") {
  console.info("Medium viewport");
}

// Greater than breakpoint
if (mediaQueryLargerThan("sm")) {
  console.log("Larger than small");
}

// Smaller than breakpoint
if (mediaQuerySmallerThan("lg")) {
  console.log("Smaller than large");
}

// Detect mobile
if (isMobileDevice()) {
  console.info("Running on mobile device");
}
``````

**Breakpoints are platform-specific.** `lg` and `xl` do not mean the same width on native and web.

Native (iOS/Android):

| Token | Width (pt) | Use |
| --- | --- | --- |
| Below `sm` | < 320 | Not supported. Accessible, not optimized. |
| `sm` | 320–374 | Small phone. Critical workflows stay usable. |
| `md` | 375–599 | Standard phone. |
| `lg` | 600–1023 | Large mobile / tablet, including Samsung A11. |
| `xl` | ≥ 1024 | Not a supported mobile layout. Use the desktop web experience where available. |

Web (desktop staff):

| Token | Width (pt) | Use |
| --- | --- | --- |
| Below `lg` | < 1024 | Not a supported desktop experience. Accessible, not optimized. |
| `lg` | 1024–1279 | Smaller desktop. Collapse secondary content; keep core workflows. |
| `xl` | ≥ 1280 | Primary desktop (M1/M4 MacBook Air 13"). Full multi-panel layouts. |

On web, `sm` (320) and `md` (375) still classify widths below 1024 so layouts can remain accessible.

`isMobileDevice()` is true below the supported desktop floor: native width < 1024 (`xl`), web width < 1024 (`lg`).

Responsive `Box` direction props update automatically when the window resizes or a device rotates:

``````typescript
<Box
  direction="column"
  smDirection="row"
  mdDirection="column"
  lgDirection="row"
  xlDirection="column"
/>
``````

All responsive Boxes share one dimension listener; non-responsive Boxes do not subscribe.
When multiple direction props match, the largest active breakpoint wins (`xl` over `lg` over `md` over `sm`).

## Icons

Terreno uses **FontAwesome 6** by default. Pass icon names via `iconName` on `Icon`, `Button`, `IconButton`, form fields, `Badge`, and other icon-aware components.

### FontAwesome Icons

All 2000+ FontAwesome 6 icons are available:

``````typescript
import {Icon, Button} from "@terreno/ui";

<Icon iconName="check" size="md" color="primary" />
<Icon iconName="user" size="lg" color="secondaryDark" />
<Icon iconName="chevron-right" size="sm" color="primary" />

<Button text="Save" iconName="check" onClick={handleSave} />
``````

**Sizes:** `xs`, `sm`, `md`, `lg`, `xl`, `2xl`

**Types:** `solid` (default), `regular`, `brand`, `light`, `thin`, `duotone`, `sharp`, and related variants.

### Custom Icons

Register your own icons (SVGs, etc.) on `TerrenoProvider` and use them by name anywhere `iconName` is accepted. Registered names take precedence over FontAwesome.

**1. Create a custom icon component** that accepts `color`, `size` (pixels), and optional `testID`:

``````typescript
import type {CustomIconProps} from "@terreno/ui";
import Svg, {Path} from "react-native-svg";

export const SparkleIcon = ({color, size, testID}: CustomIconProps): React.ReactElement => (
  <Svg fill="none" height={size} testID={testID} viewBox="0 0 24 24" width={size}>
    <Path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill={color} />
  </Svg>
);
``````

Terreno resolves theme colors and size tokens before passing them to your component.

**2. Register icons** via the `icons` prop on `TerrenoProvider`:

``````typescript
import {TerrenoProvider} from "@terreno/ui";
import {SparkleIcon} from "./components/SparkleIcon";

<TerrenoProvider icons={{sparkle: SparkleIcon}}>
  {children}
</TerrenoProvider>
``````

**3. Use by name** like any built-in icon:

``````typescript
<Icon iconName="sparkle" color="accent" size="lg" />
<Button text="Sparkle" iconName="sparkle" onClick={handleClick} />
<IconButton accessibilityLabel="Sparkle" iconName="sparkle" onClick={handleClick} />
``````

**TypeScript:** extend `CustomIconRegistry` via declaration merging for autocomplete and type-safe `iconName` values:

``````typescript
declare module "@terreno/ui" {
  interface CustomIconRegistry {
    sparkle: true;
  }
}
``````

See [`demo/components/customIcons.tsx`](https://github.com/TerrenoLabs/terreno/blob/master/demo/components/customIcons.tsx) for a full working example.

### Built-in Status Icons

@terreno/ui also ships status indicator SVGs as standalone components (not registered via `TerrenoProvider`):

``````typescript
import {MobileIcon, OnlineIcon, OfflineIcon, OutOfOfficeIcon} from "@terreno/ui";

<MobileIcon width={20} height={20} fill="#007AFF" />
<OnlineIcon width={16} height={16} />
<OfflineIcon width={16} height={16} />
<OutOfOfficeIcon width={16} height={16} />
``````

**Use case:** User status indicators, device type badges.

## Style Utilities

### Unifier Class

Color manipulation helper:

``````typescript
import {Unifier} from "@terreno/ui";

// Darken/lighten colors
const darkColor = Unifier.changeColorLuminance("#007AFF", -0.2); // Darker
const lightColor = Unifier.changeColorLuminance("#007AFF", 0.2); // Lighter
``````

### Style Helpers

``````typescript
import {identity, concat, fromClassName, toggle, binding, union} from "@terreno/ui";

// Compose style objects
const styles = concat(baseStyles, conditionalStyles);

// Toggle styles
const buttonStyles = toggle(isPressed, pressedStyles, defaultStyles);
``````

**Note:** Most use cases are better served by Box props (`padding`, `color`, etc.).

## Environment Variables

@terreno/ui components do not require environment variables. All configuration is done at runtime via:

- **TerrenoProvider props** — Theme customization, custom icon registry (`icons`), OpenAPI spec URL
- **Theme hooks** — `useTheme()`, `setTheme()`, `setPrimitives()`
- **Component props** — Direct prop overrides for individual components

**Example configuration:**

``````typescript
import {TerrenoProvider} from "@terreno/ui";

<TerrenoProvider
  baseUrl="https://api.example.com"
  theme={{
    surface: {primary: "secondary500"},
  }}
  onError={(error) => console.error(error)}
>
  {children}
</TerrenoProvider>
``````

## DataTable server-side filtering

`DataTable` is data-layer agnostic. Optional filter and search props emit a
modelRouter-shaped JavaScript object through `onQueryChange`. The parent merges
that object with `page`, `limit`, and `sort` before calling a list endpoint.

Import the pure helper when building params outside the component:

```typescript
import {buildDataTableListQuery} from "@terreno/ui/dataTableListQuery";
```

### Query contract

| UI | Wire param |
| --- | --- |
| Toolbar search (`search` + `searchFields`) | `$or: [{field: {$regex, $options: "i"}}, ...]` (user text escaped) |
| Text column filter | `{field: {$regex, $options: "i"}}` |
| Boolean column filter | `{field: true \| false}`; unset omits the key |
| Date range | `field_gte` / `field_lte` ISO strings; either bound may be sent alone |
| Number range | `{field: {$gte?, $lte?}}` |
| Choice (one value) | `{field: string}` scalar equality |
| Choice (many values) | `{field: {$in: string[]}}` |
| Choice **Empty** (optional fields) | `{field: {$in: ["__empty__"]}}` on the wire; server maps to `null` (matches missing and null) |
| Choice **Empty** + concrete | `{field: {$in: [...values, "__empty__"]}}` |

`onQueryChange` never includes `page`, `limit`, or `sort`. Search is debounced
(250ms, same delay as admin list search).

The server accepts only the documented nested operator keys. Text `$regex` values
must be escaped literals; executable patterns and extra Mongo operators are rejected.

Date range filters collect calendar days, so a range covers whole UTC days: **from**
opens the chosen day (`00:00:00.000Z`) and **to** closes it (`23:59:59.999Z`), which
keeps rows recorded later on the end day inside the range.

Pass `emptyContent` to keep the table header, search, and filter controls mounted
while showing an application-specific empty state below the header.
Use `additionalFilters` for declared server filters whose fields are not visible
columns; web shows one **More filters** popover and native includes them in the same sheet.

### Platform chrome

| Platform | Chrome |
| --- | --- |
| Web | Toolbar search + per-column `DropdownPanel` popovers (`column.filter`) |
| Native | Toolbar search + one **Filters** sheet (`Modal`) with the same fields |

Column headers use `DropdownPanel` with `iconOnly`, which renders a compact icon trigger
(24px at the default `triggerSize="sm"`, 32px with `triggerSize="default"`) instead
of a labeled button. Give it an accessible name with `triggerAccessibilityLabel`.

A single-column popover offers only its own **Clear**, so it needs no per-field clear.
The surfaces that host several filters at once — the **More filters** popover and the
native **Filters** sheet — add a per-field **Clear filter** for booleans, whose toggle
cannot otherwise express "unset".

Omit `column.filter`, `searchFields`, and the related callbacks to keep today's
sort/page-only table.

Demo: `FilterableDataTable` story in the component demo (`demo:start`, port 8085).

## Related Documentation

- [UI performance benchmarks](ui-performance.md)
- [UI package source](https://github.com/TerrenoLabs/terreno/tree/master/ui/src)
