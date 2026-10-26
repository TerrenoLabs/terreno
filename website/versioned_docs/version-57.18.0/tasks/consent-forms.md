# Task List: Consent Forms System

**Status:** Closed (2026-08-20) — IP complete. Shipped in `@terreno/api` (`ConsentApp`) and `@terreno/ui`. Open tasks below were not executed.

*Structured task breakdown for automated implementation. Each task should be independently implementable and testable.*

## Phase 1: Models + API

- [ ] **Task 1.1**: ConsentForm Mongoose model
  - Description: Create ConsentForm schema with all fields (title, slug, version, order, type, content map, defaultLocale, active, captureSignature, requireScrollToBottom, checkboxes with confirmationPrompt, agreeButtonText, allowDecline, declineButtonText, required). Add compound index on {slug, version}, plugins (createdUpdated, isDeleted), and TypeScript types. Every field must have a `description` property.
  - Files: `api/src/models/consentForm.ts`, `api/src/types/consentForm.ts`
  - Depends on: none
  - Acceptance: Model can be imported, schema validates correctly, indexes created

- [ ] **Task 1.2**: ConsentResponse Mongoose model
  - Description: Create ConsentResponse schema with all fields (userId, consentFormId, agreed, agreedAt, checkboxValues map, locale, signature, signedAt, ipAddress, userAgent, contentSnapshot, formVersionSnapshot). Add index on {userId, consentFormId}, plugins, and TypeScript types. Every field must have a `description` property.
  - Files: `api/src/models/consentResponse.ts`, `api/src/types/consentResponse.ts`
  - Depends on: none
  - Acceptance: Model can be imported, schema validates correctly, indexes created

- [ ] **Task 1.3**: ConsentApp plugin skeleton
  - Description: Create ConsentApp class implementing TerrenoPlugin. Accept config options (auditTrail, aiConfig, resolveConsentForms callback, supportedLocales). Register method mounts all consent routes on the Express app.
  - Files: `api/src/consentApp.ts`, `api/src/types/consentApp.ts`
  - Depends on: 1.1, 1.2
  - Acceptance: Plugin can be registered with TerrenoApp, config validated

- [ ] **Task 1.4**: ConsentForm CRUD routes via modelRouter
  - Description: Register ConsentForm modelRouter at `/consent-forms` with IsAdmin permissions for all operations, queryFields (slug, type, active, version), sorting by order. Include validation.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: CRUD endpoints work, OpenAPI spec generated, admin-only access enforced

- [ ] **Task 1.5**: ConsentResponse read routes via modelRouter
  - Description: Register ConsentResponse modelRouter at `/consent-responses` with IsAdmin permissions. Disable create/update/delete (empty arrays). Enable list and read with populatePaths for consentFormId.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Admin can list and read responses, create/update/delete blocked

- [ ] **Task 1.6**: GET /consents/pending endpoint
  - Description: Custom route that: (1) fetches all active consent forms with highest version per slug, (2) runs resolveConsentForms callback to filter by user, (3) fetches user's existing ConsentResponses, (4) filters to forms where user hasn't responded to current version, (5) returns ordered by `order` field. Include OpenAPI docs via createOpenApiBuilder.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Returns only pending forms for authenticated user, respects resolver callback, ordered correctly, handles no-pending case

- [ ] **Task 1.7**: POST /consents/respond endpoint
  - Description: Custom route that creates a ConsentResponse. Validates: consentFormId exists and is active, required checkboxes are all true, signature provided if captureSignature is true. If auditTrail enabled, captures req IP, user agent, form content snapshot for the user's locale, and form version. Include OpenAPI docs.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Creates response with all validations, stores audit data when enabled, returns 400 on validation failures

- [ ] **Task 1.8**: POST /consent-forms/:id/publish endpoint
  - Description: Custom admin-only route that: (1) reads the consent form by id, (2) creates a new document with same fields but incremented version, (3) sets new document as active, (4) deactivates previous active version of same slug. Include OpenAPI docs.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.4
  - Acceptance: New version created with incremented version, old version deactivated, returns new document

- [ ] **Task 1.9**: GET /consents/audit/:userId endpoint
  - Description: Admin-only endpoint that returns all ConsentResponses for a userId, populated with ConsentForm data, sorted by agreedAt descending. Only registers the route when auditTrail option is true. Include OpenAPI docs.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.7
  - Acceptance: Returns full history with populated forms, 404 when auditTrail not enabled, admin-only

- [ ] **Task 1.10**: Export ConsentApp from @terreno/api
  - Description: Export ConsentApp class, ConsentForm model, ConsentResponse model, and all related types from api package index.ts.
  - Files: `api/src/index.ts`
  - Depends on: 1.3
  - Acceptance: `import {ConsentApp, ConsentForm, ConsentResponse} from "@terreno/api"` works

- [ ] **Task 1.11**: ConsentApp unit tests
  - Description: Test all endpoints: CRUD operations on consent forms, pending logic (version checking, resolver callback filtering, ordering), respond (validation of required checkboxes, signature, audit trail data), publish (version increment, deactivation of old), audit endpoint (populated responses, disabled when auditTrail false). Use supertest and bun test.
  - Files: `api/src/consentApp.test.ts`
  - Depends on: 1.6, 1.7, 1.8, 1.9
  - Acceptance: All tests pass, covers happy paths and edge cases (no pending forms, expired versions, missing required fields)

## Phase 2: Admin UI

- [ ] **Task 2.1**: MarkdownEditor component in ui
  - Description: Split-pane component with textarea on left and MarkdownView preview on right. Props: value, onChange, placeholder, title, disabled, testID. Responsive — stacks vertically on mobile using mediaQueryLargerThan. Uses Box for layout, TextField (multiline) for editing, MarkdownView for preview.
  - Files: `ui/src/MarkdownEditor.tsx`, `ui/src/MarkdownEditor.test.tsx`, `ui/src/index.tsx`
  - Depends on: none
  - Acceptance: Component renders, textarea edits update preview in real-time, responsive layout works, exported from @terreno/ui

- [ ] **Task 2.2**: ConsentFormEditor component in admin-frontend
  - Description: Custom form for creating/editing consent forms. Sections: (1) Basic fields — title (TextField), slug (TextField), type (SelectField with enum options), order (NumberField), required (BooleanField), active (BooleanField). (2) Form behavior — captureSignature (BooleanField), requireScrollToBottom (BooleanField). (3) Button config — agreeButtonText (TextField), allowDecline (BooleanField), declineButtonText (TextField, shown when allowDecline true). (4) Locale tabs — tab per supportedLocale, each with MarkdownEditor for content. (5) Checkbox list builder — add/remove rows with label (TextField), required (BooleanField), confirmationPrompt (TextField, optional). (6) "Publish New Version" button in edit mode header. Uses useAdminApi for CRUD operations.
  - Files: `admin-frontend/src/ConsentFormEditor.tsx`
  - Depends on: 2.1
  - Acceptance: Can create and edit consent forms with all fields, locale tabs switch content, checkbox builder works, publish button creates new version

- [ ] **Task 2.3**: ConsentFormList component in admin-frontend
  - Description: Table view for consent forms using DataTable. Columns: title, type, version, active (boolean), order, created. Row click navigates to editor. Create button in header. Uses useAdminApi for list query.
  - Files: `admin-frontend/src/ConsentFormList.tsx`
  - Depends on: none
  - Acceptance: Lists forms with correct columns, pagination works, navigation to editor works, create button works

- [ ] **Task 2.4**: ConsentResponseViewer component in admin-frontend
  - Description: Read-only detail view for a consent response using Page layout. Shows: form title (populated from consentFormId), userId, agreed status (Badge), agreedAt (formatted with Luxon), locale, checkbox values (list of label + checked/unchecked), signature (rendered as Image from base64 if present), audit trail section (ipAddress, userAgent, contentSnapshot rendered via MarkdownView, formVersionSnapshot) — only shown if audit fields are populated.
  - Files: `admin-frontend/src/ConsentResponseViewer.tsx`
  - Depends on: none
  - Acceptance: Displays all response fields, signature renders correctly, audit section conditional

- [ ] **Task 2.5**: Export admin consent components
  - Description: Export ConsentFormEditor, ConsentFormList, ConsentResponseViewer from admin-frontend index.tsx.
  - Files: `admin-frontend/src/index.tsx`
  - Depends on: 2.2, 2.3, 2.4
  - Acceptance: All three components importable from `@terreno/admin-frontend`

## Phase 3: ConsentNavigator

- [ ] **Task 3.1**: useConsentForms hook
  - Description: Hook that accepts an RTK API instance and injects a `getPendingConsents` query endpoint targeting GET /consents/pending. Fetches on mount. Detects device locale via expo-localization or navigator.language. Returns `{forms, isLoading, error, refetch}`. Uses the dynamic endpoint injection pattern from useAdminApi.
  - Files: `ui/src/useConsentForms.ts`
  - Depends on: Phase 1
  - Acceptance: Hook fetches pending forms, handles loading/error states, detects device locale, cache tagged for invalidation

- [ ] **Task 3.2**: useSubmitConsent hook
  - Description: Hook that accepts an RTK API instance and injects a `submitConsentResponse` mutation endpoint targeting POST /consents/respond. Returns `{submit, isSubmitting, error}`. On success, invalidates the pending consents cache tag. Accepts `{consentFormId, agreed, checkboxValues, signature, locale}`.
  - Files: `ui/src/useSubmitConsent.ts`
  - Depends on: Phase 1
  - Acceptance: Hook submits response, invalidates pending forms cache on success, returns error on failure

- [ ] **Task 3.3**: ConsentFormScreen component
  - Description: Full-screen component rendering a single consent form. Layout: (1) Page with title from form.title, no back button. (2) Scrollable MarkdownView with content from form.content[locale] (fallback to form.defaultLocale). (3) Scroll-to-bottom tracking — when requireScrollToBottom is true, track scroll position and enable agree button only when scrolled to bottom. (4) Checkboxes section — render each form.checkboxes item as CheckBox. When checkbox has confirmationPrompt, show Modal with that text on toggle, require confirm before changing. (5) SignatureField when captureSignature is true. (6) Footer with agree Button (disabled until all requirements met: scroll, required checkboxes, signature). Optional decline Button when allowDecline is true. Props: form, locale, onAgree, onDecline, isSubmitting.
  - Files: `ui/src/ConsentFormScreen.tsx`
  - Depends on: 3.2
  - Acceptance: All form configurations render correctly, requirements gate the agree button, confirmation modals work, decline button appears conditionally

- [ ] **Task 3.4**: ConsentNavigator component
  - Description: Inline wrapper component. Props: api (RTK API instance), children, onError (optional callback). On mount, calls useConsentForms to fetch pending forms. States: (1) Loading — show Spinner centered. (2) Pending forms — render ConsentFormScreen for forms[currentIndex]. On agree, call useSubmitConsent then advance currentIndex. On decline (optional forms only), advance currentIndex. When all forms completed, refetch pending to confirm empty, then render children. (3) No pending forms — render children immediately. (4) Error — show ErrorPage with retry, call onError if provided.
  - Files: `ui/src/ConsentNavigator.tsx`
  - Depends on: 3.1, 3.3
  - Acceptance: Blocks children when consents pending, shows forms in order, renders children when complete, handles errors gracefully

- [ ] **Task 3.5**: Export consent components from ui
  - Description: Export ConsentNavigator, ConsentFormScreen, useConsentForms, useSubmitConsent from ui/src/index.tsx.
  - Files: `ui/src/index.tsx`
  - Depends on: 3.4
  - Acceptance: All components importable from `@terreno/ui`

- [ ] **Task 3.6**: ConsentNavigator tests
  - Description: Test cases: (1) No pending forms — children render immediately. (2) Pending forms — shows ConsentFormScreen, not children. (3) Completing all forms — children render after last form agreed. (4) Decline on optional form (required: false) — skips to next form. (5) Loading state — shows spinner. (6) Error state — shows error page. Use renderWithTheme and mock API responses.
  - Files: `ui/src/ConsentNavigator.test.tsx`
  - Depends on: 3.4
  - Acceptance: All test cases pass

## Phase 4: AI Generation

- [ ] **Task 4.1**: POST /consent-forms/generate endpoint
  - Description: Backend endpoint that uses @terreno/ai's AIService (or direct Claude API call if AIService doesn't fit) to generate consent form markdown. Accepts `{type, description, locale}`. System prompt instructs AI to generate a legally-appropriate consent form in markdown format for the given type. Only registered when aiConfig is provided in ConsentApp options. Returns `{data: {content: string}}`. Include OpenAPI docs.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Generates reasonable consent markdown, returns 404 when aiConfig not set, admin-only

- [ ] **Task 4.2**: POST /consent-forms/translate endpoint
  - Description: Backend endpoint that uses AI to translate consent markdown from one locale to another. Accepts `{content, fromLocale, toLocale}`. System prompt instructs AI to translate preserving all markdown formatting, legal terminology accuracy, and document structure. Only registered when aiConfig is provided. Returns `{data: {content: string}}`. Include OpenAPI docs.
  - Files: `api/src/consentApp.ts`
  - Depends on: 1.3
  - Acceptance: Translates content preserving markdown formatting, admin-only, 404 when aiConfig not set

- [ ] **Task 4.3**: AI generate button in ConsentFormEditor
  - Description: Add "Generate with AI" Button to the editor that opens a Modal with: type SelectField (pre-filled from form type), description TextField (multiline, placeholder "Describe the consent form you need..."), locale display (current tab's locale). On submit, calls POST /consent-forms/generate via injected RTK mutation, populates the MarkdownEditor for current locale with response. Shows loading state on button. Only visible when the backend supports AI (check for endpoint availability or pass as prop).
  - Files: `admin-frontend/src/ConsentFormEditor.tsx`
  - Depends on: 2.2, 4.1
  - Acceptance: Generate button visible, modal works, generated content populates editor, loading state shown

- [ ] **Task 4.4**: Translate button in ConsentFormEditor
  - Description: Add "Translate from [defaultLocale]" Button on each non-default locale tab. On click, calls POST /consent-forms/translate with the default locale's content and target locale. Populates the MarkdownEditor for that locale tab with the translated content. Shows loading state. Confirms overwrite if content already exists in that locale.
  - Files: `admin-frontend/src/ConsentFormEditor.tsx`
  - Depends on: 2.2, 4.2
  - Acceptance: Translate button visible per non-default locale tab, translated content populates editor, overwrite confirmation works

## Phase 5: Example App + Docs

- [ ] **Task 5.1**: Integrate ConsentApp into example-backend
  - Description: Register ConsentApp plugin in example-backend/src/server.ts. Configure with auditTrail: true, supportedLocales: ["en", "es"], and a simple resolveConsentForms that returns all forms. Add CLAUDE_API_KEY to .env.example for AI features. Register ConsentForm and ConsentResponse in AdminApp models array.
  - Files: `example-backend/src/server.ts`
  - Depends on: Phase 1
  - Acceptance: Backend serves all consent endpoints, shows in OpenAPI spec, admin can manage forms

- [ ] **Task 5.2**: Integrate ConsentNavigator into example-frontend
  - Description: Wrap the authenticated app content (inside tabs layout or root layout after auth check) with ConsentNavigator component, passing the terrenoApi instance. Regenerate SDK with `bun run sdk` to include consent endpoints.
  - Files: `example-frontend/app/_layout.tsx` or `example-frontend/app/(tabs)/_layout.tsx`, `example-frontend/store/sdk.ts`
  - Depends on: Phase 3, 5.1
  - Acceptance: Consent flow blocks app when forms are pending, passes through when none, SDK includes consent types

- [ ] **Task 5.3**: Add consent admin screens to example-frontend
  - Description: Add admin routes using Expo Router file-based routing: (1) `app/admin/consent-forms/index.tsx` — ConsentFormList, (2) `app/admin/consent-forms/create.tsx` — ConsentFormEditor mode="create", (3) `app/admin/consent-forms/[id].tsx` — ConsentFormEditor mode="edit", (4) `app/admin/consent-responses/index.tsx` — AdminModelTable for responses, (5) `app/admin/consent-responses/[id].tsx` — ConsentResponseViewer.
  - Files: `example-frontend/app/admin/consent-forms/index.tsx`, `example-frontend/app/admin/consent-forms/create.tsx`, `example-frontend/app/admin/consent-forms/[id].tsx`, `example-frontend/app/admin/consent-responses/index.tsx`, `example-frontend/app/admin/consent-responses/[id].tsx`
  - Depends on: Phase 2, 5.1
  - Acceptance: Admin can create/edit/publish consent forms, view responses, full CRUD flow works

- [ ] **Task 5.4**: Seed example consent forms
  - Description: Add a seed script that creates two sample consent forms: (1) Terms of Service (type: "agreement", required: true, requireScrollToBottom: true, captureSignature: true, order: 1), (2) Privacy Policy (type: "privacy", required: true, requireScrollToBottom: true, order: 2). Both with English content and active: true. Script should be idempotent (check if forms exist before creating).
  - Files: `example-backend/src/seed.ts` or `example-backend/src/scripts/seedConsents.ts`
  - Depends on: 5.1
  - Acceptance: Running seed creates sample forms, re-running doesn't duplicate, example app shows consent flow
