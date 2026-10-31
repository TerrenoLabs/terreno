# @terreno/admin-frontend

React Native components for building admin panels that connect to `@terreno/admin-backend`.

**Build a screen or change nav:** [How admin interfaces are shaped](../explanation/admin-interface.md)
and [Build admin screens](../how-to/build-admin-screens.md).

## Quick Start

Home is `AdminHome` inside `AdminProvider` + `AdminShellLayout`. Generic models use
`AdminScreenRouter` on `[model]/index`. See the how-to for `apiBase` vs `routeBase`.

`AdminProvider` is required. It binds host auth onto one fetch client, and every
admin request goes through it: model CRUD, `/admin/config`, scripts, roles,
configuration, documents, comms, jobs, organizations, consent, announcements,
version-config, background-tasks, migrations, AI observability, and the object
picker. Admin components take no `api` prop (the RTK `api` prop was removed in Terreno 58).

| Host | Props |
| --- | --- |
| Standalone SPA | `credentials="same-origin"` (cookie session). Omit `apiOrigin` and `getAuthHeaders`. |
| Embedded app | `getAuthHeaders` that return `Authorization: Bearer …`, plus `apiOrigin` set to the API origin (`baseUrl` from `@terreno/syncdb/config`) |

`AdminProvider` calls `bindAdminRequest({credentials, getAuthHeaders, origin: apiOrigin})`
and exposes the result through `useAdminRpc()`. Relative URLs such as `/admin/config` are
prefixed with `origin` when it is set. Successful mutations invalidate mounted queries
through tags; those background refetches keep cached data with `isLoading: false` and
report `isFetching: true`. An admin screen rendered outside `AdminProvider` falls back to
an unauthenticated same-origin `fetch` and warns once in development. Product screens that
reuse admin components (for example `DocumentStorageBrowser` or `ConsentHistory`) wrap
them in `AdminProvider` with the same auth binding. Do not add axios.

Optional `syncDb` on `AdminProvider` enables windowed changelists for models whose
config includes `adminBroadcast: true` and `syncCollection`. When product screens
also sync the same collection, inject a dedicated admin client/store configured
with `windowCollections`; one client cannot join owner/tenant and admin modes for
the same collection. Do not add `@terreno/syncdb` as a hard dependency of
admin-frontend.

``````typescript
// app/admin/index.tsx
import {AdminHome} from "@terreno/admin-frontend";

// Rendered inside the AdminProvider in app/admin/_layout.tsx.
const AdminScreen: React.FC = () => <AdminHome apiBase="/admin" routeBase="/admin" />;
export default AdminScreen;
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
`X-Organization-Id` to subsequent `useAdminModelApi` requests. Queries re-run when
the organization changes, so rows loaded for one org do not appear in another. Derive `initialOrganization` from the current pathname so context
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
    apiBase="/admin"
    organizationSwitcher={<OrgSwitcher routeBase="/admin" />}
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

Each active member row has a **Security** button (`org-members-security-{userId}`)
that opens a [`MemberSecurityPanel`](#membersecuritypanel) for that member below
the table. Suspended rows show **Reactivate** instead
(`org-members-reactivate-{userId}`), which sends
`PATCH /orgs/:orgId/members/:memberId` with `{status: "active"}`. After any
security action the members list reloads, so a suspended membership shows up at
once.

### MemberSecurityPanel

Shows one user's sign-in security and runs the recovery actions the server
offers for them. It reads the summary from the
[account security routes](./account-security.md) through the host-bound
`adminRequest` (`AdminProvider` `credentials` or `getAuthHeaders`, plus
`apiOrigin`), never through RTK Query. Without a fetch-capable `AdminProvider`
it shows `Admin RPC client is unavailable`.

```tsx
import {MemberSecurityPanel} from "@terreno/admin-frontend";

// Org-admin routes: /orgs/:orgId/members/:userId/security
<MemberSecurityPanel memberLabel="Ada" orgId={orgId} userId={userId} />

// Platform routes: /users/:id/security
<MemberSecurityPanel userId={userId} />
```

| Prop | Type | Description |
| --- | --- | --- |
| `userId` | `string` | App `User` id of the member |
| `orgId` | `string` | Organization id. Set it for the org-admin routes; omit it for the platform routes |
| `baseURL` | `string` | Route prefix. Defaults to `/orgs` with `orgId` and `/users` without |
| `memberLabel` | `string` | Name or email shown in the heading (`Security: {memberLabel}`) |
| `onActionComplete` | `(result) => void` | Called with the action's `{action, changed, ...}` after each success |
| `onClose` | `() => void` | Shows a **Close** button when set |
| `focusOnMount` | `boolean` | Move focus to the panel heading (`{testID}-heading`) when it mounts; on web it also scrolls it into view. Default `true` |
| `testID` | `string` | Root test id. Default `member-security-panel` |

What it shows:

- Email verified and disabled badges, and the last sign-in method and time.
- Sign-in methods: whether a password is set, and each linked provider with an
  **Unlink provider** button.
- Passkeys, each with a **Remove passkey** button.
- Two-factor status and backup codes left, with **Reset two-factor**.
- Active sessions, with **Sign out everywhere**.
- An **Actions** row with every other action in the summary's `actions`
  (`send-password-reset`, `suspend-membership`, `disable`, `enable`,
  `issue-sign-in-link`, and any action added on the server later).

Buttons render only for actions the summary lists, so the server decides what
each caller may do. The panel does not hard-code the list: an action it has
never seen still gets a button with the server's `label`, and it runs as
`{method} {securityPath}{path}` from the summary entry. For servers older than
the summary's `method` and `path`, it falls back to the built-in routes, then
`POST {securityPath}/{id}`.

Where a button goes depends on the action's path params:

- `:passkeyId` only: one button per passkey, filled from `passkeys.items[].id`.
- `:providerId` only: one button per linked provider, filled from
  `providers[].providerId`.
- No params: `reset-two-factor` and `revoke-sessions` sit in their sections;
  every other action goes in the **Actions** row.
- Any other param (such as `/devices/:deviceId`): no button, because the
  summary has nothing to fill it with.

Per-item buttons have accessible names that include the item, such as
`Remove passkey Work laptop` and `Unlink GitHub`; an unknown per-item action is
named `{label}: {item}`. The members screen's row buttons are named
`Security for {member}` and `Reactivate {member}`.

Destructive actions confirm in a `Modal` first (`{testID}-confirm`, buttons
`{testID}-confirm.primary` and `{testID}-confirm.secondary`). Known actions have
their own copy; for example, **Unlink provider** warns that sessions started with
that provider are not ended and points to **Sign out everywhere**. Unknown
actions get a generic confirmation.

After an action the panel shows the result in a `role="status"` region
(`{testID}-result`), such as
`Password reset email sent` or `Signed out of 2 sessions`, and refetches the
summary. `suspend-membership` puts the member out of the org routes' reach, so
the panel shows the result without refetching. When the response carries a
`url` (`issue-sign-in-link`), the panel shows it once with a **Copy link**
button (`{testID}-link-copy`) and a warning that it works once. After copying,
the button reads **Copied** and a status region (`{testID}-link-copied`) says
`Link copied to the clipboard`. Server error
titles, such as `Cannot remove the last sign-in method` or
`publicAppUrl is required to send recovery mail`, appear inline in a
`role="alert"` element (`{testID}-action-error`). A failed first load replaces the summary with
`{testID}-error`; a failed refetch keeps the summary, the result, and any
one-time link on screen and adds an inline alert (`{testID}-refresh-error`).

`useMemberSecurityApi({baseURL, orgId, userId})` is the hook behind the panel.
It returns `{summary, error, isLoading, isFetching, isRunning, refetch,
runAction, securityPath}`; `runAction({action, params})` fills path params such
as `{passkeyId}` and throws before sending when one is missing.
`memberSecurityPath` and `resolveSecurityActionRequest` are exported for custom
screens.

### UserSecurityScreen

The platform staff page for one user's sign-in security. It renders a header
naming the user, then a [`MemberSecurityPanel`](#membersecuritypanel) against the
platform routes (`/users/:id/security`). Only holders of `user:manageSecurity`
reach those routes: `superadmin`, and the locked `operator` role, which is seeded
only when the backend calls `createAccess({organizations: true})`. Without
organizations, grant `user:manageSecurity` on a role of your own. The server
also refuses acting on yourself and on a user holding any permission you lack,
such as a superadmin. The panel then shows the refusal title inline
(`{testID}-panel-error`) and the header still names the user.

```tsx
// app/admin/users/[id]/security.tsx
import {UserSecurityScreen} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";

const AdminUserSecurityRoute: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  return <UserSecurityScreen userId={id} />;
};

export default AdminUserSecurityRoute;
```

| Prop | Type | Description |
| --- | --- | --- |
| `userId` | `string` | App `User` id |
| `userModelName` | `string` | Admin model name of the user record. Default `User` |
| `apiBase` | `string` | Admin JSON base for `{apiBase}/config`. Defaults to the `AdminProvider` `apiBase` |
| `routeBase` | `string` | Admin route base. Defaults to the `AdminProvider` `routeBase` |
| `securityBaseURL` | `string` | Prefix of the security routes. Default `/users` |
| `backHref` | `string` | Where the back arrow goes. Default `{routeBase}/{userModelName}/{userId}`, the admin user record |
| `testID` | `string` | Root test id. Default `user-security-screen`; the panel is `{testID}-panel` |

The header reads `GET {apiBase}/config` to find `userModelName`'s `routePath`,
then `GET {routePath}/{userId}`, both through the host-bound `adminRequest`. It
shows the user's `name` (`{testID}-user-name`) and `email`
(`{testID}-user-email`). Without a name it shows the email, and without a
record it shows the id. While the record loads it shows a spinner
(`{testID}-user-loading`). When the record fails to load, an inline alert
(`{testID}-user-error`) says `Could not load the user record.`. The panel loads
on its own either way, because the security routes do not depend on the admin
record. If the user model is not registered in admin, the header shows the id
and no record request is sent.

#### Linking from the user record

`UserSecurityLink` is a **Security** button (`admin-user-security-link`) that
opens `userSecurityRoute({routeBase, userId})`, which is
`{routeBase}/users/{userId}/security`. Mount `UserSecurityScreen` at that path,
or pass `href` to the link. admin-frontend does not know which admin model is
your user model, so the host adds the link to its user record. The usual place
is `AdminModelForm`'s `footerContent`:

```tsx
// app/admin/[model]/[id].tsx
import {AdminModelForm, UserSecurityLink} from "@terreno/admin-frontend";

const footerContent =
  model === "User" && canManageUserSecurity ? <UserSecurityLink userId={id} /> : undefined;

<AdminModelForm api={api} baseUrl="/admin" footerContent={footerContent} itemId={id} mode="edit" modelName={model} />
```

Show the link and the route only to staff holding `user:manageSecurity` (or
`admin: true` without RBAC), and hide the link on the viewer's own record, since
the routes refuse self-targeting; staff manage their own account from their own
security screen. The example reads `permissions` from `/auth/me`
(`example-frontend/utils/userSecurityAccess.ts`), shows the link on other users'
`User` records, and shows everyone else an `AdminScreenPage`
(`admin-user-security-forbidden`) with a forbidden message and a back arrow to
the record. Add the
route to the admin `Stack` (`<Stack.Screen name="users/[id]/security" />`) next
to `[model]`.

### AdminModelList

Entry screen showing all available models as cards.

``````typescript
<AdminModelList baseUrl="/admin" />
``````

Fetches config from `{baseUrl}/config` and displays clickable model cards.

### AdminModelTable

Table view for a specific model with pagination, sorting, and actions.

``````typescript
<AdminModelTable baseUrl="/admin" modelName="User" />
``````

Features:
- DataTable with columns from backend `listFields`
- Toolbar search maps to list `q` (backend partial match + ObjectId lookup)
- Declared `filters` map to DataTable column filters (`text` contains, `choice`
  multi `$in`, `boolean`, `dateRange`, `ref` via `AdminRefField` in `renderFilter`)
- Optional choice fields include **Empty**, which matches missing and null values.
  Admin list requests serialize nested operators with bracket notation (`qs`).
- Click row to edit
- "Create New" button
- Pagination controls
- Reference fields render as clickable links
- Windowed TinyBase path when `AdminProvider` has `syncDb` and `GET /admin/config` reports `adminBroadcast` + `syncCollection` on a String `_id` model: REST list is membership only, rows overlay TinyBase, and a TinyBase table listener rerenders known rows as `{collection}|admin` deltas arrive. **Refresh** (`testID="admin-table-refresh"`) re-queries REST and calls `hydrateWindow`. **Create** (`testID="admin-create-button"`) is in the table chrome, not the navigator header, because admin stacks use `headerShown: false`. **Save** / **Delete** (`testID="admin-save-button"` / `admin-delete-button`) are in the form chrome for the same reason. Page select-all and bulk actions use the rendered rows, so a row a live tombstone removed leaves the selection. Membership `refetch` errors (`error` / `isError`) toast and skip hydrate; an in-flight Refresh is discarded when page, search, or sort changes. A windowed create or delete never touches the cached REST list, so the form flags the collection through `markAdminWindowMembershipStale` and the changelist refetches membership automatically — whether it stayed mounted behind the form or remounts when the form pops. A create also passes the new id as `awaitId`, because `mutate` only enqueues on the outbox and the first refetch can beat the server; the changelist retries up to three times, 700 ms apart — including after transient list failures — then leaves **Refresh** as the fallback. Other models use the REST list from `useAdminModelApi`.
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
- `object` with `items` (a nested schema path such as `tasks: {enabled: Boolean, intakePollMs: Number}`)
  → a titled group with one control per subfield, recursing to any depth
- `object` without `items` (`Mixed`, `Map`) and `mixed` → JSON editor

A nested object group uses the field's humanized key as its heading and its `description` as
helper text. Each subfield shows its own description and its schema default when the stored
object has no value for it. Subfield test IDs use the dotted path, for example
`admin-field-tasks.enabled`; the group itself is `admin-field-group-tasks`. Editing a subfield
merges it into the parent object, and Save sends the whole object for that field. In create mode
the object starts from each subfield's default; enums, refs, dates, and Mixed subfields without a
default are left out. Nested objects inside an array of subdocuments render the same way; their
test IDs add the array key and item index (`admin-field-servers.0.media.port`), and new array
items follow the same default rules.

System fields (`_id`, `__v`, `created`, `updated`, `deleted`) are automatically skipped.

When `AdminProvider` has `syncDb` and the model config reports
`adminBroadcast`, `syncCollection`, and a String `_id`, create/update/delete use the
syncdb mutation outbox. Edit update/delete first hydrate the REST-loaded record so a
deep-linked form can mutate locally. ObjectId models and hosts without the full
windowed configuration use REST fetch CRUD (`useAdminModelApi`). Organization-scoped
models always use REST regardless of String `_id`.

Pass the host's `useConflicts()` result as `syncConflicts` on `AdminProvider`.
Windowed form mutations set their own pending state before any asynchronous work, so
Save/Delete show loading and duplicate presses cannot enqueue a second mutation.

Windowed tables and forms render `AdminConflictSheet`, filtered to the ids loaded
on that page or form, and forward **Use server** / **Keep mine** to syncdb's
resolver. Only the most recently mounted sheet per collection renders, so a form
stacked over its changelist shows one sheet instead of two.
This adapter keeps `@terreno/syncdb` optional for admin-frontend.
Bulk actions remain server operations: windowed models call the host fetch
client at `{routePath}/bulk-patch` for every model.

```tsx
const syncConflicts = useConflicts();

<AdminProvider
  apiBase="/admin"
  apiOrigin={baseUrl}
  getAuthHeaders={getAdminAuthHeaders}
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

### Consent records and PDFs

`ConsentResponseViewer` (admin, one `ConsentResponse`) and `ConsentHistory` (the signed-in
user's own `GET /consents/my` entries) download a consent record as a PDF:
`generateConsentPdf(response)` and `generateConsentHistoryPdf(entry)`. Web builds the PDF with
jsPDF; native renders `buildConsentPdfHtml` from `@terreno/ui` and shares it with
`sharePdfFromHtml`.

When the response is provisional (staff signed on the user's behalf), both PDFs add a
"Provisional signature" section: the signer and date, and "Voided <date>" when it was voided.
The admin PDF also includes the signer's note and IP address. The user's own PDF never
includes the note.

Both views can also print a record: `ConsentResponseViewer`'s "Print" button
(`consent-response-print-button`) and each `ConsentHistory` entry's print icon
(`consent-history-print-{entryId}`, in the expanded details) call `printConsentHtml` from
`@terreno/ui` with `buildConsentPdfHtml` HTML, including the provisional block. The
"Download PDF" buttons are unchanged.

Provisional display:

- `ConsentResponseViewer` adds a "Provisional Signature" card (`consent-response-provisional`)
  with a "Provisional" badge, the signer, signing date, note, signer IP, and, once voided, a
  "Voided" badge (`consent-response-provisional-voided`), void date, and reason.
- `ConsentHistory` marks provisional entries with a "Provisional" badge and "Signed on your
  behalf by <name>" (`consent-history-provisional-{entryId}`), plus "Voided" when voided. It
  never shows the note.

## Hooks

### useAdminConfig

Fetches admin configuration from backend.

``````typescript
const {config, isLoading, error} = useAdminConfig("/admin");
``````

Returns model metadata from `{baseUrl}/config`.

### useAdminModelApi

Fetch CRUD hooks for one admin model over the `AdminProvider` client: list, read,
create, update, delete, plus `POST {routePath}/bulk-patch`. Pass the model's
`routePath` from config (for example `/admin/users` or `/admin/todos`), not the admin
`baseUrl`. List resolves to the `{data, more, page, limit, total}` envelope; read,
create, and update resolve to the document. Writes refetch mounted list and read
queries for the same model, and organization-scoped admin sends `X-Organization-Id`.
Replaces the Terreno 57 `useAdminApi(api, routePath, modelName)` RTK hook.

``````typescript
const {
  useListQuery,
  useReadQuery,
  useCreateMutation,
  useUpdateMutation,
  useDeleteMutation,
  useBulkPatchMutation,
} = useAdminModelApi("/admin/users", "User");

const {data, isLoading, refetch} = useListQuery({limit: 20, page: 1, q: "Ada", sort: "-created"});
const [create] = useCreateMutation();
await create({email: "user@example.com"}).unwrap();
const [bulkPatch] = useBulkPatchMutation();
await bulkPatch({ids: ["abc"], patch: {name: "Ada"}}).unwrap();
``````

### useAdminRpc, useAdminRpcQuery, useAdminRpcMutation

`useAdminRpc()` returns the `AdminProvider` fetch client. `useAdminRpcQuery({rpc, url,
providesTags, headers, skip, pollingInterval, transformResponse})` runs a GET and
returns `{data, error, isError, isLoading, isFetching, refetch}`;
`useAdminRpcMutation(rpc, {invalidatesTags})` returns `[trigger, {isLoading}]` where
`trigger(args).unwrap()` sends the request. Use these for custom admin RPC. The
client is `adminRequest`, built on `apiFetch` from `@terreno/syncdb/api` (timeout, JSON or
`FormData`, `credentials` forwarded); `unwrapAdminEnvelope` unwraps `{data}` responses the
same way the syncdb request client does.

## Expo Router Setup

``````typescript
// app/admin/_layout.tsx
import {AdminProvider} from "@terreno/admin-frontend";
import {baseUrl} from "@terreno/syncdb/config";
import {Stack} from "expo-router";
import {getAdminAuthHeaders} from "@/store/syncdb"; // () => ({Authorization: "Bearer …"})

export default function AdminLayout() {
  return (
    <AdminProvider apiBase="/admin" apiOrigin={baseUrl} getAuthHeaders={getAdminAuthHeaders} routeBase="/admin">
      <Stack screenOptions={{headerShown: false}} />
    </AdminProvider>
  );
}

// app/admin/index.tsx - Model list
import {AdminModelList} from "@terreno/admin-frontend";
export default () => <AdminModelList baseUrl="/admin" />;

// app/admin/[modelName]/index.tsx - Model table
import {AdminModelTable} from "@terreno/admin-frontend";
export default () => {
  const {modelName} = useLocalSearchParams();
  return <AdminModelTable baseUrl="/admin" modelName={modelName} />;
};

// app/admin/[modelName]/new.tsx - Create form
import {AdminModelForm} from "@terreno/admin-frontend";
export default () => {
  const {modelName} = useLocalSearchParams();
  return <AdminModelForm baseUrl="/admin" modelName={modelName} />;
};

// app/admin/[modelName]/[id].tsx - Edit form
import {AdminModelForm} from "@terreno/admin-frontend";
export default () => {
  const {modelName, id} = useLocalSearchParams();
  return <AdminModelForm baseUrl="/admin" modelName={modelName} id={id} />;
};
``````

## Protecting Admin Routes

``````typescript
// app/admin/_layout.tsx
import {canOpenAdminPage} from "@terreno/syncdb/app";
import {useSession} from "@terreno/syncdb/auth";
import {Redirect} from "expo-router";
import {useGetAuthMeQuery} from "@/store/apiSdk";

const AdminGate: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {userId} = useSession();
  const {data: me, isLoading} = useGetAuthMeQuery(undefined, {skip: !userId});

  if (isLoading) {
    return null;
  }
  if (!canOpenAdminPage({admin: me?.admin, permissions: me?.permissions})) {
    return <Redirect href="/" />;
  }
  return <>{children}</>;
};
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

A user record's `roles` field loads the role catalog (`GET /rbac/roles`, `rbac:read`) only when
it is editable. A read-only record, such as an operator's view with `adminUser:read`, lists the
assigned role names without requesting the catalog.

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
<CommsDashboardScreenWidget config={config} routeBase="/admin" screenName="comms" />

// detail: /admin/comms/[id]
<CommsMessageDetail messageId={id} routeBase="/admin" />
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

Each observability list screen is contributed with `adminAccess: {resource, action: "list"}` so
`/admin/config` omits screens the caller cannot list (`aiPrompt`, `aiTrace`, `aiEvaluator`,
`aiDataset`, `aiExperiment`, `aiReview`). Detail routes stay registered on the host; route
handlers still enforce Task 4.1 RBAC.

`GET /ai/observability/status` includes a `permissions` map (per observability resource and
action). Legacy admin users and apps without `accessControl` receive all actions `true`. RBAC
callers receive effective flags for the signed-in user. Pass the same `accessControl` to
`ObservabilityApp` and `AdminApp` so status permissions match sidebar filtering. Admin widgets
read the payload through `resolvePromptActionPermissions` and `observabilityActionAllowed` (fail
closed while status is loading, errored, or missing `permissions`). List screens gate **Create
prompt** on `aiPrompt:create`, **Create evaluator** on `aiEvaluator:create`, and **New dataset** on
`aiDataset:create`; experiment lists hide **New experiment** without `aiExperiment:create`.
Dataset detail hides **Add item** without `aiDataset:update` and **Run experiment** without
`aiExperiment:create`; dataset lists hide **Import** without
`aiDataset:update`. Judge schema checks use the production prompt version, or the latest version
when production is unset. Widgets do not couple to host app state.

`ai-prompts` lists prompts with a folder rail, search, type badge, latest vs production columns
(tooltips), 7-day usage, and **Create prompt** when `aiPrompt:create` is allowed. The create modal
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
derived from recent experiments. A failed experiments request shows **Could not load experiments.**
instead of an empty 30-day list. Its dimension and usage rows use the shared `ObservabilityTable` instead of
`DataTable`, which sizes to a height-constrained parent and collapses inside a scrolling page. LLM
judge details show loading or load-failed feedback while resolving the judge prompt; schema
mismatches appear only after its production schema loads.

`ai-datasets` lists datasets with item counts, provenance bar, input-schema binding, and updated
time. **New dataset** creates a dataset; **Import** on each row accepts `.json` or `.csv` via
`FilePickerButton` (local URI read) or paste, posting `{rows}` for JSON or `{format:'csv',content}`
for CSV. `ai-dataset-detail?id=` shows counts, schema binding, tabs **All / Human / Auto / Needs
review**. Human is proofread items. Auto is unreviewed trace or synthetic items, so a proofread
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

`ai-experiments` lists experiments with status, running progress, and cost. **New experiment**
opens a four-step wizard (dataset with counts, prompt versions tagged latest/production/superseded,
llm-judge and json-assert evaluators, review & run with estimate). A slower in-flight estimate is ignored after the selection changes, so it cannot replace a newer estimate or its error. Human evaluators are omitted. On the prompt-versions step, **Next** and the later
wizard rail buttons stay disabled until 2–3 versions are selected. `includeUnproofread` and optional model override are on
the wizard. `ai-experiment-results?id=` polls while pending/running, shows gate tiles per version,
failing gate count, outliers, a side-by-side per-item output table (failed rows first from the
API), and **Promote to production** with a confirm modal; promote is blocked when gates fail (409).

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
never a second request client. Test ids: `harness-approvals` (root), `harness-approvals-list`,
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
import {baseUrl} from "@terreno/syncdb/config";
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
