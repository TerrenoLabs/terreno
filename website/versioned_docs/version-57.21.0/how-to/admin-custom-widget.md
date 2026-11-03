# Add a custom admin field widget

Field widgets are one of three admin widget buckets. Screen and nav rules:
[Build admin screens](build-admin-screens.md).

1. Name the widget in model admin metadata:

```ts
admin: {
  displayName: "Articles",
  listFields: ["title", "body"],
  fieldOverrides: {body: {widget: "rich-text"}},
}
```

2. Implement the field widget:

```tsx
const RichTextWidget: React.FC<AdminFieldWidgetProps> = ({
  value,
  onChange,
  readOnly,
}) => (
  <RichTextEditor
    disabled={Boolean(readOnly)}
    onChange={onChange}
    value={typeof value === "string" ? value : ""}
  />
);
```

3. Register it once around the admin routes:

```tsx
<AdminProvider
  api={api}
  apiBase="/admin"
  routeBase="/admin"
  widgets={{fields: {"rich-text": RichTextWidget}}}
>
  <AdminRoutes />
</AdminProvider>
```

Host registrations override built-ins with the same ID.
