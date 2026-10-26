# Behavior-first tests

Tests are executable specifications at public seams. A refactor may replace the implementation without changing the test.

## Choose the seam

Before each slice, record the public seam in the task/working notes:

- HTTP route for backend behavior
- exported class/function for package behavior
- rendered component interaction for UI behavior
- injected adapter contract for external systems

Prefer the highest existing seam that proves the behavior. Add a seam only when the production design needs one.

## Red flags

- asserting private methods, internal call order, or call counts
- querying storage directly when the public interface can retrieve the result
- recomputing the expected value with the same algorithm as production
- writing all imagined tests before any implementation
- testing a mock's behavior instead of the product behavior

Expected values come from a literal worked example, the IP, or another independent source of truth.

## Planned e2e specs

The IP's `## E2E tests` table is the e2e plan, defined in the
[`testing plan`](../references/testing-plan.md). Pick writes every row whose
`Written in` names the current task, in that task, at the row's path. Follow the e2e
guide the testing plan resolves for where specs live, how they find elements, and how
they wait. A row whose path or layer no longer fits is edited in the IP with a one-line
reason, never skipped. Running a layer the current stage cannot reach follows the
testing-plan deferral rule.

## Repository composition

Load applicable repository testing skills before choosing commands, harnesses, fixtures,
databases, assertion libraries, or runtime probes. In Terreno apps those are
`terreno-backend-tests`, `terreno-frontend-tests`, and `terreno-mobile-tests`; run
`terreno-test-setup` first when the layer has no test setup. Match established tests near the
changed public seam. The lifecycle plugin does not prescribe a framework or package
layout.
