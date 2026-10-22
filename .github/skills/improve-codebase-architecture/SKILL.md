---
name: improve-codebase-architecture
description: >-
  Scan recent codebase hot spots for deepening opportunities that improve
  locality, test seams, and agent navigability, then present ranked candidates
  before changing code.
disable-model-invocation: true
---
# Improve codebase architecture

Find high-leverage refactors that turn shallow modules into deep modules. This skill diagnoses and proposes; implementation starts only after the user chooses a candidate.

## Vocabulary

- **Module**: implementation hidden behind an interface.
- **Deep module**: a small interface hides substantial useful behavior.
- **Seam**: the public interface where behavior is tested.
- **Adapter**: a module that translates an external system into a domain-specific seam.
- **Locality**: one concept can be understood and changed in one place.
- **Leverage**: a small interface or edit controls substantial behavior.

Use these terms consistently.

## 1. Scope by evidence

If the user names an area, use it. Otherwise inspect recent history for files and concepts changed repeatedly. Weight active hot spots over speculative cleanup.

Read applicable `AGENTS.md`, `CLAUDE.md`, IPs, and architecture docs before proposing
changes. Treat explanation/reference pages as the current design.

## 2. Explore in a fresh context

Spawn a read-only exploration sub-agent. Ask it to identify:

- concepts that require bouncing through many tiny files
- shallow wrappers whose interface is nearly as complex as their implementation
- tightly coupled modules leaking internals across seams
- pure helpers extracted only to make internals testable while orchestration remains untested
- repeated changes scattered across many modules

Apply the **deletion test** to every candidate: would deleting the suspected wrapper concentrate complexity behind a better interface, or merely move the same complexity? Keep candidates only when the answer is concrete.

Do not propose an adapter for one hypothetical implementation. One adapter is a possible seam; two real implementations establish the seam.

## 3. Rank candidates

For each candidate report:

- modules/files involved
- current friction with evidence
- proposed deeper interface in plain language
- locality and leverage gained
- how the test seam improves
- migration risk and recommendation strength: `Strong`, `Worth exploring`, or `Speculative`
- before/after dependency sketch when relationships are otherwise hard to see

End with one top recommendation. Do not modify production code yet.

## 4. Design after selection

When the user selects a candidate:

1. Confirm constraints and the caller-visible behavior that must survive.
2. Design at least two interface shapes before choosing.
3. Prefer the smallest interface that hides the most complexity.
4. Define tests at the surviving public seam.
5. Record conflicts with an existing ADR instead of silently overriding it.

Hand the approved refactor to the normal IP/Roast flow when it exceeds one safe implementation slice.
