# Per-rule playbook

Decisions for the CodeQL JavaScript rules this repository has hit. A rule not
listed here: read its help (`gh api repos/{owner}/{repo}/code-scanning/alerts/<n> --jq .rule.help`),
default to **fix**, and add a section here in the same PR.

## js/missing-rate-limiting

**Default: dismiss, `false positive`**, after one check per run.

`TerrenoApp.build()` mounts `createRateLimitMiddleware` with `app.use` before
every registered plugin and model router (`api/src/terrenoApp.ts`), and it is on
unless an app passes `rateLimit: false`. CodeQL only models known limiter
libraries such as `express-rate-limit`, so it flags every route anyway.

Check once per run: the flagged route is mounted through a `TerrenoPlugin` or
`modelRouter` registered on `TerrenoApp`, and `createRateLimitMiddleware` is
still mounted before plugins. A route mounted outside `TerrenoApp` (a standalone
Express app, a worker server) is **fix**: put it behind the limiter.

Comment: `TerrenoApp mounts createRateLimitMiddleware app-wide before every plugin route (api/src/terrenoApp.ts); CodeQL does not model custom limiters.`

## js/sql-injection (Mongo query objects)

**Default: fix.** A request value reaching a Mongo filter can be an object
(`{"$ne": null}`), which turns an equality match into an operator.

CodeQL-recognized sanitizers:
- `typeof value === "string"` (or `Number.isFinite`) guard before use, rejecting with `APIError` 400
  - Put the use inside the **positive** branch (`if (typeof v === "string") {match.f = {$eq: v}}`). A negative guard that throws (`if (v !== undefined && typeof v !== "string") throw …`) is correct but CodeQL did not accept it as a sanitizer (alert #38).
- wrap equality matches: `{field: {$eq: value}}`
- cast through a validated primitive (`String(value)` after a type check, `new mongoose.Types.ObjectId(value)` after `isValidObjectId`)

Dismiss only when a Zod/AJV schema on the same route already types the value as
a primitive, and name that schema in the comment.

## js/polynomial-redos

**Default: fix.** Typical offenders: trim regexes (`/\/+$/`, `/^\s+|\s+$/`),
nested quantifiers, and alternations that overlap.

Fixes: replace trims with a loop (`while (s.endsWith("/")) s = s.slice(0, -1)`),
anchor and make quantified groups disjoint, or cap input length before matching.
Test: a 50k-character pathological string finishes in well under 100 ms.

## js/prototype-polluting-assignment / js/prototype-pollution-utility

**Default: fix.** Guard every dynamic key: skip `__proto__`, `constructor`, and
`prototype` with an explicit `if` before the assignment (CodeQL recognizes the
comparison), or build into `Object.create(null)` / a `Map`. Test that
`{"__proto__": {"polluted": true}}` leaves `({}).polluted` undefined.

## js/insufficient-password-hash

**Default: dismiss, `false positive`, when the hashed value is a server-made
high-entropy secret** (random token, client secret, cookie nonce from
`crypto.randomBytes`). A fast hash (SHA-256) is correct for those. Name the
generator and its byte length in the comment. A human-chosen password is
**fix**: use the auth library's password hasher (scrypt/argon2/bcrypt).

## js/reflected-xss

**Default: fix.** Send JSON with `res.json()`, or HTML-escape the value. Never
echo a request value into an HTML or text response body.

## js/resource-exhaustion-from-deep-object-traversal

**Default: fix.** AJV `allErrors: true` on untrusted input: turn it off for
request validation, or cap input depth and size first.

## js/insecure-randomness

**Default: fix.** `crypto.randomUUID()` / `crypto.getRandomValues()` (or
`expo-crypto` on native) instead of `Math.random()` for ids, tokens, and
session keys.

## js/incomplete-url-substring-sanitization

**Default: fix.** Parse with `new URL()` and compare `hostname` exactly or with
`endsWith("." + domain)`; never `includes("domain")`.

## js/stack-trace-exposure, js/unnecessary-use-of-cat, any alert in a test file

Tests are ignored by `.github/codeql/codeql-config.yml`. Dismiss with
`used in tests`; they also close as `fixed` on the next master scan. Fix only
when the change is trivial and improves the test.
