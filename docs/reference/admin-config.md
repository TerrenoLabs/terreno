# Admin configuration reference

`AdminConfig` is the `admin` object accepted by `modelRouter`.

| Field | Django admin analogue | Description |
| --- | --- | --- |
| `displayName` | `verbose_name_plural` | Required navigation and page label. |
| `listFields` | `list_display` | Required allowlist of list/form fields. |
| `listDisplay` | `list_display` | Optional visible list columns. |
| `listDisplayLinks` | `list_display_links` | Columns linking to the edit screen. |
| `searchFields` | `search_fields` | String fields matched by the list search box as a case-insensitive partial query. |
| `sortableFields` | `sortable_by` | Columns allowed to sort. |
| `defaultSort` | `ordering` | Initial sort field(s), using `-field` for descending. |
| `pageSize` | `list_per_page` | Rows per page. |
| `filters` | `list_filter` | Filter drawer definitions. |
| `fieldsets` | `fieldsets` | Ordered collapsible form groups. |
| `fieldOrder` | `fields` | Flat form order when fieldsets are absent. |
| `readonlyFields` | `readonly_fields` | Visible, non-editable fields. |
| `hiddenFields` | `exclude` | Fields omitted from admin forms and responses. |
| `excludeFields` | `exclude` | Additional response-scrubbing fields. |
| `autocompleteFields` | `autocomplete_fields` | Reference fields using async search. |
| `fieldOverrides` | `formfield_overrides` | Per-field label/help/widget metadata. |
| `adminPermissions` | `has_*_permission` | Admin-route permission method overrides. |
| `adminFilter` | `get_queryset` | Server-enforced query constraint. |
| `actions` | `actions` | Declarative bulk-patch/background actions. |
| `bulkPatchAllowlist` | — | Fields accepted by bulk patch. |
| `recordTitleField` | `__str__` | Field used for edit-page titles. |
| `group` | `app_label` | Navigation group. |
| `icon` | — | Navigation icon name. |
| `realtime` | — | Emit scrubbed admin change events. |
| `includeDeleted` | — | Reserved compatibility option. |

## Supporting types

`AdminFilter` has `field`, `kind`, and optional `label`. Kinds are `boolean`, `text`, `ref`,
`dateRange`, and `choice`; refs add `refModel`, choices add `{label,value}[]`.

`AdminFieldset` has `title`, `fields`, optional `description`, and optional `collapsed`.

`AdminAction` has `id`, `label`, optional `confirm`, `background`, and `patchKeys`.

`AdminContribution` may provide `models`, `customScreens`, `homeWidgets`, and `scripts`.
`customScreens[].group` becomes a named sidebar heading (`AI Observability`). Screens without
`group` stay under **Screens** — that is where **AI Requests** remains.
Model contributions contain `model`, `routePath`, and `admin`. Duplicate `routePath`s
throw for registered routers; the same Mongoose model at two paths gets unique config
`name`s so the admin UI can route to each.

`AdminApp({migrations: {dir}})` enables `GET /admin/migrations/status` (`admin:access`)
and `POST /admin/migrations/run?wetRun=` (`admin:runScripts`, same as Scripts) as
`modelRouter` collection actions, plus `migrations.enabled` on `GET /admin/config`.
Poll/cancel uses existing `/admin/scripts/tasks/:id`. Production wet apply requires
`ALLOW_MIGRATIONS=true`. Unconfigured apps return 404 for those action routes.


## Legacy migration

Move each object from `AdminApp.models` to the model's `modelRouter({admin: ...})`; remove
`model` and `routePath` from the nested config because those come from the router registration.
Plugin-owned models should come from `plugin.adminContribution()` instead of host duplication.
