# @terreno/admin-frontend

React Native components for building admin panels that connect to `@terreno/admin-backend`.

**Build a screen or change nav:** [How admin interfaces are shaped](../explanation/admin-interface.md)
and [Build admin screens](../how-to/build-admin-screens.md).

## Quick Start

Home is `AdminHome` inside `AdminProvider` + `AdminShellLayout`. Generic models use
`AdminScreenRouter` on `[model]/index`. See the how-to for `apiBase` vs `routeBase`.

Pass fetch auth on `AdminProvider`:

| Host | Props |
| --- | --- |
| Standalone SPA | `credentials="same-origin"` and `getAuthHeaders` that return `{}` (cookie session). Omit `apiOrigin`. |
| Embedded app | `getAuthHeaders` that return `Authorization: Bearer …`, plus `apiOrigin` set to the API origin (`@terreno/rtk` `baseUrl`) |

RPC that has left RTK uses `bindAdminRequest({credentials, getAuthHeaders, origin})` then `adminRequest`. Relative URLs such as `/admin/config` are prefixed with `origin` when it is set. When `AdminProvider` has `credentials` or `getAuthHeaders`, RPC hooks (`useAdminConfig`, scripts, roles, configuration, documents, comms, consent, version-config, background-tasks, AI explorer, object picker) use that client. Successful comms, scripts, and configuration mutations invalidate mounted fetch queries through the same tag contracts as RTK; those background refetches keep cached data with `isLoading: false` and report `isFetching: true`. Passing only `api` keeps `injectEndpoints`. Do not add axios.

Optional `syncDb` on `AdminProvider` enables windowed changelists for models whose
config includes `adminBroadcast: true` and `syncCollection`. When product screens
also sync the same collection, inject a dedicated admin client/store configured
with `windowCollections`; one client cannot join owner/tenant and admin modes for
the same collection. Do not add `@terreno/syncdb` as a hard dependency of
admin-frontend.

``````typescript
// app/admin/index.tsx
import {AdminHome} from "@terreno/admin-frontend";
import {api} from "@/store/openApiSdk";

export default function AdminScreen() {
  return <AdminHome api={api} apiBase="/admin" routeBase="/admin" />;
}
``````

## Components

### OrgDirectoryScreen

`OrgDirectoryScreen` is the operator-only organization directory. It renders
loading, error, and empty states plus actions to create, disable, and open an
organization. **Open** also calls `selectOrganization` when the directory is
inside `OrgContextProvider`, so `X-Organization-Id` is set even if the host
callback only navigates.

``````typescript
const {selectOrganization} = useOrgContext();

<OrgDirectoryScreen
  api={api}
  isOperator={currentUser.roles?.includes("operator") ?? false}
  onEnterOrganization={(organization) => {
    selectOrganization(organization);
    router.push(`/admin/orgs/${organization._id}`);
  }}
  routeBase="/admin"
/>
``````

Pass the same operator check to `AdminShellLayout` to expose the directory in
navigation. Org-admins do not receive this link:

``````typescript
<AdminShellLayout
  api={api}
  apiBase="/admin"
  isOrganizationOperator={isOperator}
  organizationDirectoryPath="/orgs"
  routeBase="/admin"
>
  {children}
</AdminShellLayout>
``````

### OrgContextProvider and OrgSwitcher

Wrap organization-aware admin routes with `OrgContextProvider` and render
`OrgSwitcher` through the shell's `organizationSwitcher` slot. Selecting an
organization navigates to `{routeBase}/orgs/:orgId` and adds
`X-Organization-Id` to subsequent `useAdminApi` requests. Query cache keys also
include the organization id, preventing rows cached for one org from appearing
in another. Derive `initialOrganization` from the current pathname so context
follows URL changes after mount without overriding a switcher selection while
navigation is in progress.

``````typescript
const pathname = usePathname();
const routeOrganization = useMemo(
  () => organizationFromPath(pathname),
  [pathname]
);

<OrgContextProvider initialOrganization={routeOrganization}>
  <AdminShellLayout
    api={api}
    apiBase="/admin"
    organizationSwitcher={<OrgSwitcher api={api} routeBase="/admin" />}
    routeBase="/admin"
  >
    {children}
  </AdminShellLayout>
</OrgContextProvider>
``````

When `/orgs/mine` returns one organization, `OrgSwitcher` shows its name and
selects it automatically. With multiple organizations it selects the first by
name (then id) as a deterministic default and renders a selector.
Its **Organization** label uses the shell's inverted text color.
When `/orgs/mine` returns **403** (callers without org-admin memberships, per API
docs), the switcher renders nothing instead of an error banner. Other failures
still show "Organizations unavailable".

`OrgDirectoryScreen` (operators only) lists every organization, including
disabled ones. Each row offers **Disable** or **Re-enable**; re-enabling sends
`PATCH /orgs/:id` with `{disabled: false}`.

### OrgSettingsScreen and OrgMembersScreen

Use `OrgSettingsScreen` at `/admin/orgs/:orgId` and `OrgMembersScreen` at
`/admin/orgs/:orgId/members`. Both send the selected organization header.

`OrgSettingsScreen` edits the organization name and app-defined settings JSON.
Type settings in the host app by augmenting `OrganizationSettings` (exported from
this package and from `@terreno/api`) and reading them with
`organizationSettingsOf(organization)`. The JSON editor still sends a full
settings object on save; the backend schema rejects unknown keys.
It includes a Billing card marked unavailable; billing is outside the
organization-management feature.

`OrgMembersScreen` lists current memberships, attaches an existing user by
email, changes member roles, and removes members. Backend errors such as
`Cannot remove the last org-admin` are shown inline. Invite is intentionally
disabled because invitation tokens and email belong to the later invitations
feature. The members page uses the full available admin content width.

### AdminModelList

Entry screen showing all available models as cards.

``````typescript
<AdminModelList
  baseUrl="/admin"
  api={api}
/>
``````

Fetches config from `{baseUrl}/config` and displays clickable model cards.

### AdminModelTable

Table view for a specific model with pagination, sorting, and actions.

``````typescript
<AdminModelTable
  baseUrl="/admin"
  api={api}
  modelName="User"
/>
``````

Features:
- DataTable with columns from backend `listFields`
- Toolbar search maps to list `q` (backend partial match + ObjectId lookup)
- Declared `filters` map to DataTable column filters (`text` contains, `choice`
  multi `$in`, `boolean`, `dateRange`, `ref` via `AdminRefField` in `renderFilter`)
- Optional choice fields include **Empty**, which matches missing and null values.
  Admin list requests serialize nested operators with bracket notation independently
  of the host application's RTK base-query configuration.
- Click row to edit
- "Create New" button
- Pagination controls
- Reference fields render as clickable links
- Windowed TinyBase path when `AdminProvider` has `syncDb` plus a fetch client (`credentials` or `getAuthHeaders`) and `GET /admin/config` reports `adminBroadcast` + `syncCollection` on a String `_id` model: REST list is membership only, rows overlay TinyBase, and a TinyBase table listener rerenders known rows as `{collection}|admin` deltas arrive. **Refresh** (`testID="admin-table-refresh"`) re-queries REST and calls `hydrateWindow`. **Create** (`testID="admin-create-button"`) is in the table chrome, not the navigator header, because admin stacks use `headerShown: false`. **Save** / **Delete** (`testID="admin-save-button"` / `admin-delete-button`) are in the form chrome for the same reason. Page select-all and bulk actions use the rendered rows, so a row a live tombstone removed leaves the selection. RTK `refetch` error envelopes (`error` / `isError`) toast and skip hydrate; an in-flight Refresh is discarded when page, search, or sort changes. A windowed create or delete never touches the cached REST list, so the form flags the collection through `markAdminWindowMembershipStale` and the changelist refetches membership automatically — whether it stayed mounted behind the form or remounts when the form pops. A create also passes the new id as `awaitId`, because `mutate` only enqueues on the outbox and the first refetch can beat the server; the changelist retries up to three times, 700 ms apart — including after transient list failures — then leaves **Refresh** as the fallback. Passing only `api` keeps the RTK list.
- Organization-scoped models report `organizationScoped: true` and
  `adminBroadcast: false`. They use REST list and mutation paths until the sync
  window protocol carries selected-organization context. Home widgets delay
  those list queries until `OrgContextProvider` has selected an organization.
  `AdminModelForm` uses the same skip for org-scoped edit reads so create/edit
  does not hit the API with a missing `X-Organization-Id`.
  `AuditEvent` stays `organizationScoped: false` so Recent Activity and the
  audit changelist still load unscoped rows when no organization is selected.

### AdminModelForm

Create or edit form for a model instance.

``````typescript
<AdminModelForm
  baseUrl="/admin"
  api={api}
  modelName="User"
  id="507f1f77bcf86cd799439011"  // Optional for edit mode
/>
``````

Auto-generates fields from model schema:
- `string` → TextField
- `boolean` → BooleanField
- `number` → NumberField
- `date` → DateTimeField
- `objectid` (ref) → SelectField
- `enum` → SelectField with options

System fields (`_id`, `__v`, `created`, `updated`, `deleted`) are automatically skipped.

When `AdminProvider` has `syncDb` plus a fetch client and the model config reports
`adminBroadcast`, `syncCollection`, and a String `_id`, create/update/delete use the
syncdb mutation outbox. Edit update/delete first hydrate the REST-loaded record so a
deep-linked form can mutate locally. ObjectId models and hosts without the full
windowed configuration keep the REST/RTK mutation path. Organization-scoped
models always use REST/RTK regardless of String `_id`.

Pass the host's `useConflicts()` result as `syncConflicts` on `AdminProvider`.
Windowed form mutations set their own pending state before any asynchronous work, so
Save/Delete show loading and duplicate presses cannot enqueue a second mutation.

Windowed tables and forms render `AdminConflictSheet`, filtered to the ids loaded
on that page or form, and forward **Use server** / **Keep mine** to syncdb's
resolver. Only the most recently mounted sheet per collection renders, so a form
stacked over its changelist shows one sheet instead of two.
This adapter keeps `@terreno/syncdb` optional for admin-frontend.
Bulk actions remain server operations: windowed models call the host fetch
client at `{routePath}/bulk-patch`, while API-only/ObjectId hosts retain RTK.

```tsx
const syncConflicts = useConflicts();

<AdminProvider
  api={api}
  apiBase="/admin"
  syncConflicts={syncConflicts}
  syncDb={syncDb}
>
  {children}
</AdminProvider>;
```

### AdminRolesList

Role editing starts with a dedicated **Admin page** toggle for `admin:access`. That is the only
permission that opens the admin panel. Grant it first; model and tool permissions do nothing until
the role can enter.

Standard admin model permissions then use one access-level selector:

- No access
- Read only
- Read + write owned
- Read + write all

Other application and screen permissions remain individual toggles. Saving writes the same
permission JSON used by `rbacRouter`, so no separate configuration format is required.

### AdminFieldRenderer

Renders field values in table cells with formatting.

``````typescript
<AdminFieldRenderer
  value={value}
  field={fieldConfig}
  modelName="User"
  baseUrl="/admin"
/>
``````

Handles booleans, dates, ObjectId refs, arrays, objects, and null/undefined.

### AdminRefField

Renders reference fields as clickable links.

``````typescript
<AdminRefField
  value={userId}
  refModel="User"
  baseUrl="/admin"
/>
``````

## Hooks

### useAdminConfig

Fetches admin configuration from backend.

``````typescript
const {config, isLoading, error} = useAdminConfig(api, baseUrl);
``````

Returns model metadata from `{baseUrl}/config`.

### useAdminApi

> Deprecated in Terreno 57: do not add new admin `injectEndpoints`. Terreno 58
> removes `useAdminApi` and the required `api` prop. During the compatibility
> window, continue passing `api` for ObjectId model CRUD and API-only hosts.

Generates compatibility RTK Query hooks for list/read/create/update/delete plus
`POST {routePath}/bulk-patch`.
Pass the model's `routePath` from config (for example `/admin/users` or `/admin/todos`), not the admin `baseUrl`.

Admin RPC that is leaving RTK uses native `adminRequest` (`AbortController` timeout, JSON or `FormData`, `credentials` forwarded). Bind host auth with `bindAdminRequest`. Do not add axios.

``````typescript
const {
  useListQuery,
  useReadQuery,
  useCreateMutation,
  useUpdateMutation,
  useDeleteMutation,
  useBulkPatchMutation,
} = useAdminApi(api, "/admin/users", "User");

const {data, isLoading} = useListQuery({limit: 20, page: 1, q: "Ada", sort: "-created"});
const [create] = useCreateMutation();
await create({email: "user@example.com"}).unwrap();
const [bulkPatch] = useBulkPatchMutation();
await bulkPatch({ids: ["abc"], patch: {name: "Ada"}}).unwrap();
``````

## Expo Router Setup

``````typescript
// app/admin/_layout.tsx
import {Stack} from "expo-router";

export default function AdminLayout() {
  return <Stack screenOptions={{headerShown: false}} />;
}

// app/admin/index.tsx - Model list
import {AdminModelList} from "@terreno/admin-frontend";
export default () => <AdminModelList baseUrl="/admin" api={api} />;

// app/admin/[modelName]/index.tsx - Model table
import {AdminModelTable} from "@terreno/admin-frontend";
export default () => {
  const {modelName} = useLocalSearchParams();
  return <AdminModelTable baseUrl="/admin" api={api} modelName={modelName} />;
};

// app/admin/[modelName]/new.tsx - Create form
import {AdminModelForm} from "@terreno/admin-frontend";
export default () => {
  const {modelName} = useLocalSearchParams();
  return <AdminModelForm baseUrl="/admin" api={api} modelName={modelName} />;
};

// app/admin/[modelName]/[id].tsx - Edit form
import {AdminModelForm} from "@terreno/admin-frontend";
export default () => {
  const {modelName, id} = useLocalSearchParams();
  return <AdminModelForm baseUrl="/admin" api={api} modelName={modelName} id={id} />;
};
``````

## Protecting Admin Routes

``````typescript
// app/_layout.tsx
import {useSelectCurrentUser} from "@/store/openApiSdk";
import {Redirect} from "expo-router";

function RootLayout() {
  const user = useSelectCurrentUser();
  const pathname = usePathname();
  
  if (!user?.admin && pathname.startsWith("/admin")) {
    return <Redirect href="/" />;
  }
  
  return <Stack />;
}
``````

## Custom Field Renderers

Extend `AdminFieldRenderer` for custom field types:

``````typescript
const CustomFieldRenderer = ({value, field, ...props}) => {
  if (field.type === "myCustomType") {
    return <MyCustomComponent value={value} />;
  }
  return <AdminFieldRenderer value={value} field={field} {...props} />;
};
``````

## Integration

Expects backend to provide:
1. `GET {baseUrl}/config` — Model metadata
2. CRUD routes at `{basePath}{routePath}` for each model
3. `admin:access` (or `IsAdmin` when RBAC is off) to open the page; per-model RBAC after that
4. Paginated responses: `{data, page, limit, total, more}`

When RBAC is enabled, `/admin/config` is filtered for the current user. `AdminShell` uses its
`platformTools` flags to hide denied Scripts, Roles, Version, and Configuration links, and only
renders model or custom-screen links returned by the server. The shell lifts Audit Log, Feature
Flags, and Jobs into the Platform section (Jobs still comes from `customScreens`).

### Custom screen page chrome

Wrap custom admin screen content in `AdminScreenPage`. It renders the standard `Page` header with a back arrow by default; the arrow navigates to `/admin` via `router.push`, not `router.back()`, because sidebar navigation does not always leave a reliable history entry on web. Pass the host's `routeBase` as `backHref` when admin uses a different prefix; an empty standalone-admin base resolves to `/`. Detail screens can target their parent route (for example `/admin/comms`). Pass `backButton={false}` only when the host supplies equivalent navigation.

```typescript
import {AdminScreenPage} from "@terreno/admin-frontend";

<AdminScreenPage title="Operations" scroll>
  <OperationsDashboard />
</AdminScreenPage>
```

### Comms dashboard

`COMMS_ADMIN_WIDGETS.comms` is registered in the built-in screen registry. `CommsApp` contributes
custom screen `name: "comms"`. Hosts should also add message detail routes so `/comms/:id` is not
handled as a generic model form:

```typescript
import {CommsDashboardScreenWidget, CommsMessageDetail} from "@terreno/admin-frontend";

// list: /admin/comms
<CommsDashboardScreenWidget api={api} config={config} routeBase="/admin" screenName="comms" />

// detail: /admin/comms/[id]
<CommsMessageDetail api={api} messageId={id} routeBase="/admin" />
```

The list screen persists filters in the URL (`channel`, `provider`, `status`, `errorClass`, `q`,
`startDate`, `endDate`, `page`) and calls `/comms/messages`, `/comms/stats`, and
`/comms/messages/retryMany`.

### AI Observability chrome

`ObservabilityApp` contributes grouped custom screens (`group: "AI Observability"`): `ai-prompts`,
`ai-traces`, `ai-evaluators`, `ai-datasets`, `ai-experiments`, and `ai-review` when the local
plugin is on. `AI Requests` (`ai-requests`) stays ungrouped. Widgets also register detail routes:
`ai-prompt-editor`, `ai-trace-detail`, `ai-review-item`, `ai-evaluator-detail`, `ai-evaluator-new`,
`ai-dataset-detail`, `ai-experiment-new`, and `ai-experiment-results`.

Every observability screen wraps `AiObservabilityChrome`: breadcrumbs
`Admin / AI Observability / <Section> / <leaf>` and a status chip from
`GET /ai/observability/status` (`Local on|off` plus active primaries). Review queue nav and the
review screen body hide when `localOn` is false.

`ai-prompts` lists prompts with a folder rail, search, type badge, latest vs production columns
(tooltips), 7-day usage, and **Create prompt**. `ai-prompt-editor?name=` is the versioned editor:
full-width version history rows show `vN`, every label attached to that version, and its creation
time on one line. The selected row is highlighted. The editor keeps Editor / Playground tabs,
**Save as vN+1**, and **Set vN as production…** (modal names the outgoing version). Playground
**Run once** does not create a version; hosts may pass `apiKey` to
`AiPromptEditorScreenWidget`, which forwards it as `x-ai-api-key` without putting the key in the
request body. Pass `apiKeyLoading` while the host reads a saved key (for example from
`useStoredState`) so the playground waits instead of showing a missing-key message. Pass
`playgroundApiKeyHint` when `GET /ai/observability/status` reports
`playgroundAi.source: "request-key"`; the editor blocks **Run once** and shows that hint until a
trimmed key is available. When `playgroundAi.source` is `server`, no key is required. When it is
`unavailable`, the editor explains that the backend must configure `aiService` or
`requestAiServiceFactory`. A stale playground **503** with the missing-key title is remapped to the
same hint for `request-key` hosts so operators are not told to fix server configuration. The
example admin supplies the Gemini key saved from Profile. **Save this run to dataset** stays
disabled until phase 2.

`ai-traces` lists traces with a filter bar: from/to date fields; dropdowns for prompt, status,
score presence (**All traces / Has a score / No scores**), and data sensitivity
(**All traces / Sensitive only / Not sensitive**); plus user and session text fields.
Checkbox selection opens a bulk bar with **Send to human review**, a sensitive-count
warning, **Clear**, and **Add to dataset** (opens a dataset picker modal; sensitive traces show a
warning before bulk add). **Send to human review** opens a modal that explains how human
evaluators define the score fields and reviewer instructions, then requires a human evaluator
before creating one review-queue item per trace. When local trace storage is on,
**Run multi-stage trace test** calls the admin-only smoke endpoint and
opens the resulting detail: two schema-validated LLM stages, one deterministic tool span, and a
final schema-validated combining LLM stage under one CHAIN root. LLM span input includes
`outputSchema`. That run needs AI the same way the playground does: hosts may pass `apiKey`,
`apiKeyLoading`, and `apiKeyHint` to `AiTracesScreenWidget`, which forwards the key as
`x-ai-api-key`. When `GET /ai/observability/status` reports `playgroundAi.source: "request-key"`
and no trimmed key is available, the button is disabled and the hint explains where to save one;
`unavailable` instead reports that the backend must configure `aiService` or
`requestAiServiceFactory`. The example admin supplies the Gemini key saved from Profile. Rows show a status dot (primary for successful runs, accent for failed runs),
`sensitive` badge, error line, numeric prompt count, span count, tokens, cost, latency, score count, and
**Open**. Pagination uses `page` / `limit` / `more` / `total`.
`ai-trace-detail?id=` shows the header, left span list (kind badge, indent, duration bar),
right span detail with **collapsed** sensitive I/O, and scores (value + source). The two columns
size from the row width rather than their content, so a wide span value (multi-stage LLM spans embed
`outputSchema` JSON) wraps inside the detail column instead of pushing it below the span list.

`ai-review` shows Pending / In progress / Done / Skipped tabs with counts. Each tab is
oldest-first and lists the trace action, prompt, assignee, waiting time, and status.
**Start reviewing — oldest first** opens the first pending item; the empty state names both
Traces intake and manual **Assign to me** assignment.

`ai-review-item?id=` shows "Item N of M pending", previous/next navigation, read-only
**What the AI was given** / **What the AI wrote** panels, collapsed long fields with word
counts, reviewer notes, and a collapsed Raw JSON disclosure. Score controls come from evaluator
dimensions (numeric slider, boolean Pass / Fail, categorical pills). Actions are
**Submit & next**, **Skip**, and **Assign to me**; completion toasts report the remaining count
or **Queue clear**.

`ai-evaluators` lists evaluators with type badge, dimension summary, target, and run-mode chips.
**Create evaluator** opens `ai-evaluator-new` with the name and optional purpose first, then how
scoring happens (human / JSON assert / LLM judge). New evaluators score a **full trace** only;
generation span and dataset item targets are not offered yet. Score fields depend on data type:
boolean has no extra control, numeric asks for min and max, and categorical is a list you add to.
LLM judge picks the judge prompt from the existing prompt list. Human setup points operators to
**Send to human review** and omits live sampling because it never applies; automatic evaluators
explain experiment/manual availability and production sampling, while LLM judges call out the billed
model-call impact. The optional purpose is saved as the evaluator description and appears on its
detail screen. LLM judge schema feedback stays idle until a prompt is selected, then shows
loading/error states and only checks dimensions after its production schema loads.
`ai-evaluator-detail?id=` leads with the evaluator name, description, and type/target/run-mode
badges, then explains the saved scores, how scoring works, where it runs, and a **Used by** list
derived from recent experiments. Its dimension and usage rows use the shared `ObservabilityTable` instead of
`DataTable`, which sizes to a height-constrained parent and collapses inside a scrolling page. LLM
judge details show loading or load-failed feedback while resolving the judge prompt; schema
mismatches appear only after its production schema loads.

`ai-datasets` lists datasets with item counts, provenance bar, input-schema binding, and updated
time. **New dataset** creates a dataset; **Import** on each row accepts `.json` or `.csv` via
`FilePickerButton` (local URI read) or paste, posting `{rows}` for JSON or `{format:'csv',content}`
for CSV. `ai-dataset-detail?id=` shows counts, schema binding, tabs **All / Human / Auto / Needs
review**, an items table (input, expected, provenance, trace link), **Add item**, and **Run
experiment** navigation. The items table uses `ObservabilityTable`: rows grow with their content
and cells wrap to three lines before truncating, so long inputs and expected outputs no longer
overlap adjacent rows. Input and Expected receive 2.5× the flexible width of metadata columns.
Selecting a row opens a scrollable modal with the complete input, expected output, provenance,
annotation ids, tags, timestamps, metadata, and an **Open source trace** action when linked.
Opening the source trace dismisses the item modal before navigation.
Item-query loading and failures render dedicated states with Retry; they never appear as an empty
dataset.

`ObservabilityTable` (`widgets/aiObservability/shell/ObservabilityTable.tsx`) is the shared
flow-height table for these screens. Columns take a `title`, optional `minWidth`, and optional
relative `grow`; rows take a `key`, `cells`, and optional click/accessibility properties. A string
cell renders truncated text and a node cell renders as-is. Its
bordered shell shrink-wraps the rows inside flex/scroll parents so its bottom border cannot stretch
into the following section.

`ai-experiments` lists experiments with status, running progress, and cost. **New experiment**
opens a four-step wizard (dataset with counts, prompt versions tagged latest/production/superseded,
llm-judge and json-assert evaluators, review & run with estimate). Human evaluators are omitted. On the prompt-versions step, **Next** and the later
wizard rail buttons stay disabled until 2–3 versions are selected. `includeUnproofread` and optional model override are on
the wizard. `ai-experiment-results?id=` polls while pending/running, shows gate tiles per version,
failing gate count, outliers, a side-by-side per-item output table (failed rows first from the
API), and **Promote to production** with a confirm modal; promote is blocked when gates fail (409).
