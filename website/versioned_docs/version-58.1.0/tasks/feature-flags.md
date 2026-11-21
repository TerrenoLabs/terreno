# Feature Flags — Task List

**Status:** Closed (2026-08-20) — IP deferred; superseded by [feature-flags-openfeature.md](./feature-flags-openfeature.md). Open tasks below will not be executed.

## Phase 1: Backend + Evaluation Engine

- [ ] **Task 1.1**: Create `feature-flags/` package with FeatureFlag model (including archived field)
- [ ] **Task 1.2**: Implement FeatureFlagsApp plugin with modelRouter CRUD
- [ ] **Task 1.3**: Implement evaluation engine (field rules with dot notation, segment rules, deterministic hashing for boolean rollout and variant assignment)
- [ ] **Task 1.4**: Implement `/evaluate` and `/segments` custom endpoints
- [ ] **Task 1.5**: Write tests for evaluation logic
- [ ] **Task 1.6**: Integrate with example-backend

## Phase 2: Frontend Hook

- [ ] **Task 2.1**: Add `useFeatureFlags()` hook to `@terreno/rtk`
- [ ] **Task 2.2**: Export from rtk index

## Phase 3: Example App Integration

- [ ] **Task 3.1**: Wire up FeatureFlagsApp in example-backend, register model in AdminApp
- [ ] **Task 3.2**: Add sample flags and use `useFeatureFlags()` in example-frontend
- [ ] **Task 3.3**: Regenerate SDK

See `docs/implementationPlans/feature-flags.md` for full details on each task.
