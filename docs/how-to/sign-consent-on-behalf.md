# Sign consent on a user's behalf

Let staff record consent for a user ahead of time, for example after a guardian agrees by
phone at intake. The form counts as signed from then on, and the user still sees it and signs
it themselves. Concepts: [Consent forms](../explanation/consent-forms.md#provisional-signatures).

## 1. Pass access control to ConsentApp

Add `userSchema.plugin(rbacUserPlugin)` (from `@terreno/api`) to your User schema so users
have a `roles` field and role assignments are saved. Then wire RBAC into the app:

```typescript
import {
  backfillAdmins,
  ConsentApp,
  createAccess,
  rbacRouter,
  TerrenoApp,
  terrenoStatements,
} from "@terreno/api";

const access = createAccess({
  connection: mongoose.connection,
  statements: terrenoStatements,
  userModel: User,
});

// After connecting to MongoDB: create or update the built-in roles.
await access.roles.seedDefaults();
// Give existing `admin: true` users the superadmin role, so they keep their access.
await backfillAdmins({access, userModel: User, wetRun: true});

new TerrenoApp({accessControl: access, userModel: User})
  .register(rbacRouter({access, userModel: User}))
  .register(new ConsentApp({accessControl: access, auditTrail: true}))
  .start();
```

With `accessControl`, any authenticated user whose roles grant
`consentResponse:signOnBehalf` may sign, read statuses, and void for other users. Without it,
only `user.admin` users may, and `ConsentApp` logs a warning at startup. With
`accessControl`, `user.admin` alone no longer grants signing: the user needs a role that
grants it. Turn on
`auditTrail` to keep the signer's IP address and user agent and a snapshot of the content they
signed. `rbacRouter` mounts the `/rbac` role API used in step 2.

Register `AuditApp` too if you want every provisional signature, status read, and void in the
audit log.

## 2. Grant the permission

The built-in `admin` role includes `consentResponse: ["signOnBehalf"]`. Databases created
before this release get it the next time roles are seeded (`access.roles.seedDefaults()`),
without losing other grants on an unsealed `admin` role. `superadmin` has every action.

For staff who are not admins, create a role and assign it. `$TOKEN` must belong to a user
whose roles grant `rbac:manageRoles` and `rbac:assignRoles`, such as `superadmin`; the
built-in `admin` role has neither.

```bash
curl -X POST "$API/rbac/roles" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "intake-staff", "displayName": "Intake staff",
       "permissions": {"consentResponse": ["signOnBehalf"]}}'

curl -X PUT "$API/rbac/users/$STAFF_USER_ID/roles" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"roleNames": ["intake-staff"]}'
```

There is no relationship check: a permitted signer can sign for any user. Give the role only
to staff who should have that reach.

## 3. Mount the signer screen

```tsx
import {Page, ProvisionalConsentSigner} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import {terrenoApi} from "@/store/sdk";

const ConsentSignScreen: React.FC = () => {
  const {userId} = useLocalSearchParams<{userId: string}>();
  return (
    <Page backButton title="Sign consent on behalf">
      <ProvisionalConsentSigner api={terrenoApi} userId={userId} />
    </Page>
  );
};
```

Put the route outside your admin area if non-admin staff use it. The component lists every
form that applies to the user with its status. Staff open a pending form, read it,
write a note saying how consent was obtained, and sign. The user then sees "Signed on your
behalf by <name> on <date>" above the form in their consent gate, but not the note.

Build your own UI with `useProvisionalConsent({api, userId})` instead, which returns
`statuses`, `sign`, and `voidSignature`.

## 4. Check whether a user is considered signed

```typescript
import {getConsentStatuses} from "@terreno/api";

const rows = await getConsentStatuses({resolveConsentForms, userId});
const canSchedule = rows.filter((row) => row.form.required).every((row) => row.isConsented);
```

`isConsented` is true for `signed` and `provisional`. The user's own answer always wins: once
they agree the row is `signed`, and once they decline it is `declined`. Pass the same
`resolveConsentForms` you gave `ConsentApp`. Clients call `GET /consent-responses/status?userId=`
for the same rows.

## 5. Void a signature made in error

In `ProvisionalConsentSigner`, press "Void" on a provisional row and give a reason. Over HTTP:

```bash
curl -X POST "$API/consent-responses/$RESPONSE_ID/void" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"reason": "Signed for the wrong member"}'
```

The record stays, with `voidedAt`, `voidedBy`, and `voidReason` set. The form returns to
`pending` and the user's notice disappears.

## 6. Print a consent record

- `ProvisionalConsentSigner`: "Print" on a provisional, signed, or declined row, or on the
  confirmation after signing.
- Admin: the "Print" button on `ConsentResponseViewer` (`@terreno/admin-frontend`).
- The user's own history: the print icon on a `ConsentHistory` entry
  (`@terreno/admin-frontend`).

When the record is provisional, the printout includes a "Provisional signature" section with
the signer and date. Staff and
admin printouts also show the note; the user's own printout never does. To print your own
HTML, call `printConsentHtml({html: buildConsentPdfHtml(data)})` from `@terreno/ui`.

Reference: [ConsentApp](../reference/api.md#consent-forms-consentapp),
[consent components](../reference/ui.md#consent-components),
[consent records and PDFs](../reference/admin-frontend.md#consent-records-and-pdfs).
