---
category: Added
---

- **Provisional consent signing.** Staff can record consent on a user's behalf with
  `POST /consent-responses/provisional` and a required note. Pass `accessControl` to
  `ConsentApp` and grant the new `consentResponse:signOnBehalf` RBAC action (the built-in
  `admin` role gets it on the next role seed); without RBAC only `user.admin` may sign. A
  provisional signature counts as consent but leaves the form in the user's consent gate,
  which now shows "Signed on your behalf by <name> on <date>". The user's own answer always
  wins.
- `getConsentStatuses({userId})` (`@terreno/api`) and `GET /consent-responses/status` return
  each form's `pending`, `provisional`, `signed`, or `declined` status. `POST
  /consent-responses/:id/void` voids a provisional signature and keeps the record. With
  `AuditApp`, signing, voiding, and status reads write audit events; audit events gain a
  `read` operation and a `viewed` verb.
- `ProvisionalConsentSigner` and `useProvisionalConsent` (`@terreno/ui`) list a user's forms,
  sign with a note, print, and void. `printConsentHtml` prints consent HTML on native and web,
  and `buildConsentPdfHtml` renders a "Provisional signature" section.
- `ConsentResponseViewer` and `ConsentHistory` (`@terreno/admin-frontend`) show provisional
  signatures and gain Print buttons, and their PDFs include the provisional signature.
