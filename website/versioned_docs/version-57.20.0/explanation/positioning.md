# Positioning

This is the single source of truth for how Terreno describes itself. The problem
this page exists to fix is drift: the README, the docs landing page, `AGENTS.md`,
and the npm package descriptions have historically said different things, so a
visitor's impression of Terreno depended on which door they walked through.

The rule is simple: **write the wording once, here, then reuse it verbatim
everywhere else.** Do not paraphrase per surface.

## Canonical copy blocks

Copy these blocks exactly. They are in fenced code blocks so they can be lifted
without markdown-rendering surprises.

### `tagline`

Used by: README H1 subtitle, docs site `tagline`, npm `description` prefix.

```
Terreno is Django/Rails for TypeScript — with universal app support.
```

### `elevator`

Used by: README intro, docs landing intro, package READMEs.

```
Terreno is Django/Rails for TypeScript — a batteries-included, full-stack
framework where the undifferentiated 80% of an app is already written. On the
backend you get Mongoose models, auto-generated REST APIs, permissions, an admin
panel, authentication, and an AI service. On the frontend you get one universal
app — a single React Native codebase that ships to iOS, Android, and web. It is
built to be driven by AI coding agents from the first prompt to a production
deploy.
```

### `pillars`

Used by: README, docs landing, `AGENTS.md`. Keep the order.

```
- Batteries included — auth, CRUD APIs, admin, permissions, AI, realtime,
  feature flags, and consent are already built, so your code is business logic.
- Universal by default — one React Native codebase ships to iOS, Android, and
  web. Not a web framework with a mobile bolt-on.
- AI-native — agents are a first-class client of the framework, not an
  afterthought.
```

### `aiPillar`

Used wherever the AI-native pillar gets more than a bullet. It must always name
**both** layers (see language rule 5).

```
Terreno's AI-native story has two layers. The tool layer is a Model Context
Protocol (MCP) server that gives coding agents codegen, documentation search,
and component reference for the framework's conventions. The process layer is the
`/terreno-*` SDLC pipeline — plan, implement test-first, verify in a fresh
context, submit with evidence, then own the review loop — which today runs inside
the Terreno repository while its consumer-installable packaging is finished.
Django gives you `manage.py startapp`; Terreno is building a reviewed path from a
request to a mergeable pull request.
```

> **Portability gate (do not remove until cleared).** The `/terreno-*` pipeline
> is not yet verified to run in a consumer application — that is
> [`agentic-sdlc-plugin`](../implementationPlans/agentic-sdlc-plugin.md) Task 2.5,
> which is still open. Until it passes, describe the pipeline as in-progress
> packaging (as the `aiPillar` block above does) and never imply a consumer can
> install and run it today. When Task 2.5 passes, update the `aiPillar` block to
> claim the pipeline as consumer-ready.

### `pitch`

Used by: blog post intros, conference abstracts, social. ~150 words.

```
Every app needs the same foundation: authentication, user management, CRUD APIs,
an admin panel, permissions, realtime updates, feature flags, and AI. That work
is weeks of undifferentiated effort, and it is the same in every product.

Terreno is Django/Rails for TypeScript. Define a Mongoose model, register it, and
you have a permissioned REST API with pagination, filtering, and an OpenAPI spec.
Add the admin package and you have a working admin panel. Your app is left with
the part that is actually yours: the business logic.

The difference from Django or Rails is universal apps — one React Native codebase
ships to iOS, Android, and web — and being AI-native. Agents are a first-class
client: an MCP server teaches them the conventions, and a reviewed SDLC pipeline
takes a request to a mergeable pull request. You build with AI from the first
prompt to production.
```

## Why the Django/Rails analogy

Django and Rails won by deciding that the generic parts of a web app — the ORM,
the router, the admin, auth — belong in the framework, not in every project. They
are opinionated, batteries-included, and productive because of it. Terreno makes
the same bet for TypeScript: the generic 80% of an app lives in the framework so
your codebase is the 20% that is unique to your product.

The analogy earns two honest caveats. First, Terreno targets a document store
(MongoDB via Mongoose), not a relational ORM, and it has no migrations framework.
Second, it is younger — several Django/Rails staples (server-side rendering,
role-based access control) are not shipped yet. The
comparison table below is deliberately straight about where the analogy holds and
where it does not; being honest about the gaps is what makes the analogy credible
rather than marketing.

The two things Django and Rails do not give you, and Terreno does, are **universal
apps** (one codebase for iOS, Android, and web) and being **AI-native** by design.

## Comparison table

Every "shipped" row cites where the feature lives in the source. Every "not
shipped" row links the implementation plan or roadmap item that tracks it.

| Django / Rails concept | Terreno equivalent | Honest caveat |
|------------------------|--------------------|----------------|
| Models + ORM | Mongoose schemas + `@terreno/api` plugins (`api/src/plugins.ts`) | Document store, not relational; no migrations framework (see the Migrations row) |
| `ModelViewSet` / scaffolds | `modelRouter` (`api/src/api.ts`) | REST only; no GraphQL |
| Django admin | `@terreno/admin-backend` + `@terreno/admin-frontend` / `@terreno/admin-spa` | Younger; the parity gap is tracked in [`admin-ui-v2-django-parity`](../implementationPlans/admin-ui-v2-django-parity.md) |
| Auth + permissions | Better Auth (`api/src/betterAuthApp.ts`) + `Permissions` (`api/src/permissions.ts`) | Fine-grained RBAC is in progress ([`rbac-permissions`](../implementationPlans/rbac-permissions.md)) |
| Templates / views | `@terreno/ui` components — one universal codebase for iOS, Android, and web | Server-side rendering for web is not shipped yet ([`web-ssr-and-admin-spa`](../implementationPlans/web-ssr-and-admin-spa.md)) |
| `manage.py` / generators | MCP server tools — the *tool* layer (`mcp-server/src/tools.ts`) + the `/terreno-*` SDLC pipeline — the *process* layer (`plugins/terreno-planning/skills/`) | Agent-driven rather than CLI-driven; the pipeline is not yet packaged for consumer apps ([`agentic-sdlc-plugin`](../implementationPlans/agentic-sdlc-plugin.md) Task 2.5) |
| Celery / ActiveJob (background jobs) | `@terreno/jobs` `JobsApp` (`jobs/`) | [How-to](../how-to/background-jobs.md), [reference](../reference/jobs.md); optional GCP Cloud Tasks and Vercel Queues runners |
| Migrations | No migrations framework | Schema evolution is convention plus the published `mongoose-schema-safety` skill |

## Language rules

Every doc, README, landing page, and agent-facing surface follows these rules.

1. **Lead with the analogy.** Say "Django/Rails for TypeScript" within the first
   two sentences of the README and the docs landing page.
2. **Say "universal app,"** not "cross-platform" and not "React Native app," when
   describing the frontend. It is one codebase that ships to iOS, Android, and
   web.
3. **Never claim an unshipped feature as available.** If a capability is on the
   roadmap or tracked by an open IP, say so. Grep the package source before
   writing that something ships.
4. **Keep superlatives off reference pages.** "The best framework for X" belongs
   on the landing page and the pitch, never in reference documentation.
5. **Never describe one AI layer without the other.** The tool layer (MCP server)
   and the process layer (`/terreno-*` pipeline) are always named together, and
   the pipeline is described honestly per the portability gate above.

## Repository metadata (maintainer action)

The GitHub repository description and topics cannot be set from a commit. A
maintainer must set them in **Settings → General** and the **About** panel.

**Description** (the short tagline variant):

```
Django/Rails for TypeScript, with universal iOS/Android/web apps.
```

**Topics:**

```
typescript, react-native, expo, express, mongoose, framework, mcp, ai, universal-apps, full-stack
```
