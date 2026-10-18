# @terreno/admin-backend

Admin panel backend plugin for @terreno/api.

See [Add a model to the admin](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/admin-add-model.md) for the recommended
`modelRouter({admin: ...})` setup.

Admin panel backend plugin for `@terreno/api` that auto-generates admin CRUD endpoints and metadata for Mongoose models.

## Install

```bash
bun add @terreno/admin-backend @terreno/api mongoose
```

## Quick start

```typescript
import {TerrenoApp} from "@terreno/api";
import {AdminApp} from "@terreno/admin-backend";
import {User, Todo} from "./models";

new TerrenoApp({userModel: User})
  .register(
    new AdminApp({
      basePath: "/admin",
      models: [
        {
          model: User,
          routePath: "/users",
          displayName: "Users",
          listFields: ["email", "name", "admin"],
          defaultSort: "-created",
        },
        {
          model: Todo,
          routePath: "/todos",
          displayName: "Todos",
          listFields: ["title", "completed", "ownerId"],
        },
      ],
    })
  )
  .start();
```

This creates `GET /admin/config` plus full CRUD at `/admin/users` and `/admin/todos`, all protected with `Permissions.IsAdmin`.

## What's included

- `AdminApp` — registers admin routes and the config metadata endpoint
- `DocumentStorageApp` — optional GCS document browser routes for admins, or for every signed-in user in a private folder (`access: "authenticated"`), with optional upload rate limit
- `runScriptCli` — CLI helper for admin script execution
- Auto-generated CRUD via `modelRouter` with `IsAdmin` on every route
- `GET /admin/config` — field metadata extracted from Mongoose schemas and OpenAPI
- Admin UI v2 route helpers (`adminUiV2` exports)
- TypeScript types: `AdminModelConfig`, `AdminOptions`, `AdminFieldOverride`, and more

## Documentation

Full API reference: [docs/reference/admin-backend.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/admin-backend.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
