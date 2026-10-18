# @terreno/api

Styled after the Django & Django REST Framework, a batteries-include framework for building REST APIs with Node/Express/Mongoose.

This library attempts to make creating REST APIs much easier with Express and Mongoose.
Most REST APIs wind up being a lot of boilerplate, so this tries to cut that down without turning
into a full blown framework of its own. This library is inspired by the
[Django-REST-Framework](https://www.django-rest-framework.org).

These APIs integrate with @terreno/rtk to create consistent types on the frontend
and backend, and automatically generated React hooks to fetch, query, and modify
model instances.

## Features

- **modelRouter** — Automatic CRUD endpoints for Mongoose models
- **Authentication** — JWT with email/password and GitHub OAuth support
- **Permissions** — Fine-grained access control (IsAuthenticated, IsOwner, IsAdmin, etc.)
- **OpenAPI** — Automatic spec generation from models and routes
- **Logging** — Winston-based logging with scoped & feature-flagged loggers, automatic request correlation, and Google Cloud / Sentry support
- **HTTP client** — Authenticated axios factory for third-party APIs with token caching, safe retries, and normalized error handling (see [Call external APIs](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/call-external-apis.md))

## Install

```bash
bun add @terreno/api
```

## DateOnly Type

If you're using the `DateOnly` schema type from @terreno/api, you must register it with Mongoose as early as possible in your application—**before mongoose is imported elsewhere**. This ensures the custom type is available when your schemas are defined.

Add this to the top of your entry point (e.g., `src/index.ts`):

```typescript
import {Schema} from "mongoose";
import {DateOnly} from "@terreno/api";

// Register DateOnly type before any models are loaded
const schemaTypes = Schema.Types as typeof Schema.Types & {DateOnly: typeof DateOnly};
schemaTypes.DateOnly = DateOnly;
```

Then you can use it in your schemas:

```typescript
const eventSchema = new Schema({
  eventDate: {type: schemaTypes.DateOnly},
});
```

## Usage

Assuming we have a model:

    const foodSchema = new Schema<Food>({
      name: {
        description: "Name of the food item",
        type: String,
      },
      hidden: {
        description: "Whether the food is hidden from the list",
        type: Boolean,
        default: false,
      },
      ownerId: {
        description: "The user who added this food",
        type: "ObjectId",
        ref: "User",
      },
    });
    export const FoodModel = model("Food", foodSchema);

**Important:** Every field must include a `description` property. This requirement ensures that the auto-generated OpenAPI specification and SDK have meaningful documentation for all fields.

We can expose this model as an API like this:

    import express from "express";
    import {modelRouter, Permissions} from "@terreno/api";

    const app = express();
    app.use(
      "/foods",
      modelRouter(UserModel, {
        permissions: {
          list: [Permissions.IsAny],
          create: [Permissions.IsAuthenticated],
          read: [Permissions.IsAny],
          update: [Permissions.IsOwner],
          delete: [Permissions.IsAdmin],
        },
      })
    );

Now we can perform operations on the Food model in a standard REST way. We've also added some permissioning.

    # Gets a list of foods. Anyone can do this without being authenticated.
    GET /foods
    {
        data: [{_id: "62c86d787c7e2db0bf286acd", name: "Carrots", hidden: false, ownerId: "62c44d9f003d9f8ee8cc9256"}],
        more: false,
        page: 1,
        limit: 100
    }

    # Get a specific food. Anyone can do this.
    GET /foods/62c86d787c7e2db0bf286acd
    {_id: "62c86d787c7e2db0bf286acd", name: "Carrots", hidden: false, ownerId: "62c44d9f003d9f8ee8cc9256"}

    # Creates a new food. Only authenticated users are allowed to do this.
    POST /foods {name: "Broccoli", ownerId: "62c44d9f003d9f8ee8cc9256"}
    {_id: "62c86d787c7e2db0bf286000", name: "Broccoli", hidden: false, ownerId: "62c44d9f003d9f8ee8cc9256"}

    # Updates an existing food. Only the owner of the food can do this, otherwise an error code is returned.
    PATCH /foods/62c86d787c7e2db0bf286acd {name: "Peas And Carrots"}
    {_id: "62c86d787c7e2db0bf286acd", name: "Peas And Carrots", hidden: false, ownerId: "62c44d9f003d9f8ee8cc9256"}

    # Deletes an existing food. Only admins are allowed to do this (users with `user.admin` set to true).
    DELETE /foods/62c86d787c7e2db0bf286acd

You can create your own permissions functions. Check permissions.ts for some examples of how to write them.

## Authentication

@terreno/api includes built-in authentication with JWT and OAuth support.

### Email/Password Authentication

Built-in email/password authentication using `passport-local-mongoose`:

```typescript
import {setupServer} from "@terreno/api";
import {User} from "./models/user";

setupServer({
  userModel: User,
  addRoutes: (router) => {
    // Your routes here
  },
});
```

This automatically adds:
- `POST /auth/signup` — User registration
- `POST /auth/login` — Authentication
- `POST /auth/refresh_token` — Token refresh
- `GET /auth/me` — Get current user
- `PATCH /auth/me` — Update current user

### GitHub OAuth

Add GitHub OAuth login to your API:

```typescript
import {githubUserPlugin, setupServer} from "@terreno/api";

// Add GitHub fields to user schema
userSchema.plugin(githubUserPlugin);

setupServer({
  userModel: User,
  githubAuth: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackURL: process.env.GITHUB_CALLBACK_URL!,
  },
});
```

**Learn more:** See the [GitHub OAuth how-to guide](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/add-github-oauth.md) for complete setup instructions.

## Logging

@terreno/api provides a Winston-based `logger`, two helpers (`createScopedLogger` and
`createFeatureFlaggedLogger`), and automatic request/job correlation. Always use these instead of
`console.log` for permanent server logs.

```typescript
import {createFeatureFlaggedLogger, createScopedLogger, logger} from "@terreno/api";

// Global logger
logger.info("Server started", {port: 4000});
logger.error("Failed to process", {error});
await chargeCard(id).catch(logger.catch); // logs + captures the exception

// Scoped logger: a stable prefix + labels on every line, ideal for multi-step workflows
const log = createScopedLogger({
  prefix: "[InvoicePay]",
  labels: {invoiceId: invoice._id.toString()},
});
log.info("Starting capture"); // -> "[InvoicePay] Starting capture invoiceId=… requestId=…"

// Feature-flagged logger: silent until isEnabled() returns true (no redeploy needed)
const debugLog = createFeatureFlaggedLogger({
  isEnabled: () => process.env.DEBUG_BILLING === "true",
  target: log,
});
debugLog.debug("optional detail");
```

### Correlation

While a request or job scope is active, every log line is automatically tagged with `requestId`,
`userId`, `traceId`, and related fields, so all lines for one request can be grouped together. HTTP
requests get a scope automatically (the framework also echoes an `X-Request-ID` response header).
For background jobs, scripts, and cron tasks, open a scope with `runWithRequestContext`:

```typescript
import {createScopedLogger, runWithRequestContext} from "@terreno/api";

await runWithRequestContext({jobId: "nightly-sync"}, async () => {
  const log = createScopedLogger({prefix: "[NightlySync]"});
  log.info("started"); // includes jobId + a generated requestId on every line
  await sync();
});
```

In production, pass a structured transport (e.g. `@google-cloud/logging-winston`) via
`loggingOptions`/`setupLogging` so the correlation fields and labels reach Log Explorer as
`jsonPayload`.

**Learn more:** See the [Logging & Tracing reference](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/api.md#logging--tracing) for
the full API, label conventions, and Google Cloud Logging / Sentry details.

## Sentry
To enable Sentry, create a "src/sentryInstrumment.ts" file in your project.

> **Note:** Bun automatically loads `.env` files before your code runs, so there's no need for `dotenv`. Just place a `.env` file in your project root and `process.env` will have your variables available immediately. See [Bun .env docs](https://bun.sh/docs/runtime/env).

Install both SDK packages in the consuming backend:

```bash
bun add @sentry/bun @sentry/profiling-node
```

```
import * as Sentry from "@sentry/bun";
import {nodeProfilingIntegration} from "@sentry/profiling-node";

if (process.env.NODE_ENV === "production" && !process.env.SENTRY_DSN) {
  throw new Error("SENTRY_DSN must be set");
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    // Only profile integration needs to be added, the rest are defaults and are already added,
    // including Express, mongoose, HTTP, etc.
    nodeProfilingIntegration(),
  ],
  // Debug can be helpful for figuruing out why something isn't working.
  // debug: true,
  environment: process.env.SENTRY_ENVIRONMENT ?? "production",
  // Skip some errors if needed.
  ignoreErrors: [
    /^.*ECONNRESET*$/,
    /^.*socket hang up*$/,
  ],
  // Set to 1.0 when testing the integration. Lower these to something like 0.1 or 0.2 in production. You can also use tracesSampler as a function to filter out ones
  // you don't care about.
  tracesSampleRate: 1.0,
  profileSessionSampleRate: 1.0
});
```

Then at the top of your src/index.ts file, before express is imported anywhere:

```
import "./sentryInstrument";
```

## Example

To test out how the API works, you can look at and run [example.ts] by running `bun run compile` then running `bun dist/example.js` in /@terreno/api; while running, you can use a mongoDB client such as Compass to view collections.

## Dev

To continuously compile the package:

    bun run dev

To run tests, linting, and fixing up lint issues:

    bun run lint
    bun run lint:fix
    bun run test

To see how your changes will affect the docs:

    bun run docs
    cd docs/
    bunx http-server

A lot of dev may require using bun link. You'll want to keep the `bun run dev` window running to continuously compile:

    bun link
    cd $your-api-repo
    bun link @terreno/api

## Documentation

Full API reference: [docs/reference/api.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/api.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
