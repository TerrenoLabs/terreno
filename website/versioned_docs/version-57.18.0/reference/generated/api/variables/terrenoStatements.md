> `const` **terrenoStatements**: `object`

## Type Declaration

### admin

> `readonly` **admin**: readonly \[`"access"`, `"jobs"`, `"runScripts"`, `"viewBackgroundTasks"`\]

### adminAnnouncement

> `readonly` **adminAnnouncement**: readonly \[`"read"`, `"write"`, `"writeOwned"`\] = `ADMIN_MODEL_ACCESS`

### adminAnnouncementAcknowledgement

> `readonly` **adminAnnouncementAcknowledgement**: readonly \[`"read"`, `"write"`, `"writeOwned"`\] = `ADMIN_MODEL_ACCESS`

### adminAnnouncementClickEvent

> `readonly` **adminAnnouncementClickEvent**: readonly \[`"read"`, `"write"`, `"writeOwned"`\] = `ADMIN_MODEL_ACCESS`

### adminAnnouncementImpression

> `readonly` **adminAnnouncementImpression**: readonly \[`"read"`, `"write"`, `"writeOwned"`\] = `ADMIN_MODEL_ACCESS`

### adminConsentForm

> `readonly` **adminConsentForm**: readonly \[`"read"`, `"write"`, `"writeOwned"`\] = `ADMIN_MODEL_ACCESS`

### adminConsentResponse

> `readonly` **adminConsentResponse**: readonly \[`"read"`, `"write"`, `"writeOwned"`\] = `ADMIN_MODEL_ACCESS`

### adminFeatureFlag

> `readonly` **adminFeatureFlag**: readonly \[`"read"`, `"write"`, `"writeOwned"`\] = `ADMIN_MODEL_ACCESS`

### aiDataset

> `readonly` **aiDataset**: readonly \[`"create"`, `"list"`, `"read"`, `"update"`, `"delete"`\] = `MODEL_CRUD`

### aiEvaluator

> `readonly` **aiEvaluator**: readonly \[`"create"`, `"list"`, `"read"`, `"update"`, `"delete"`\] = `MODEL_CRUD`

### aiExperiment

> `readonly` **aiExperiment**: readonly \[`"list"`, `"read"`, `"create"`, `"promote"`\] = `AI_EXPERIMENT_ACTIONS`

### aiPrompt

> `readonly` **aiPrompt**: readonly \[`"list"`, `"read"`, `"create"`, `"update"`, `"promote"`, `"playground"`\] = `AI_PROMPT_ACTIONS`

### aiReview

> `readonly` **aiReview**: readonly \[`"list"`, `"read"`, `"score"`, `"assign"`\] = `AI_REVIEW_ACTIONS`

### aiTrace

> `readonly` **aiTrace**: readonly \[`"list"`, `"read"`\] = `AI_TRACE_ACTIONS`

### announcement

> `readonly` **announcement**: readonly \[`"create"`, `"list"`, `"read"`, `"update"`, `"delete"`\] = `MODEL_CRUD`

### announcementAcknowledgement

> `readonly` **announcementAcknowledgement**: readonly \[`"list"`, `"read"`\]

### announcementImpression

> `readonly` **announcementImpression**: readonly \[`"list"`, `"read"`\]

### configuration

> `readonly` **configuration**: readonly \[`"read"`, `"update"`\]

### consentForm

> `readonly` **consentForm**: readonly \[`"create"`, `"list"`, `"read"`, `"update"`, `"delete"`\] = `MODEL_CRUD`

### consentResponse

> `readonly` **consentResponse**: readonly \[`"list"`, `"read"`\]

### featureFlag

> `readonly` **featureFlag**: readonly \[`"create"`, `"list"`, `"read"`, `"update"`, `"delete"`\] = `MODEL_CRUD`

### organization

> `readonly` **organization**: readonly \[`"create"`, `"list"`, `"read"`, `"update"`, `"delete"`, `"manageMembers"`, `"disable"`\] = `ORGANIZATION_ACTIONS`

### rbac

> `readonly` **rbac**: readonly \[`"read"`, `"manageRoles"`, `"assignRoles"`\]

### user

> `readonly` **user**: readonly \[`"create"`, `"list"`, `"read"`, `"update"`, `"delete"`, `"impersonate"`, `"setPassword"`, `"updateIdentity"`\]
