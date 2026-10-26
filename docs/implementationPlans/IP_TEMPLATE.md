# Implementation plan template

Copy to `docs/implementationPlans/<slug>.md` and replace placeholders. Pair with
`docs/tasks/<slug>.md`. Add `**Parent IP:** [other](other.md)` only when this plan
rides on another plan's roadmap entry instead of getting its own. A filled Parent
IP header skips reconcile for that file. `**Roadmap:**` sets the Area / Target / Impact
the roadmap entry is scaffolded with on merge; omit it to have them inferred.

**Status:** Draft | Approved | In progress | Complete | Deferred  
**Roadmap:** Area=`api`, Target=`Next`, Impact=`Feature`  
**Branch:**  
**Owner:**  
**Created:** YYYY-MM-DD  

## Goal

## Non-Goals

## Decisions

| Question | Decision |
|----------|----------|

## Architecture

## Models

## APIs

## Notifications

## UI

(Admin v2: document `home.slots` — `navGlobal`, `contentTop`, `main`, `sidebar` — if applicable.)

## Phases

## Feature Flags & Migrations

## Activity Log & User Updates

## Not Included / Future Work

## Files to Create / Modify

## Task List

Link to `docs/tasks/<slug>.md`.

## E2E tests

Every planned spec or flow, written by the task that delivers its behaviour. Follow
[`docs/testing/e2e.md`](../testing/e2e.md) for paths and layers. Write
`None — <reason>` when the plan adds none; never delete the section.

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `<package>/e2e/<name>.spec.ts` | browser \| native flow \| http \| process | `<acceptance criterion, observable>` | T1 |

## Regression cases

None — no hard-to-automate change

Most plans keep the line above; never delete the section. Replace it only when the plan
changes something a developer or QA must check by hand (push notifications and other
hardware or OS behavior, a full cross-device flow, feel) that no existing case covers. See
"Keep regression minimal" in the planning plugin's testing plan. Cases use the suite format
of `docs/regression/` with provisional IDs (`<AREA>-new-<n>`); Brew assigns real IDs:

Destination: `<AREA>` → `docs/regression/<area>.md`

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| `<AREA>-new-1` | `<case>` | `<starting state, then actions>` | `<what a person observes>` | `<platforms>` | manual \| E1 | `<slug>` |

## Acceptance Criteria

- [ ]
