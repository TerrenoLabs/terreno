# Layout — @terreno/ui

## Box

Core flex primitive. All layout should use Box.

```tsx
<Box
  direction="row"          // row | column
  justifyContent="between" // start | end | center | between | around
  alignItems="center"      // start | end | center | baseline | stretch
  flex="grow"              // grow | shrink | none
  gap={2}                  // 0-12 spacing scale
  padding={4}
  paddingX={2}
  marginBottom={2}
  width="100%"
  color="base"             // surface color token
  border="default"
  rounding="md"
  shadow
  onClick={handlePress}    // makes it pressable
  scroll                   // wraps in ScrollView
  testID="my-box"
/>
```

### Spacing scale

`0→0px, 1→4px, 2→8px, 3→12px, 4→16px, 5→24px, 6→32px, 7→40px, 8→48px, 9→56px, 10→64px, 11→72px, 12→80px`

Prefer `gap` over margin. Prefer `padding` over margin.

## Page

Full-screen layout with optional header, back button, scroll, and footer.

```tsx
<Page
  title="Settings"
  backButton
  scroll
  loading={isLoading}
  maxWidth={800}
  padding={2}
  footer={<Button text="Save" onClick={save} />}
>
  {children}
</Page>
```

Use `Page` instead of wrapping content in `ScrollView` manually.

## Card

Box wrapper with default rounding and shadow.

```tsx
<Card padding={4} color="base">
  <Text>Grouped content</Text>
</Card>
```

## SplitPage

Master-detail layout. On large screens the list and detail sit side by side. On small
screens, selecting a list item replaces the list with the detail pane.

```tsx
<SplitPage
  listViewData={items}
  renderListViewItem={({item}) => <Text>{item.name}</Text>}
  renderContent={(index) => <ItemDetail index={index} />}
/>
```

## Responsive breakpoints

Policy: `docs/explanation/responsive-design.md`. Width tables: `docs/reference/ui.md`.

Box supports `smDirection`, `mdDirection`, `lgDirection`, and `xlDirection`. Tokens are
platform-specific: native `sm` 320 / `md` 375 / `lg` 600 / `xl` 1024; web `lg` 1024 / `xl` 1280.
The desktop floor is `isSupportedDesktopWidth({width})`: web `lg` and native `xl`, both 1024pt.
Below that floor, keep the mobile layout. Native tablets (`lg`, 600–1023pt) do not get the desktop split.

```tsx
<Box direction="column" mdDirection="row" lgDirection="row" xlDirection="column">
```

## Do not

- Use raw `View` when Box props cover the need
- Use `Dimensions.get()` — prefer `useWindowDimensions` if sizing is needed
- Add a raw pixel cutoff such as 768. Use Box breakpoint props or `isSupportedDesktopWidth`
- Use `SafeAreaView` — Page handles safe areas
- Put hex colors in style when `color="primary"` works
