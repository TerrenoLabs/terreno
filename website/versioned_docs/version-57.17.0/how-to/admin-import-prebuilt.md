# Import pre-built admins

Register first-party plugins on the same `TerrenoApp` as `AdminApp`:

```ts
import {JobsApp} from "@terreno/jobs";

const app = new TerrenoApp({userModel: User})
  .register(new FeatureFlagsApp())
  .register(new ConsentApp({auditTrail: true}))
  .register(new DocumentStorageApp({bucketName: process.env.GCS_BUCKET ?? ""}))
  .register(new AIAdminApp())
  .register(new JobsApp({accessControl})) // optional — needs admin:access + admin:jobs
  .register(new AdminApp({home: {slots: {main: ["modelStats", "jobs"]}}}));
```

`AdminApp` aggregates each plugin's `adminContribution()`:

- `FeatureFlagsApp`: FeatureFlag model and `feature-flags-overrides` home widget.
- `ConsentApp`: ConsentForm and ConsentResponse models plus consent field-widget IDs.
- `DocumentStorageApp`: `documents` custom screen. Pass `fileUploadsEnabled: false` (or a function that returns `false`) to reject uploads while listing and download stay available. The example app wires this to the `file-uploads` feature flag.
- `AIAdminApp`: `ai-requests` custom screen and explorer API.
- `JobsApp`: `jobs` custom screen and home widget (`dead` / `running` counts). With
  `accessControl`, requires **both** `admin:access` and `admin:jobs`; without it, legacy
  `user.admin`. See [Durable background jobs](background-jobs.md).

Wrap frontend admin routes in `AdminProvider`. First-party widgets are already in the built-in
registry, so no consumer-side switch statement or custom-screen map is required.

`featureFlagAdminConfig` and `AdminApp.models` remain compatibility paths, but new integrations
should use plugin contributions and `modelRouter({admin: ...})`.
