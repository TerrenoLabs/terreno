# Implementation Plan: Consent Forms System

**Status:** Complete
**Closed:** 2026-08-20 — Shipped via `ConsentApp`, `ConsentForm`/`ConsentResponse` models, and `@terreno/ui` consent screens (`ConsentNavigator`, `ConsentFormScreen`, `useConsentForms`).
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1078

*When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team. Once you have finished or you make any changes, tag Josh with the @ symbol so he can review. Also tag anyone else that needs to be notified, has conflicting work, etc.*

## **Models**

### ConsentForm

Admin-managed consent form definitions with i18n support and configurable behavior.

```typescript
const consentFormSchema = new mongoose.Schema({
  title: {required: true, trim: true, type: String},
  slug: {required: true, trim: true, type: String, index: true},
  version: {required: true, type: Number, default: 1},
  order: {required: true, type: Number, default: 0},
  type: {
    required: true,
    type: String,
    enum: ["agreement", "privacy", "hipaa", "research", "terms", "custom"],
  },

  // i18n content: { "en": "# Title\n...", "es": "# Titulo\n..." }
  content: {type: Map, of: String, required: true},
  defaultLocale: {type: String, default: "en"},
  active: {type: Boolean, default: false},

  // Form behavior
  captureSignature: {type: Boolean, default: false},
  requireScrollToBottom: {type: Boolean, default: false},
  checkboxes: [{
    label: {type: String, required: true},
    required: {type: Boolean, default: false},
    confirmationPrompt: {type: String}, // If set, shows "are you sure?" modal with this text
  }],

  // Button config
  agreeButtonText: {type: String, default: "I Agree"},

  // Decline behavior
  allowDecline: {type: Boolean, default: false},
  declineButtonText: {type: String, default: "Decline"},
  required: {type: Boolean, default: true}, // If true + declined, blocks app access
}, {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}});

consentFormSchema.index({slug: 1, version: 1}, {unique: true});
addDefaultPlugins(consentFormSchema); // created, updated, isDeleted
```

### ConsentResponse

User completions with optional audit trail.

```typescript
const consentResponseSchema = new mongoose.Schema({
  userId: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true},
  consentFormId: {type: mongoose.Schema.Types.ObjectId, ref: "ConsentForm", required: true},
  agreed: {type: Boolean, required: true},
  agreedAt: {type: Date, required: true},
  checkboxValues: {type: Map, of: Boolean},
  locale: {type: String, required: true},

  // Signature (optional, per form config)
  signature: {type: String},       // base64 image
  signedAt: {type: Date},

  // Audit trail fields (optional, when auditTrail enabled on ConsentApp)
  ipAddress: {type: String},
  userAgent: {type: String},
  contentSnapshot: {type: String}, // markdown content at time of signing
  formVersionSnapshot: {type: Number},
}, {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}});

consentResponseSchema.index({userId: 1, consentFormId: 1});
addDefaultPlugins(consentResponseSchema);
```

## **APIs**

### ConsentApp Plugin Routes

| Method | Path | Description | Permissions | Notes |
|--------|------|-------------|-------------|-------|
| GET | `/consents/pending` | Get pending consent forms for current user | IsAuthenticated | Runs `resolveConsentForms` callback, checks versions against existing responses, returns ordered forms |
| POST | `/consents/respond` | Submit a consent response | IsAuthenticated | Body: `{consentFormId, agreed, checkboxValues, signature, locale}`. Adds audit trail fields if enabled |
| GET | `/consents/audit/:userId` | Get full signing history for a user | IsAdmin | Returns responses with content snapshots. Only when `auditTrail: true` |

### Standard CRUD via modelRouter (admin)

| Method | Path | Description | Permissions |
|--------|------|-------------|-------------|
| GET | `/consent-forms` | List all consent forms | IsAdmin |
| POST | `/consent-forms` | Create consent form | IsAdmin |
| GET | `/consent-forms/:id` | Get single consent form | IsAdmin |
| PATCH | `/consent-forms/:id` | Update consent form | IsAdmin |
| DELETE | `/consent-forms/:id` | Soft-delete consent form | IsAdmin |
| POST | `/consent-forms/:id/publish` | Publish new version (clones with incremented version, sets active) | IsAdmin |
| GET | `/consent-responses` | List all responses | IsAdmin |
| GET | `/consent-responses/:id` | Get single response | IsAdmin |

### AI Generation Endpoints

| Method | Path | Description | Permissions | Notes |
|--------|------|-------------|-------------|-------|
| POST | `/consent-forms/generate` | Generate consent form markdown from description | IsAdmin | Takes `{type, description, locale}`, returns markdown via Claude API |
| POST | `/consent-forms/translate` | Translate content to another locale | IsAdmin | Takes `{content, fromLocale, toLocale}`, returns translated markdown |

### ConsentApp Configuration

```typescript
new ConsentApp({
  auditTrail: true,                          // Enable audit trail fields
  aiConfig: {apiKey: process.env.CLAUDE_KEY}, // Optional, enables AI endpoints
  resolveConsentForms: (user, forms) => {     // Optional, default: return all
    return forms.filter(f => matchesUserRole(user, f));
  },
  supportedLocales: ["en", "es", "fr"],       // Available locales in admin
})
```

## **Notifications**

No notifications required. Consent forms are checked on every app launch via the `ConsentNavigator` — users are blocked from the app until they complete pending consents.

## **UI**

### New Components in `@terreno/ui`

| Component | Description |
|-----------|-------------|
| `ConsentNavigator` | Inline wrapper. Fetches pending consents on mount. If pending, renders consent flow instead of `children`. |
| `ConsentFormScreen` | Renders a single form: title, scrollable MarkdownView, checkboxes with confirmation modals, signature field, agree/decline buttons. |
| `MarkdownEditor` | Split-pane editor: textarea on left, MarkdownView preview on right. |

### New Components in `@terreno/admin-frontend`

| Component | Description |
|-----------|-------------|
| `ConsentFormEditor` | Custom admin form with locale tabs for content (MarkdownEditor), checkbox list builder, button config, publish version button, AI generate/translate buttons. |
| `ConsentFormList` | List view showing title, type, version, active status, order. |
| `ConsentResponseViewer` | Read-only view of a response with signature display and audit trail. |

### Client App Navigation Flow

```
App Launch
  -> ConsentNavigator checks GET /consents/pending
  -> If no pending forms: render children (normal app)
  -> If pending forms:
    -> Show ConsentFormScreen for forms[0]
      -> User scrolls to bottom (if required)
      -> User checks checkboxes (with confirmation modals as configured)
      -> User signs (if signature required)
      -> User taps "I Agree" -> POST /consents/respond
      -> Advance to forms[1], etc.
    -> All forms completed -> render children
```

### ConsentFormScreen States

- **Loading** — fetching forms, show Spinner
- **Displaying form** — markdown content scrollable, agree button disabled until requirements met (scroll, required checkboxes, signature)
- **Submitting** — agree button shows loading state
- **Error** — toast notification on submit failure, retry

### Admin Flow

```
Admin Model List -> Consent Forms table
  -> Create: ConsentFormEditor with MarkdownEditor, locale tabs, checkbox builder
  -> Edit: Same editor, with "Publish New Version" button in header
  -> AI: "Generate" button calls /consent-forms/generate, populates editor
  -> Translate: Per-locale "Translate from [default]" button
```

### Client Integration (Minimal)

```typescript
import {ConsentNavigator} from "@terreno/ui";

const App = () => (
  <ConsentNavigator api={terrenoApi}>
    <TabNavigator />
  </ConsentNavigator>
);
```

## Phases

| Phase | Contents | Deliverable |
|-------|----------|-------------|
| **Phase 1: Models + API** | ConsentForm and ConsentResponse models, ConsentApp plugin with all routes (CRUD, pending, respond, publish, audit), resolver callback, tests | Backend fully functional |
| **Phase 2: Admin UI** | ConsentFormEditor, ConsentFormList, ConsentResponseViewer, MarkdownEditor in ui, locale tabs, checkbox builder, publish version button | Admins can manage consent forms |
| **Phase 3: ConsentNavigator** | ConsentNavigator and ConsentFormScreen in ui, scroll tracking, signature capture, checkbox confirmation modals, useConsentForms hook | Client apps can use consent flow |
| **Phase 4: AI Generation** | Backend generate/translate endpoints, admin generate/translate buttons, aiConfig option | AI-powered content creation |
| **Phase 5: Example App + Docs** | Integrate into example-backend/frontend, update SDK | Working end-to-end example |

Phases 2 and 3 can run in parallel after Phase 1 lands.

## Feature Flags & Migrations

**Feature flags:** None. The system is opt-in — apps register `ConsentApp` and wrap UI with `ConsentNavigator`.

**Migrations:** None. New models with new collections. No changes to existing schemas.

**Rollout:** Ship each phase as it lands.

## Activity Log & User Updates

No activity logging for v1. The ConsentResponse model serves as the audit trail. The admin audit endpoint (`GET /consents/audit/:userId`) provides signing history.

## **Not included/Future work**

- Conditional logic within forms (branching based on answers)
- PDF export of signed consents with audit trail
- Consent form analytics/dashboards (completion rates, decline rates)
- Offline consent completion
- Consent expiration / annual renewal
- Bulk-invalidate responses when a form is updated
- Email notifications for pending consents
- Pre-built consent form templates library

---

## Task List (Bot Consumption)

*Structured task breakdown for automated implementation. Each task should be independently implementable and testable.*

### Phase 1: Models + API

- [ ] **Task 1.1**: ConsentForm Mongoose model
  - Description: Create ConsentForm schema with all fields (title, slug, version, order, type, content map, locale, active, captureSignature, requireScrollToBottom, checkboxes, buttons, decline config). Add indexes, plugins, and TypeScript types.
  - Files: `api/src/models/consentForm.ts`, `api/src/types/consentForm.ts`
  - Depends on: none
  - Acceptance: Model can be imported, schema validates correctly, indexes created

- [ ] **Task 1.2**: ConsentResponse Mongoose model
  - Description: Create ConsentResponse schema with all fields (userId, consentFormId, agreed, agreedAt, checkboxValues, locale, signature, signedAt, audit trail fields). Add indexes, plugins, and TypeScript types.
  - Files: `api/src/models/consentResponse.ts`, `api/src/types/consentResponse.ts`
  - Depends on: none
  - Acceptance: Model can be imported, schema validates correctly, indexes created

- [ ] **Task 1.3**: ConsentApp plugin skeleton
  - Description: Create ConsentApp class implementing TerrenoPlugin. Accept config options (auditTrail, aiConfig, resolveConsentForms, supportedLocales). Register method mounts routes.
  - Files: `api/src/consentApp.ts`, `api/src/types/consentApp.ts`
  - Depends on: 1.1, 1.2
  - Acceptance: Plugin can be registered with TerrenoApp, config validated

- [ ] **Task 1.4**: ConsentForm CRUD routes via modelRouter
  - Description: Register ConsentForm modelRouter at `/consent-forms` with IsAdmin permissions, query fields, sorting by order. Include validation.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: CRUD endpoints work, OpenAPI spec generated, admin-only access enforced

- [ ] **Task 1.5**: ConsentResponse read routes via modelRouter
  - Description: Register ConsentResponse modelRouter at `/consent-responses` with IsAdmin permissions (read-only — no create/update/delete via admin).
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Admin can list and read responses

- [ ] **Task 1.6**: GET /consents/pending endpoint
  - Description: Custom route that fetches active consent forms, runs resolveConsentForms callback, checks user's existing responses against form versions, returns ordered pending forms.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Returns only forms user hasn't completed at current version, respects resolver callback, ordered by `order` field

- [ ] **Task 1.7**: POST /consents/respond endpoint
  - Description: Custom route that creates a ConsentResponse. Validates consentFormId exists and is active. If auditTrail enabled, captures IP, user agent, content snapshot, form version.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Creates response, validates required checkboxes, stores audit data when enabled

- [ ] **Task 1.8**: POST /consent-forms/:id/publish endpoint
  - Description: Custom route that clones a consent form with incremented version number and sets it as active. Deactivates previous version of same slug.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.4
  - Acceptance: New version created, old version deactivated, version number incremented

- [ ] **Task 1.9**: GET /consents/audit/:userId endpoint
  - Description: Admin-only endpoint returning full consent response history for a user with populated form data. Only available when auditTrail is enabled.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.7
  - Acceptance: Returns responses with content snapshots, 404 when auditTrail disabled

- [ ] **Task 1.10**: Export ConsentApp from @terreno/api
  - Description: Export ConsentApp, models, and types from api package index. Update package.json exports if needed.
  - Files: `api/src/index.ts`
  - Depends on: 1.3
  - Acceptance: `import {ConsentApp} from "@terreno/api"` works

- [ ] **Task 1.11**: ConsentApp unit tests
  - Description: Test all endpoints: CRUD, pending logic (version checking, resolver callback), respond (validation, audit trail), publish (version increment), audit endpoint.
  - Files: `api/src/consentApp.test.ts`
  - Depends on: 1.6, 1.7, 1.8, 1.9
  - Acceptance: All tests pass, covers happy paths and edge cases

### Phase 2: Admin UI

- [ ] **Task 2.1**: MarkdownEditor component in ui
  - Description: Split-pane component with textarea on left and MarkdownView preview on right. Props: value, onChange, placeholder, locale label. Responsive — stacks vertically on mobile.
  - Files: `ui/src/MarkdownEditor.tsx`, `ui/src/MarkdownEditor.test.tsx`, `ui/src/index.tsx`
  - Depends on: none
  - Acceptance: Component renders, textarea edits update preview in real-time, exported from ui

- [ ] **Task 2.2**: ConsentFormEditor component in admin-frontend
  - Description: Custom form for creating/editing consent forms. Includes: basic fields (title, slug, type, order), locale tabs with MarkdownEditor per locale, checkbox list builder (add/remove/reorder with label, required, confirmationPrompt), button config (agreeText, allowDecline, declineButtonText, required), captureSignature and requireScrollToBottom toggles. "Publish New Version" button in edit mode.
  - Files: `admin-frontend/src/ConsentFormEditor.tsx`
  - Depends on: 2.1
  - Acceptance: Can create and edit consent forms with all fields, locale tabs work

- [ ] **Task 2.3**: ConsentFormList component in admin-frontend
  - Description: Table view for consent forms showing title, type, version, active status, order. Links to editor. Create button.
  - Files: `admin-frontend/src/ConsentFormList.tsx`
  - Depends on: none
  - Acceptance: Lists forms with correct columns, navigation to editor works

- [ ] **Task 2.4**: ConsentResponseViewer component in admin-frontend
  - Description: Read-only detail view for a consent response. Shows form title, user, agreed status, timestamp, checkbox values, rendered signature image, audit trail fields if present.
  - Files: `admin-frontend/src/ConsentResponseViewer.tsx`
  - Depends on: none
  - Acceptance: Displays all response fields including signature and audit data

- [ ] **Task 2.5**: Export admin consent components
  - Description: Export ConsentFormEditor, ConsentFormList, ConsentResponseViewer from admin-frontend index.
  - Files: `admin-frontend/src/index.tsx`
  - Depends on: 2.2, 2.3, 2.4
  - Acceptance: Components importable from `@terreno/admin-frontend`

### Phase 3: ConsentNavigator

- [ ] **Task 3.1**: useConsentForms hook
  - Description: Hook that injects a `getPendingConsents` query endpoint into the provided RTK API, fetches on mount, returns `{forms, isLoading, error, refetch}`. Handles locale detection from device.
  - Files: `ui/src/useConsentForms.ts`
  - Depends on: Phase 1
  - Acceptance: Hook fetches pending forms, handles loading/error states, detects device locale

- [ ] **Task 3.2**: useSubmitConsent hook
  - Description: Hook that injects a `submitConsentResponse` mutation endpoint. Returns `{submit, isSubmitting, error}`. Accepts `{consentFormId, agreed, checkboxValues, signature, locale}`.
  - Files: `ui/src/useSubmitConsent.ts`
  - Depends on: Phase 1
  - Acceptance: Hook submits response, invalidates pending forms cache on success

- [ ] **Task 3.3**: ConsentFormScreen component
  - Description: Renders a single consent form. Scrollable MarkdownView with scroll-to-bottom tracking. Checkbox list with confirmation modal support. SignatureField when captureSignature is true. Agree button (disabled until requirements met). Optional decline button. Locale-aware content selection.
  - Files: `ui/src/ConsentFormScreen.tsx`
  - Depends on: 3.2
  - Acceptance: All form types render correctly, requirements gate the agree button, confirmation modals work

- [ ] **Task 3.4**: ConsentNavigator component
  - Description: Inline wrapper component. Takes `api` and `children` props. On mount, fetches pending forms via useConsentForms. If pending, renders ConsentFormScreen sequentially. On each completion, advances to next form. When all done, renders children. Manages current form index state internally.
  - Files: `ui/src/ConsentNavigator.tsx`
  - Depends on: 3.1, 3.3
  - Acceptance: Blocks children when consents pending, shows forms in order, renders children when complete

- [ ] **Task 3.5**: Export consent components from ui
  - Description: Export ConsentNavigator, ConsentFormScreen, useConsentForms, useSubmitConsent from ui index.
  - Files: `ui/src/index.tsx`
  - Depends on: 3.4
  - Acceptance: All components importable from `@terreno/ui`

- [ ] **Task 3.6**: ConsentNavigator tests
  - Description: Test ConsentNavigator rendering: no pending forms shows children, pending forms shows consent flow, completing all forms shows children, decline on optional form skips it, decline on required form blocks.
  - Files: `ui/src/ConsentNavigator.test.tsx`
  - Depends on: 3.4
  - Acceptance: All test cases pass

### Phase 4: AI Generation

- [ ] **Task 4.1**: POST /consent-forms/generate endpoint
  - Description: Backend endpoint that calls Claude API to generate consent form markdown. Accepts `{type, description, locale}`. Returns `{content: string}`. Only available when aiConfig is provided.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Generates reasonable consent markdown, returns 404 when aiConfig not set

- [ ] **Task 4.2**: POST /consent-forms/translate endpoint
  - Description: Backend endpoint that calls Claude API to translate consent markdown. Accepts `{content, fromLocale, toLocale}`. Returns `{content: string}`.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Translates content preserving markdown formatting

- [ ] **Task 4.3**: AI generate button in ConsentFormEditor
  - Description: Add "Generate" button to editor that opens a modal with type and description inputs, calls generate endpoint, populates the MarkdownEditor for current locale.
  - Files: `admin-frontend/src/ConsentFormEditor.tsx`
  - Depends on: 2.2, 4.1
  - Acceptance: Generate button visible, modal works, generated content populates editor

- [ ] **Task 4.4**: Translate button in ConsentFormEditor
  - Description: Add per-locale "Translate from [default locale]" button that calls translate endpoint and populates the MarkdownEditor for that locale.
  - Files: `admin-frontend/src/ConsentFormEditor.tsx`
  - Depends on: 2.2, 4.2
  - Acceptance: Translate button visible per non-default locale tab, translated content populates editor

### Phase 5: Example App + Docs

- [ ] **Task 5.1**: Integrate ConsentApp into example-backend
  - Description: Register ConsentApp plugin in example-backend server. Add configuration with resolveConsentForms callback and supportedLocales.
  - Files: `example-backend/src/server.ts`
  - Depends on: Phase 1
  - Acceptance: Backend serves consent endpoints, shows in OpenAPI spec

- [ ] **Task 5.2**: Integrate ConsentNavigator into example-frontend
  - Description: Wrap main app content with ConsentNavigator. Update SDK to include consent endpoints.
  - Files: `example-frontend/app/_layout.tsx`, `example-frontend/store/sdk.ts`
  - Depends on: Phase 3, 5.1
  - Acceptance: Consent flow blocks app when forms are pending, passes through when none

- [ ] **Task 5.3**: Add consent admin screens to example-frontend
  - Description: Add admin routes for consent form management and response viewing using admin-frontend components.
  - Files: `example-frontend/app/admin/consent-forms/` (index, create, [id]), `example-frontend/app/admin/consent-responses/` (index, [id])
  - Depends on: Phase 2, 5.1
  - Acceptance: Admin can create/edit/publish consent forms and view responses

- [ ] **Task 5.4**: Seed example consent forms
  - Description: Add a seed script or initial data that creates sample consent forms (terms of service, privacy policy) for the example app.
  - Files: `example-backend/src/seed.ts` or similar
  - Depends on: 5.1
  - Acceptance: Example app has working consent forms out of the box
