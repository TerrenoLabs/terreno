# Heartbeat

A campaign spends most of its wall-clock time waiting on humans and CI. The heartbeat is
how one resident session stays useful during that wait without spamming anyone.

One tick = one bounded pass over the campaign's open PRs and its backlog. A tick that
finds nothing to do produces **no output** and schedules the next one.

## Tick procedure

1. **Snapshot.** One listing of the campaign's PRs, by the charter's label when it has
   one, otherwise by the recorded PR numbers in campaign state:

   ```bash
   gh pr list --author @me --label <goal-slug> --state open \
     --json number,title,headRefOid,isDraft,mergeable,reviewDecision,statusCheckRollup,reviewRequests,comments,updatedAt
   ```

   Reconcile the result against campaign state: a PR that merged, closed, or gained a new
   head since the last tick has changed status regardless of what state remembers.

2. **Classify each PR** into exactly one bucket:

   | Bucket | Signal |
   | --- | --- |
   | `unrouted` | PR exists with no recorded reviewer/assignee |
   | `answered` | A human comment, review, or requested change arrived after the last tick |
   | `broken` | CI failed on the current head, the PR conflicts with its base, or a review-bot thread is unanswered |
   | `bot-pending` | Review bots or CI still running on the current head |
   | `merged` | Merged since the last tick |
   | `closed` | Closed without merging |
   | `waiting` | Green, routed, no new human input — waiting on review |

3. **Act in priority order**, at most one PR per bucket per tick unless the tick budget
   allows more:

   1. `unrouted` → apply [`pr-routing.md`](pr-routing.md).
   2. `answered` → invoke the lifecycle's Taste for that PR in a fresh subagent. Taste
      owns reading the threads, making the fix, running the pre-push gate, pushing, and
      watching CI. The loop does not answer review comments itself.
   3. `broken` → same: one Taste invocation for that PR. Taste counts fix rounds across
      ticks; when it returns `BLOCKED` after three, mark the PR `blocked` and surface it
      at the top of the next report. A blocked PR is never left as a quiet `waiting`.
   4. `merged` → invoke the scan Track stage for that slice: re-measure, close findings
      with evidence, record the round.
   5. `closed` → mark the slice `abandoned` with the closing reason, return its findings
      to `open`, and surface it in the next report.
   6. `bot-pending` and `waiting` → nothing. These are why the next tick exists.

4. **Refill capacity.** After acting, if open campaign PRs are below `wipLimit` and the
   backlog has planned findings, advance the campaign one step (Plot the next slice, or
   Sweep when the backlog is empty).

5. **Persist and schedule.** Update campaign state — including `lastTick`, each PR's
   bucket, and the comment ids already answered — then choose the next interval and exit
   the tick.

## Answering exactly once

Record the id of every comment, review, and thread the campaign has already acted on. A
tick answers a human only when that id is new. Re-reading an old thread and replying again
is the single most common way a resident agent becomes noise.

Never post a status comment on a PR just because a tick ran. The only comments the
campaign writes are the ones the lifecycle's own contracts call for.

## Choosing the interval

Match the wait, not the clock:

| State | Interval |
| --- | --- |
| CI running on a head the campaign just pushed | Prefer the provider's watch hook (`gh pr checks --watch`, `circleci run watch`); fall back to 2–5 minutes |
| Review bots queued on a new head | 2–5 minutes |
| Everything green, waiting on a human reviewer | 15–30 minutes |
| Nothing open and backlog work remains | No wait; continue the campaign immediately |
| Nothing open, nothing planned, goal not met | 30–60 minutes, or stop and report if the charter's horizon passed |

Prefer the harness's native scheduling or completion hooks over sleeping. Use a timer
only when no hook applies. Never busy-poll a PR that is waiting on a person.

## Tick safety

- One tick never spawns more than one lifecycle stage per PR.
- A tick that fails to reach the host (network, auth, rate limit) records the failure,
  backs off to double the current interval up to the maximum, and tries again. Three
  consecutive host failures is `BLOCKED` with `kind: access`.
- A tick never rewrites history on a PR a human is reviewing: no force-push beyond what
  the lifecycle's own push gate does, no branch deletion, no closing a human's PR.
- Ticks are idempotent. A tick that dies mid-way leaves state consistent enough that the
  next tick re-derives everything from the host snapshot.
