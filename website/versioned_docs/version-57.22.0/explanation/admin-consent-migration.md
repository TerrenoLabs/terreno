# Consent admin migration audit

The example keeps specialized consent routes where generic model screens do not cover the workflow.

| Route file | Disposition | Reason |
| --- | --- | --- |
| `consent-forms/index.tsx` | Keep as a hand-written route | Adds consent-specific list navigation and publishing workflow. |
| `consent-forms/create.tsx` | Keep as a hand-written route | Uses `ConsentFormEditor` for localized content, AI generation, and consent validation. |
| `consent-forms/[id].tsx` | Keep as a hand-written route | Supports publish/version behavior beyond generic CRUD editing. |
| `consent-responses/index.tsx` | Keep as a hand-written route | Presents consent-response-specific navigation. |
| `consent-responses/[id].tsx` | Keep as a hand-written route | Uses `ConsentResponseViewer` for signatures, snapshots, and audit details. |

`ConsentApp.adminContribution()` still contributes generic ConsentForm and ConsentResponse models.
Those models provide searchable tables and field widgets, while Expo Router gives the explicit
routes above precedence for the richer consent workflows.
