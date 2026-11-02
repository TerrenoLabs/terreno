# Worker briefing

One briefing per shard. The worker has no parent memory and must not rediscover the
repository. Send exactly these sections.

```markdown
## Goal

<goal statement>. Metric: <metric name>, currently <value><unit>, target <value><unit>.

## Rules in play

| Rule | Matches | Why it moves the metric |
| --- | --- | --- |
| <slug> | <one sentence> | <one sentence> |

## Validity rule

A finding is valid only when <charter sentence, quoted verbatim>.

## Severity rubric

<charter rubric table, quoted verbatim, plus the effort scale>

## Your shard

Files:
- <path>
- <path>

Hits:
- <path>:<line> — <rule>
- <path>:<line> — <rule>

## Commands you may run

- `<named command>`
- `<named command>`

## Rules of engagement

1. Work only inside the shard's files. You may read a definition or caller a hit points
   at; do not search the repository at large.
2. Do not edit, stage, or commit anything. Do not run destructive commands.
3. Do not spawn other agents.
4. Every candidate needs a `path:line` anchor and reproducible evidence: the command you
   ran and its output, or the exact code excerpt that proves the claim.
5. If the shard has no valid candidates, return an empty array. That is a correct answer.

## Return this and nothing else

A JSON array of objects conforming to the finding schema:

[
  {
    "id": "<shard>-<n>",
    "rule": "<rule slug>",
    "title": "<one line>",
    "severity": "high|medium|low",
    "confidence": "high|medium|low",
    "effort": "S|M|L",
    "anchors": [{"path": "<path>", "line": 42, "symbol": "<optional>"}],
    "why": "<how fixing this moves the metric>",
    "fix": "<the smallest change that would resolve it>",
    "ev": "<command + output, or the proving excerpt>"
  }
]
```

No prose, no transcript, no restated instructions.
