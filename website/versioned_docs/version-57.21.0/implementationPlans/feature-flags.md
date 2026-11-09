# Implementation Plan: Feature Flags & A/B Testing

**Status:** Deferred
**Closed:** 2026-08-20 — Superseded by [feature-flags-openfeature.md](./feature-flags-openfeature.md) (OpenFeature provider, live updates). This document is retained for historical context only.
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1098

> **OpenFeature migration:** For the OpenFeature-based provider, `/flagConfiguration`, live updates, and RTK hook details, see [feature-flags-openfeature.md](./feature-flags-openfeature.md) and the task list [feature-flags-openfeature.md](../tasks/feature-flags-openfeature.md).

*When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team. Once you have finished or you make any changes, tag Josh with the @ symbol so he can review. Also tag anyone else that needs to be notified, has conflicting work, etc.*

## **Models**

### FeatureFlag

Admin-managed feature flag definitions with targeting rules and A/B test variant configuration.

```typescript
const featureFlagSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    description: "Unique identifier for the flag, e.g., 'new-checkout-flow'",
  },
  name: {
    type: String,
    required: true,
    description: "Human-readable display name",
  },
  description: {
    type: String,
    default: "",
    description: "Explanation of what this flag controls",
  },
  enabled: {
    type: Boolean,
    default: false,
    description: "Global kill switch — if false, flag is off for everyone",
  },
  type: {
    type: String,
    enum: ["boolean", "variant"],
    default: "boolean",
    description: "Boolean toggle or multi-variant A/B test",
  },
  variants: [{
    key: {
      type: String,
      required: true,
      description: "Variant identifier, e.g., 'control', 'variant-a'",
    },
    weight: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      description: "Percentage weight for assignment (0-100, all must sum to 100)",
    },
  }],
  rules: [{
    field: {
      type: String,
      description: "User field to match against. Supports dot notation for nested fields, e.g., 'email', 'admin', 'address.zip'",
    },
    operator: {
      type: String,
      enum: ["eq", "neq", "in", "nin", "gt", "lt", "contains"],
      description: "Comparison operator for field-based rules",
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      description: "Value to compare against (string, number, boolean, or array for in/nin)",
    },
    segment: {
      type: String,
      description: "Name of a registered segment function, e.g., 'pro-users'",
    },
    enabled: {
      type: Boolean,
      description: "For boolean flags: override value when rule matches",
    },
    variant: {
      type: String,
      description: "For variant flags: forced variant key when rule matches",
    },
  }],
  rolloutPercentage: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
    description: "For boolean flags with no matching rules: percentage of users who get true",
  },
  archived: {
    type: Boolean,
    default: false,
    description: "Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added.",
  },
}, {strict: true, toJSON: {virtuals: true}, toObject: {virtuals: true}});

featureFlagSchema.plugin(createdUpdatedPlugin);
featureFlagSchema.plugin(isDeletedPlugin);
featureFlagSchema.plugin(findExactlyOne);
featureFlagSchema.plugin(findOneOrNone);

featureFlagSchema.index({key: 1}, {unique: true});
featureFlagSchema.index({enabled: 1, archived: 1});
```

**Pre-save validation:** For variant-type flags, validate that `variants` is non-empty and weights sum to 100. Throw APIError if invalid.

### How the Two Flag Types Work

#### Boolean Flags (`type: "boolean"`)

Boolean flags return `true` or `false`. They use `rolloutPercentage` to control gradual rollouts and ignore the `variants` array entirely.

- **`enabled: false`** → always returns `false` for all users
- **`enabled: true`, no matching rules** → deterministic hash of `userId + flagKey` compared against `rolloutPercentage`. At 100% (default), all users get `true`. At 50%, roughly half get `true`.
- **Matching rule** → returns the rule's `enabled` value (`true` or `false`)

Examples:
- Feature toggle: `rolloutPercentage: 100` — on for everyone
- Gradual rollout: `rolloutPercentage: 10` — on for ~10% of users, increase over time
- Targeted: rule matching `admin: true` → `enabled: true`, everyone else gets the rollout percentage

#### Variant Flags (`type: "variant"`)

Variant flags return a string key identifying which variant the user is assigned to. They use the `variants` array with weighted distribution and ignore `rolloutPercentage`.

- **`enabled: false`** → returns `null` for all users (consumers should handle this as "no experiment running")
- **`enabled: true`, no matching rules** → deterministic hash of `userId + flagKey` mapped to variant based on cumulative weights. With `[{key: "control", weight: 50}, {key: "variant-a", weight: 50}]`, hash 0–49 = "control", 50–99 = "variant-a"
- **Matching rule** → returns the rule's `variant` value (forced into a specific variant, bypassing the hash)

The variant key is just an identifier — the consumer maps it to actual behavior in code:
```typescript
const variant = useVariant("checkout-experiment");
if (variant === "control") {
  return <OldCheckout />;
} else if (variant === "variant-a") {
  return <NewCheckout />;
}
```

Deterministic hashing guarantees the same user always gets the same variant for the same flag, without storing assignments in the database.

## **APIs**

### FeatureFlagsApp Plugin Routes

All routes mounted under configurable `basePath` (default: `/feature-flags`).

#### Admin Routes (IsAdmin)

| Method | Path | Type | Description |
|--------|------|------|-------------|
| POST | `/flags` | modelRouter | Create feature flag |
| GET | `/flags` | modelRouter | List flags (paginated, sortable) |
| GET | `/flags/:id` | modelRouter | Get single flag |
| PATCH | `/flags/:id` | modelRouter | Update flag |
| DELETE | `/flags/:id` | modelRouter | Soft-delete flag |
| GET | `/segments` | custom | List registered segment function names |

#### User Routes (IsAuthenticated)

| Method | Path | Type | Description |
|--------|------|------|-------------|
| GET | `/evaluate` | custom | Evaluate all enabled flags for current user |

**`GET /evaluate` response:**
```json
{
  "data": {
    "new-checkout-flow": true,
    "checkout-experiment": "variant-a",
    "dark-mode": false
  }
}
```

**`GET /segments` response:**
```json
{
  "data": ["pro-users", "beta-testers", "high-usage", "internal-team"]
}
```

### Plugin Constructor

```typescript
interface FeatureFlagsOptions {
  basePath?: string;                              // Default: "/feature-flags"
  segments?: Record<string, (user: any) => boolean>;  // Named segment functions
}

class FeatureFlagsApp implements TerrenoPlugin {
  constructor(options?: FeatureFlagsOptions);
  register(app: express.Application): void;
}
```

### Evaluation Logic

Evaluation is a **pure read** — no database writes occur during flag evaluation.

1. Fetch all enabled, non-archived FeatureFlags (`{enabled: true, archived: false}`)
2. For each flag, evaluate `rules` in order:
   - **Field rule:** Access `user[rule.field]` using dot notation (e.g., `lodash.get(user, rule.field)`) and compare against `rule.value` using `rule.operator`
   - **Segment rule:** Call `segments[rule.segment](user)` — match if returns true; log warning if segment not found
   - First matching rule → return `rule.enabled` (boolean) or `rule.variant` (variant)
3. If no rules match, use **deterministic hashing** (`hash(userId + flagKey) % 100`):
   - **Boolean flags:** Compare hash against `rolloutPercentage` — if hash < rolloutPercentage, return `true`
   - **Variant flags:** Map hash to variant based on cumulative weights. E.g., variants `[{key: "control", weight: 50}, {key: "variant-a", weight: 30}, {key: "variant-b", weight: 20}]` → hash 0–49 = "control", 50–79 = "variant-a", 80–99 = "variant-b"
4. If flag is disabled: return `false` for boolean, `null` for variant

### Consumer Registration

```typescript
// In consumer's server.ts
const segments = {
  "pro-users": (user) => user.plan === "pro",
  "beta-testers": (user) => user.betaTester === true,
  "high-usage": (user) => user.totalActions > 1000,
  "internal-team": (user) => user.email?.endsWith("@mycompany.com"),
};

new TerrenoApp({userModel: User})
  .register(new FeatureFlagsApp({ segments }))
  .register(new AdminApp({
    models: [
      {
        model: FeatureFlag,
        routePath: "/feature-flags",
        displayName: "Feature Flags",
        listFields: ["key", "name", "type", "enabled", "archived", "created"],
      },
    ],
  }))
  .start();
```

## **Notifications**

None needed.

## **UI**

No new dedicated screens. Feature flags are managed through the existing AdminApp generic form by registering the FeatureFlag model.

For rule targeting values that reference users, the AdminApp form treats `_id`,
`id`, `userId`, `ownerId`, and related user fields as User refs. Single-user
operators (`eq`, `neq`, `$eq`, `$ne`) render a User picker, and multi-user
operators (`in`, `nin`, `$in`, `$nin`) render an array of User pickers.
Selected users should display through the configured User ref renderer or
picker label, so admins see user names or emails rather than raw IDs when
editing rules.

### Frontend Hook (`@terreno/rtk`)

```typescript
// useFeatureFlags.ts — new file in @terreno/rtk
export const useFeatureFlags = (api: Api<any, any, any, any>, basePath = "/feature-flags") => {
  // Injects GET /feature-flags/evaluate endpoint
  // Returns { useFlag, useVariant, isLoading, error, refetch }
};

// Consumer usage
const { useFlag, useVariant } = useFeatureFlags(terrenoApi);

const showNewCheckout = useFlag("new-checkout-flow");       // true | false
const variant = useVariant("checkout-experiment");           // "control" | "variant-a" | null
```

Fetches once on mount, caches via RTK Query, refetches on window focus.

## Phases

### Phase 1: Backend package + evaluation engine
- Create `feature-flags/` package directory with package.json, tsconfig
- Implement FeatureFlag model (with archived field)
- Implement FeatureFlagsApp plugin with modelRouter CRUD
- Implement evaluation engine (field rules with dot notation, segment rules, deterministic hashing for both boolean rollout and variant assignment)
- Implement `/evaluate`, `/segments` custom endpoints
- Unit tests for evaluation logic

### Phase 2: Frontend hook
- Add `useFeatureFlags()` hook to `@terreno/rtk`
- Export from rtk index

### Phase 3: Example app integration
- Wire up FeatureFlagsApp in example-backend
- Register models in AdminApp
- Add sample flags and use `useFeatureFlags()` in example-frontend
- Regenerate SDK

## Feature Flags & Migrations

No feature flag needed for this feature itself — it's a new package with no existing behavior to gate. No data migrations required.

## Activity Log & User Updates

None needed.

## **Not included/Future work**

- Real-time flag updates via WebSocket (polling/refetch-on-focus only for v1)
- A/B test analytics or conversion tracking (consumers use their own analytics system)
- Custom admin UI for targeting rule editing (generic form only; consumers can extend)
- Async segment functions (sync only for v1; can be added if DB-lookup segments are needed)
- Flag scheduling (enable/disable at a future date)
- Mutual exclusion groups for experiments
- Flag audit log (who changed what, when)
- Flag environments (dev/staging/prod)
