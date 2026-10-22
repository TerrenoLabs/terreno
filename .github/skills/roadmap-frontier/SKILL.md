---
name: roadmap-frontier
description: >-
  Chart and execute a feature too large for one agent context as a roadmap map
  with a small unblocked frontier, explicit decision tickets, and tracer-bullet
  delivery loops.
disable-model-invocation: true
---
# Roadmap frontier

Use for a destination too large or uncertain for one IP and one agent context. The map keeps a low-resolution route; linked tickets hold each decision or delivery slice.

## Map contract

Create one roadmap tracking issue with:

```markdown
## Destination
<observable state that means the effort is complete>

## Decisions so far
- [Decision title](link): one-line result

## Frontier
- [Open unblocked ticket](link)

## Not yet specified
<in-scope fog that is not precise enough to ticket>

## Out of scope
<explicit boundary>
```

Refer to tickets by linked title, not bare number. The map indexes decisions; details live once, on the ticket or linked IP.

## 1. Chart

1. Define the destination and scope boundary with the maintainer.
2. Read applicable IPs, roadmap items, ADRs, and recent code.
3. Create only questions and slices precise enough to state now. Keep the rest in **Not yet specified**.
4. Give every ticket explicit blockers. The **frontier** is open, unblocked, and unclaimed work.
5. Draft the map, tickets, labels, and dependency graph. Stop for maintainer approval before mutating GitHub.

Decision tickets answer one question. Delivery tickets produce one tracer-bullet behavior and link an approved IP/task pair when implementation is non-trivial.

## 2. Work one frontier item

Claim one frontier ticket before starting so parallel agents skip it.

### Decision ticket

Research or prototype only enough to make the decision. Record the resolution on the ticket, close it, and append a one-line linked gist to **Decisions so far**.

### Delivery ticket

Run one complete pipeline loop:

1. **Grow**: approve the slice IP and dependency-aware task list.
2. **Pick**: implement vertical slices with red → green Bun tests.
3. **Roast**: independently verify the IP with evidence.
4. **Brew**: run full agent-quiet tests, docs gate, and code review; open/update the draft PR.
5. **Taste**: invoke one current-state reaction at a time; persist results and let the
   outer loop schedule fresh Taste iterations until `PASS` or `BLOCKED`.

Close the ticket only when its acceptance evidence and merged PR are linked.

Never resolve more than one non-research ticket per agent context. The tight loop comes from returning to the refreshed frontier with a clean context.

## 3. Refresh the map

After each resolution:

- add newly visible precise tickets and wire blockers
- graduate clarified fog into tickets
- remove graduated text from **Not yet specified**
- close tickets now beyond the destination and link the reason under **Out of scope**
- regenerate the concise **Frontier**

Stop when the destination is reached and no in-scope fog or open tickets remain.

## Roadmap rules

All roadmap mutations retain the existing maintainer-approval gates. Validate labels/fields with `bun run roadmap:check`. Do not copy IP designs or task lists into the map; link them.
