# @terreno/mcp

MCP server for Terreno - provides documentation, tools, and prompts for building full-stack apps.

## Features

### Resources

Documentation resources accessible via MCP:

- `terreno://docs/overview` - Overview of the Terreno monorepo
- `terreno://docs/api` - @terreno/api documentation
- `terreno://docs/ui` - @terreno/ui documentation
- `terreno://docs/rtk` - @terreno/rtk documentation
- `terreno://docs/patterns` - Common patterns and best practices

### Tools

Code generation tools:

- `terreno_search_docs` - Search bundled Terreno documentation (call before guessing APIs). Optional `version` selects a retained docs snapshot; omit for current `next` docs.
- `terreno_get_component_docs` - Full `@terreno/ui` props table for one component
- `terreno_get_upgrade_guide` - Lockstep upgrade notes between two `@terreno/*` versions
- `terreno_search_update_notes` - Search bundled upgrade markdown and optional backend announcement help API
- `terreno_get_update_note` - Fetch one full update note by id (`upgrade:<semver>` or `announcement:<mongoId>`)
- `terreno_ask_update_help` - Ask a natural-language question; returns ranked matches with full update bodies
- `terreno_bootstrap_ai_rules` - Scaffold AI assistant rules files for Cursor, Claude Code, etc.
- `terreno_generate_model` - Generate a Mongoose model with proper Terreno conventions
- `terreno_generate_route` - Generate a modelRouter route configuration
- `terreno_generate_screen` - Generate a React Native screen component
- `terreno_generate_form_fields` - Generate form field components
- `terreno_validate_model_schema` - Validate a Mongoose schema follows conventions
- `terreno_install_admin` - Generate admin panel integration files and instructions

Local runtime tools (`terreno-mcp-local`):

- `get_syncdb_state` - Inspect live SyncDB entities, outbox, conflicts, cursors,
  streams, repair markers, status, and debugger events
- `syncdb_snapshot` - Capture, list, read, compare, and delete SyncDB snapshots
- `syncdb_action` - Mutate/edit local state, flush, reconcile/resync,
  resolve/retry, toggle offline mode, clear events, and merge snapshots

Create the SyncDB client with `debug: true`. State changes require
`TERRENO_MCP_EVAL=1`; reads and snapshots do not.

### Prompts

Code generation prompts:

- `terreno_bootstrap` - Prompt workflow for scaffolding a new Terreno application
- `terreno_create_crud_feature` - Generate complete CRUD feature (model, routes, screens)
- `terreno_create_api_endpoint` - Generate custom API endpoint with OpenAPI docs
- `terreno_create_ui_component` - Generate reusable UI component
- `terreno_create_form_screen` - Generate form screen with validation
- `terreno_add_authentication` - Generate authentication setup
- `terreno_migrate_to_terreno_app` - Migrate from setupServer to TerrenoApp pattern
- `terreno_style_guide` - Get the Terreno code style guide
- `terreno_upgrade` - Lockstep Terreno upgrade workflow

## Install

```bash
# From the monorepo root
bun install
bun run mcp:build
```

## Usage

### With Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "terreno": {
      "command": "bun",
      "args": ["/path/to/terreno/mcp-server/dist/index.js"]
    }
  }
}
```

### With Claude Code CLI

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "terreno": {
      "command": "bun",
      "args": ["./mcp-server/dist/index.js"]
    }
  }
}
```

### Update help (optional)

When `TERRENO_HELP_API_URL` points at a Terreno backend with `AnnouncementsApp({help: {enabled: true}})`, the update-note tools also search live product announcements (published by default; pass `includeArchived: true` for archived notes). Set `TERRENO_HELP_API_TOKEN` when the help routes require authentication.

## Development

```bash
# Build
bun run build

# Watch mode
bun run dev

# Start server
bun run start

# Run tests
bun run test

# Lint
bun run lint
```

## Docker

Build and run the MCP server in Docker:

```bash
# Build the image
docker build -t terreno-mcp-server ./mcp-server

# Run the container
docker run --rm terreno-mcp-server
```

## CI/CD

The MCP server includes GitHub Actions workflows:

### CI Workflow (`.github/workflows/mcp-server-ci.yml`)
- Runs on every push/PR to `mcp-server/**`
- Lints, builds, and tests the code
- Builds Docker image to verify it works

### Deploy Workflow (`.github/workflows/mcp-server-deploy.yml`)
- Runs on push to `master`/`main` branch
- Deploys to Google Cloud Run

### Required GitHub Secrets for Deployment

Configure these secrets in your GitHub repository:

| Secret | Description |
|--------|-------------|
| `GCP_PROJECT_ID` | Your Google Cloud project ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Federation provider |
| `GCP_SERVICE_ACCOUNT` | Service account email for deployment |
| `GCP_ARTIFACT_REGISTRY` | Artifact Registry repository name |

### Setting up GCP for Deployment

1. Create an Artifact Registry repository:
   ```bash
   gcloud artifacts repositories create terreno \
     --repository-format=docker \
     --location=us-central1
   ```

2. Set up Workload Identity Federation for GitHub Actions:
   ```bash
   # Create workload identity pool
   gcloud iam workload-identity-pools create "github" \
     --location="global" \
     --display-name="GitHub Actions"

   # Create provider
   gcloud iam workload-identity-pools providers create-oidc "github" \
     --location="global" \
     --workload-identity-pool="github" \
     --display-name="GitHub" \
     --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
     --issuer-uri="https://token.actions.githubusercontent.com"
   ```

3. Grant permissions to the service account:
   ```bash
   # Cloud Run deployment
   gcloud projects add-iam-policy-binding PROJECT_ID \
     --member="serviceAccount:SA_EMAIL" \
     --role="roles/run.admin"

   # Artifact Registry push
   gcloud artifacts repositories add-iam-policy-binding terreno \
     --location=us-central1 \
     --member="serviceAccount:SA_EMAIL" \
     --role="roles/artifactregistry.writer"
   ```

## How Tools Work

**Important**: MCP tools return generated code as text content. They do not create files directly. When using these tools with an AI assistant (like Claude in Cursor), the assistant should:

1. Call the appropriate tool to generate code
2. Take the returned code text and write it to the appropriate file in your project
3. Follow up with any necessary steps (registering routes, regenerating SDK, etc.)

This design allows the AI assistant to:
- Review and adapt the generated code to your project structure
- Make any necessary modifications before writing
- Handle file paths based on your project's conventions

## Example Tool Usage

### Generate a Model

```json
{
  "name": "terreno_generate_model",
  "arguments": {
    "name": "Product",
    "fields": [
      { "name": "title", "type": "String", "required": true },
      { "name": "price", "type": "Number", "required": true },
      { "name": "active", "type": "Boolean", "default": "true" }
    ],
    "hasOwner": true,
    "softDelete": true
  }
}
```

The tool returns TypeScript code that should be written to `backend/src/models/product.ts` (or your project's model directory).

### Generate a Route

```json
{
  "name": "terreno_generate_route",
  "arguments": {
    "modelName": "Product",
    "routePath": "/products",
    "permissions": {
      "create": "authenticated",
      "list": "any",
      "read": "any",
      "update": "owner",
      "delete": "admin"
    },
    "queryFields": ["active", "category"],
    "ownerFiltered": true,
    "sort": "-created"
  }
}
```

The tool returns route configuration code that should be written to `backend/src/api/product.ts`, then exported from `backend/src/api/index.ts` and registered in your server setup.

### Generate a Screen

```json
{
  "name": "terreno_generate_screen",
  "arguments": {
    "name": "ProductList",
    "type": "list",
    "modelName": "Product",
    "fields": ["title", "price"]
  }
}
```

The tool returns React Native screen code that should be written to `frontend/src/screens/ProductListScreen.tsx` (or your project's screen directory).

## Example Prompt Usage

### Create CRUD Feature

```
Prompt: terreno_create_crud_feature
Arguments:
  - name: "Product"
  - fields: "title:string,price:number,description:string,active:boolean"
  - hasOwner: "yes"
```

This will generate a comprehensive prompt with instructions for creating:
- Backend model with proper schema
- API routes with permissions
- Frontend list, detail, and form screens

## Documentation

Full API reference: [docs/reference/mcp-server.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/mcp-server.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
