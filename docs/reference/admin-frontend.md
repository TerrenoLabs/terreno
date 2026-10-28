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

Role cards and the **Available permissions** list split permissions into two groups:

1. **Custom permissions**: actions an app or plugin declared, such as `admin:runScripts` or
   `user:impersonate`.
2. **Model permissions**: the actions `modelRouter` and admin model access check: `create`,
   `list`, `read`, `update`, `delete`, `write`, and `writeOwned`.

A resource with both kinds of action appears in both groups. Each group shows one row per
resource, with that resource's actions as badges. Badge color shows the kind of access:

- Green: read-only actions (`read`, `list`, `access`, `view*`)
- Red: destructive actions (`delete`, `destroy`, `remove`)
- Amber: every other action. Custom actions (such as screen gates like `adminScreen:syncLab`)
  fall here because the screen cannot tell from the name whether they only read data

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

Every observability screen wraps `AiObservabilityChrome`: a breadcrumb row with a quiet status
chip from `GET /ai/observability/status` (**Local observability on** / **Local observability
off**), then one left-aligned page header (title, one-sentence description, optional meta badges,
and header actions on the right). There is no back arrow. List screens end the breadcrumbs at the
section (`Admin / AI Observability / <Section>`); detail screens add the leaf
(`Admin / AI Observability / <Section> / <leaf>`). Review queue nav and the review screen body
(including header actions) hide when `localOn` is false.

#### Shared patterns

The shell components live in `widgets/aiObservability/shell/`:

| Component | Use |
| --- | --- |
| `ObservabilityPageHeader` | The one page header: 32px title, one sentence of purpose, optional `meta`, and `actions` that wrap under the title on phones. `AiObservabilityChrome` renders it from `title`, `description`, `meta`, and `actions` |
| `ObservabilityStatusBadge` | The one status scale (`observabilityStatus.ts`): pending neutral, in progress / running info, done / completed / ok success, skipped neutral, failed / error error. Unknown statuses fall back to a neutral badge with a readable label |
| `AgreementMeter`, `ProgressMeter`, `MeterBar` | `AgreementMeter` shows judge-vs-people agreement as percent, bar, and badge from `AGREEMENT_THRESHOLDS`: ≥ 90% **Matches**, 75–89% **Close**, < 75% **Off**, otherwise **No answers yet** (`compact` drops the bar). `ProgressMeter` shows "8 of 10" with a bar. `MeterBar` is the thin bar both use |
| `ObservabilityEmptyState`, `ObservabilityErrorState` | Empty list: icon, short heading, the next step, and an optional outline action. Load failure: alert banner in place of the content with an outline **Try again** |
| `EvalStepper` | Numbered stepper: done steps show a check, the current step is filled, later steps are outlined. Used for the four-step eval plan and both New experiment wizards |

Rules:

- One primary action per screen, in the header. Other header actions are outline.
- Colour means state, never kind. Kinds (evaluator type, prompt folder, experiment kind) use
  neutral badges or `SegmentedControl` filters.
- Filters and pickers with a few fixed choices use `SegmentedControl`. Status tabs show counts as
  badges.
- Labels are readable words, not API keys (for example **Has a score**, **Agrees with people**).

Each observability list screen is contributed with `adminAccess: {resource, action: "list"}` so
`/admin/config` omits screens the caller cannot list (`aiPrompt`, `aiTrace`, `aiEvaluator`,
`aiDataset`, `aiExperiment`, `aiReview`). Detail routes stay registered on the host; route
handlers still enforce Task 4.1 RBAC.

`GET /ai/observability/status` includes a `permissions` map (per observability resource and
action). Legacy admin users and apps without `accessControl` receive all actions `true`. RBAC
callers receive effective flags for the signed-in user. Pass the same `accessControl` to
`ObservabilityApp` and `AdminApp` so status permissions match sidebar filtering. Admin widgets
read the payload through `resolvePromptActionPermissions` and `observabilityActionAllowed` (fail
closed while status is loading, errored, or missing `permissions`). List screens gate the header
**New prompt** on `aiPrompt:create`, **New evaluator** on `aiEvaluator:create`, and **New dataset**
on `aiDataset:create`; experiment lists hide **New experiment** without `aiExperiment:create`.
Dataset detail hides **Add item** without `aiDataset:update` and **Run experiment** without
`aiExperiment:create`; dataset lists hide **Import** without
`aiDataset:update`. Judge schema checks use the production prompt version, or the latest version
when production is unset. Widgets do not couple to host Redux.

`ai-prompts` lists prompts with a folder `SegmentedControl` (All plus each folder, with counts),
search, type, Production and Newest version columns, 7-day calls, last used, and a header **New
prompt** when `aiPrompt:create` is allowed. The create modal
includes an optional **Description** (saved on the prompt record and shown on the hub Overview tab).
`ai-prompt-editor?name=` is a prompt hub with **Overview**, **Versions**, **Traces**, and
**Experiments** tabs. Overview shows optional description, folder, tags, and latest vs production
badges. Traces and Experiments render bounded relationship rows from
`GET /ai/observability/prompts/:name?promptVersion=` (the hub pins the selected version, defaulting
to latest after the first load, so related traces and experiments are filtered server-side while the
full immutable version list stays on the detail payload). The **Versions** tab
hosts the versioned editor: full-width version history rows show `vN`, every label attached to
that version, and its creation time on one line. The selected row is highlighted. Editor /
Playground tabs appear on Versions when allowed; **Save as vN+1**, **Set vN as production…**, and
playground **Run once** hide when `aiPrompt:update`, `aiPrompt:promote`, or `aiPrompt:playground`
is denied (fields stay read-only). Playground **Run once** does not create a version; hosts may pass `apiKey` to
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

`ai-traces` lists traces in a `DataTable` sorted on the server (`sort` query param): Trace,
Status, Started, Tokens, Latency, Cost, and Scores are sortable, newest first by default.
Filters live in the column headers: Trace (prompt), Status (OK / Error), Started (date range), and
Scores (**Has a score**), plus additional filters for Sensitive, User, and Session. Changing a sort or
filter returns to page 1 and clears the selection.
Checkbox selection opens a bulk bar with **Send to human review**, a sensitive-count
warning, **Clear**, and **Add to dataset** (opens a dataset picker modal; sensitive traces show a
warning before bulk add). **Send to human review** opens a modal that explains how human
evaluators define the score fields and reviewer instructions, then requires a human evaluator
before creating one review-queue item per trace. When local trace storage is on, the header
**Run a test trace** action calls the admin-only smoke endpoint and
opens the resulting detail: two schema-validated LLM stages, one deterministic tool span, and a
final schema-validated combining LLM stage under one CHAIN root. LLM span input includes
`outputSchema`. That run needs AI the same way the playground does: hosts may pass `apiKey`,
`apiKeyLoading`, and `apiKeyHint` to `AiTracesScreenWidget`, which forwards the key as
`x-ai-api-key`. When `GET /ai/observability/status` reports `playgroundAi.source: "request-key"`
and no trimmed key is available, the button is disabled and the hint explains where to save one;
`unavailable` instead reports that the backend must configure `aiService` or
`requestAiServiceFactory`. The example admin supplies the Gemini key saved from Profile. Each row's
Trace cell (click to open) shows the name, a **Sensitive** badge, and a subline; Status shows the
shared status badge and the error line for failed runs; then tokens, latency, cost, and score
count. Pagination uses `page` / `limit` / `more` / `total`.
`ai-trace-detail?id=` shows the header, left span list (kind badge, indent, duration bar),
right span detail with **collapsed** sensitive I/O, and scores (value + source). The two columns
size from the row width rather than their content, so a wide span value (multi-stage LLM spans embed
`outputSchema` JSON) wraps inside the detail column instead of pushing it below the span list.

`ai-review` shows Pending / In progress / Done / Skipped as a `SegmentedControl` with counts.
Each tab is oldest-first and lists the output (click to open), question set, prompt, assignee,
waiting time, and status. Header actions are outline **Review batches** and the primary **Review
oldest pending**, which opens the first pending item; the empty state points to Traces and review
batches.

`ai-review-batches` lists batches with answered-by-people progress and the best judge's agreement.
Pick a question set and optional prompt, then the header primary **Grab 10 recent traces** creates
a batch. `ai-review-batch?id=` shows progress, **Answer N remaining**, **Run on N items** for a
chosen judge, and **Which judge matches people?** with an `AgreementMeter` per judge.

`ai-review-item?id=` is titled "Item N of M" (or "Review item" when not pending), with status and
source badges under the title and outline **Previous** / **Next** in the header. **What the AI was
given** and **What the AI wrote** are equal columns; the model output card uses the `ai` surface.
Long fields start collapsed with a word count; reviewer notes and a collapsed Raw JSON disclosure
stay available. Every question is on one screen: the segmented **Yes** / **No** control (or a
numeric slider or categorical pills) is a fixed-width column on the left and the question is on
the right. On web, `Y` / `N` answer the highlighted question as soon as the item opens, `Enter`
submits, and `S` skips. Actions are **Submit and open next**, **Assign to me**, and **Skip**;
completion toasts report the remaining count or **Queue clear** (**Batch complete** inside a
batch). The nested admin stack hides its header (`headerShown: false`); `AdminScreenPage` owns
the back arrow.

`ai-evaluators` lists evaluators with a kind `SegmentedControl` (All / Human / LLM judge / JSON
assert), kind, scores, looks at, runs in, and **Agrees with people** (`AgreementMeter`). The header
**New evaluator** opens `ai-evaluator-new` with the name and optional purpose first, then how
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
derived from recent experiments. A failed experiments request shows **Could not load experiments.**
instead of an empty 30-day list. Its dimension and usage rows use the shared `ObservabilityTable` instead of
`DataTable`, which sizes to a height-constrained parent and collapses inside a scrolling page. LLM
judge details show loading or load-failed feedback while resolving the judge prompt; schema
mismatches appear only after its production schema loads.

`ai-datasets` lists datasets with item counts, provenance bar, input-schema binding, and updated
time. The header **New dataset** creates a dataset; **Import** on each row accepts `.json` or `.csv` via
`FilePickerButton` (local URI read) or paste, posting `{rows}` for JSON or `{format:'csv',content}`
for CSV. `ai-dataset-detail?id=` shows counts, schema binding, tabs **All / Human / Auto / Needs
review** (a `SegmentedControl`). Human is proofread items. Auto is unreviewed trace or synthetic items, so a proofread
trace is not listed in both tabs. The screen includes an items table (input, expected, provenance,
trace link), **Add item**, and **Run experiment**. The items table uses `ObservabilityTable`: rows grow with their content
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

`ai-experiments` lists experiments with a kind `SegmentedControl` (All / Judge calibration /
Prompt comparison), status badge, running progress (`ProgressMeter`), result, and cost. The header
**New experiment** opens `ai-experiment-new`, where a `SegmentedControl` picks **Calibrate a
judge** or **Compare prompt versions**. Each pipeline is a four-step `EvalStepper` wizard with
ghost **Back** and primary **Continue** (the last step shows the run button). Compare prompt
versions: Dataset (with counts), Prompt versions (tagged latest/production/superseded),
Evaluators (llm-judge and json-assert), Review and run (with estimate). Calibrate a judge:
Judged dataset, Question set, Judge and versions, Review and run. A slower in-flight estimate is
ignored after the selection changes, so it cannot replace a newer estimate or its error. Human
evaluators are omitted. On the prompt-versions step, **Continue** and later stepper steps stay
disabled until 2–3 versions are selected. `includeUnproofread` and optional model override are on
the wizard. `ai-experiment-results?id=` polls while pending/running (`ProgressMeter`), shows one
verdict banner, one **Gates** table (Gate, Needs, one Pass / Fail column per version), outliers, a
side-by-side per-item output table (failed rows first from the API), and header actions outline
**Run again** and primary **Promote vN to production** with a confirm modal; promote is blocked
when gates fail (409).

### AI Harness approvals inbox

`HarnessApp` (`@terreno/ai/harness`) contributes custom screen `harness-approvals`
(`group: "AI Harness"`, label **Approvals**) through `adminContribution()`, so registering
`HarnessApp` before `AdminApp` is enough on the backend. `HARNESS_ADMIN_WIDGETS["harness-approvals"]`
(`HarnessApprovalsScreenWidget`) is in the built-in screen registry, so `/admin/harness-approvals`
renders through `AdminScreenRouter` with no host route file. See
[AI harness approvals](ai-harness.md#approvals).

The inbox lists the pending approvals the signed-in user may decide
(`GET /harness/approvals`, oldest first), each with title, task (`name@version` from
`definitionKey`), age, and expiry. Selecting one shows its `summary` (rendered with `MarkdownView`
when it looks like markdown) and `payload` (pretty JSON; a string payload that looks like
markdown renders as markdown), plus a **Reason** field and
**Approve** / **Reject**.

| Behavior | Detail |
| --- | --- |
| Approve | `POST /harness/approvals/:id/approve` with `{reason}` when one was typed, else `{}`. |
| Reject | Requires a non-blank reason (checked before the request); `POST .../reject` with `{reason}` (trimmed). |
| Success | Back to the list with a confirmation; the list refetches. |
| 409 | "Already decided, expired, or its task ended" notice; back to the list and refetch. |
| Other errors | The API error `title` under the buttons; the detail stays open. |
| States | Loading spinner, error with **Try again**, empty (**Nothing to approve.**), **Refresh** button. |
| Page size | The oldest 100 (`?limit=100`). When the response has `more`, a note says so; deciding items brings the rest into view. |
| In flight | Both buttons and the reason field are disabled until the decision returns, so it is sent once. |

Requests use the host-bound admin request client (`AdminProvider` `getAuthHeaders` / `apiOrigin`),
never RTK `injectEndpoints`. Test ids: `harness-approvals` (root), `harness-approvals-list`,
`harness-approvals-empty`, `harness-approvals-error`, `harness-approvals-loading`,
`harness-approvals-refresh`, `harness-approvals-notice`, `harness-approval-row-<id>-clickable`,
`harness-approval-detail`, `harness-approval-payload`, `harness-approval-reason`,
`harness-approval-approve`, `harness-approval-reject`, `harness-approval-error`,
`harness-approval-back` (standalone only; in admin the page back chevron closes the detail).

#### Mount outside admin chrome

`HarnessApprovalInbox` is exported for app screens (for example a clinician view). Inside an
`AdminProvider` it needs no props. Elsewhere, pass a request client from `bindAdminRequest`:

```typescript
import {bindAdminRequest, HarnessApprovalInbox} from "@terreno/admin-frontend";
import {baseUrl} from "@terreno/rtk";
import {Page} from "@terreno/ui";

// getAuthHeaders: the host's `() => ({Authorization: "Bearer …"})`, as passed to AdminProvider.
const request = bindAdminRequest({getAuthHeaders, origin: baseUrl});

export const SignOffScreen: React.FC = () => (
  <Page title="Sign-offs" scroll>
    <HarnessApprovalInbox request={request} />
  </Page>
);
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `request` | `(args: AdminRequestArgs) => Promise<unknown>` | `AdminProvider` client | Request client, usually `bindAdminRequest({getAuthHeaders, origin})`. |
| `baseUrl` | `string` | `/harness` | Where `HarnessApp` is mounted (its `basePath`). Relative paths resolve against the client's `origin`. |
| `selected` | `HarnessApprovalRow \| undefined` | internal | Controlled selection: the approval whose detail is open. |
| `onSelectedChange` | `(approval \| undefined) => void` | — | With `selected`, lets the host's back control close the detail; the inbox then hides its own **All approvals** button. The admin screen uses this so the page chevron returns to the list. |
| `showHeading` | `boolean` | `true` | Show the **Approvals** heading; the admin screen passes `false` because `AdminScreenPage` already titles it. |
| `testID` | `string` | `harness-approvals` | Root test id. |

The built-in admin screen always uses `/harness`. A host that mounts `HarnessApp` at another
`basePath` registers its own `widgets.screens["harness-approvals"]` that renders
`<HarnessApprovalInbox baseUrl="/ops/harness" />`.

The example backend registers `HarnessApp` with a demo task, `demo.approvalDemo@1`. Start
approvals with the admin script `startHarnessApprovalDemo` (args `count`, default 2, and `prefix`)
from the admin Scripts screen or `bun run script startHarnessApprovalDemo --wet`. It needs Mongo
running as a replica set; without one the backend logs `Harness disabled` and skips the routes.
`example-frontend/e2e/harness-approvals.spec.ts` approves one and rejects one.
