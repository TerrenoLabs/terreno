import {readFileSync} from "node:fs";
import {join} from "node:path";
import {bootstrapPrompts, handleBootstrapPromptRequest} from "./bootstrap.js";
import {getDocsRoot} from "./docsRoot.js";

const loadMarkdown = (filename: string): string => {
  const filePath = join(getDocsRoot(), "prompts", filename);
  return readFileSync(filePath, "utf-8");
};

interface Prompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

export const prompts: Prompt[] = [
  ...bootstrapPrompts,
  {
    arguments: [
      {
        description: "The feature/model name (e.g., 'Product', 'Order')",
        name: "name",
        required: true,
      },
      {
        description:
          "Comma-separated list of fields with types (e.g., 'title:string,price:number,active:boolean')",
        name: "fields",
        required: true,
      },
      {
        description: "Whether to add owner relationship (yes/no)",
        name: "hasOwner",
        required: false,
      },
    ],
    description:
      "Generate a complete CRUD feature including model, routes, and frontend screens for Terreno",
    name: "terreno_create_crud_feature",
  },
  {
    arguments: [
      {
        description: "The endpoint path (e.g., '/users/:id/verify')",
        name: "path",
        required: true,
      },
      {
        description: "HTTP method (GET, POST, PUT, PATCH, DELETE)",
        name: "method",
        required: true,
      },
      {
        description: "What the endpoint does",
        name: "description",
        required: true,
      },
    ],
    description: "Generate a custom API endpoint with OpenAPI documentation for @terreno/api",
    name: "terreno_create_api_endpoint",
  },
  {
    arguments: [
      {
        description: "Component name (e.g., 'UserCard', 'PriceTag')",
        name: "name",
        required: true,
      },
      {
        description: "Component type: display, interactive, form, layout",
        name: "type",
        required: true,
      },
    ],
    description: "Generate a reusable UI component using @terreno/ui patterns",
    name: "terreno_create_ui_component",
  },
  {
    arguments: [
      {
        description: "Screen name (e.g., 'CreateProduct', 'EditProfile')",
        name: "name",
        required: true,
      },
      {
        description:
          "Comma-separated list of form fields (e.g., 'name:text,email:email,bio:textarea')",
        name: "fields",
        required: true,
      },
      {
        description: "API endpoint name (e.g., 'createProduct', 'updateUser')",
        name: "endpoint",
        required: true,
      },
    ],
    description: "Generate a form screen with validation using @terreno/ui and @terreno/syncdb",
    name: "terreno_create_form_screen",
  },
  {
    arguments: [
      {
        description: "Comma-separated auth features: email,social,passwordReset",
        name: "features",
        required: false,
      },
    ],
    description:
      "Generate authentication setup including login/signup screens and auth state management",
    name: "terreno_add_authentication",
  },
  {
    arguments: [],
    description: "Get the Terreno code style guide and best practices for writing code",
    name: "terreno_style_guide",
  },
  {
    arguments: [
      {
        description:
          "Path to the server file to migrate (e.g., 'src/server.ts'). If not provided, general guidance is given.",
        name: "serverFile",
        required: false,
      },
    ],
    description:
      "Guide migration from the legacy setupServer function to the new TerrenoApp builder API with plugin support",
    name: "terreno_migrate_to_terreno_app",
  },
  {
    arguments: [
      {
        description:
          "Target @terreno/* semver to upgrade toward (optional; omit to mean latest stable)",
        name: "targetVersion",
        required: false,
      },
    ],
    description:
      "Lockstep Terreno upgrade workflow: read bundled upgrade notes, bump @terreno/* packages, run tests, and delegate Expo SDK steps to the official upgrading-expo skill",
    name: "terreno_upgrade",
  },
];

const createCrudFeaturePrompt = (args: {
  name: string;
  fields: string;
  hasOwner?: string;
}): string => {
  const {name, fields, hasOwner} = args;
  const hasOwnerBool = hasOwner?.toLowerCase() === "yes";

  const parsedFields = fields.split(",").map((f) => {
    const [fieldName, fieldType] = f.trim().split(":");
    return {name: fieldName, type: fieldType || "string"};
  });

  const fieldsList = parsedFields.map((f) => `- ${f.name}: ${f.type}`).join("\n");

  return `Generate a complete CRUD feature for "${name}" with the following specifications:

## Model Fields
${fieldsList}
${hasOwnerBool ? "- ownerId: ObjectId (reference to User, required)" : ""}

## Requirements

### Backend (using @terreno/api)

1. **Model File** (\`models/${name.toLowerCase()}.ts\`):
   - Create Mongoose schema with proper TypeScript interfaces
   - Use \`strict: "throw"\` and virtuals configuration
   - Add \`addDefaultPlugins()\` for timestamps
   ${hasOwnerBool ? "- Include ownerId field with User reference" : ""}

2. **Routes File** (\`routes/${name.toLowerCase()}.ts\`):
   - Use \`modelRouter\` for CRUD operations
   - Configure appropriate permissions:
     ${hasOwnerBool ? "- Use Permissions.IsOwner for read/update/delete" : "- Use Permissions.IsAuthenticated"}
     ${hasOwnerBool ? "- Add OwnerQueryFilter for list queries" : ""}
     ${hasOwnerBool ? "- Add preCreate hook to set ownerId" : ""}
   - Add queryFields for filterable fields
   - Set default sort order

### Frontend (using @terreno/syncdb and @terreno/ui)

3. **List Screen** (\`screens/${name}ListScreen.tsx\`):
   - Use \`useQuery\` / \`useEntityIds\` from \`@terreno/syncdb/react\` (not request hooks from \`@/store/apiSdk\`)
   - Handle sync status with \`useSyncStatus\` instead of request loading spinners
   - Display items in a scrollable list

4. **Detail Screen** (\`screens/${name}DetailScreen.tsx\`):
   - Use \`useEntity\` with id parameter
   - Display all fields
   - Use \`useMutate\` for update/delete

5. **Form Screen** (\`screens/${name}FormScreen.tsx\`):
   - Create/Edit form with all fields
   - Client-side validation
   - Use \`useMutate\` \`create\` / \`update\` (local-first — no mutation loading spinners)
   - Handle conflicts with \`useConflicts\` when the server rejects a write

## Code Style Requirements
- Use const arrow functions
- Use Luxon for dates
- Use interfaces (not types)
- Named exports
- RORO pattern for complex functions
- Early returns for error handling
- Wrap callbacks with useCallback`;
};

const createApiEndpointPrompt = (args: {
  path: string;
  method: string;
  description: string;
}): string => {
  const {path, method, description} = args;

  return `Generate a custom API endpoint for @terreno/api with the following specifications:

## Endpoint Details
- **Path**: ${path}
- **Method**: ${method.toUpperCase()}
- **Description**: ${description}

## Requirements

1. **OpenAPI Documentation**:
   - Use \`createOpenApiBuilder()\` for route documentation
   - Add appropriate tags, summary, and description
   - Document request body schema (if applicable)
   - Document query parameters (if applicable)
   - Document response schema with status codes

2. **Route Handler**:
   - Use async/await with proper error handling
   - Validate request data
   - Use \`APIError\` for error responses
   - Return appropriate HTTP status codes

3. **Authentication** (if needed):
   - Use \`authenticateMiddleware\` for protected routes
   - Check permissions as needed

## Example Structure

\`\`\`typescript
import { Router } from "express";
import { createOpenApiBuilder, APIError, authenticateMiddleware } from "@terreno/api";

const builder = createOpenApiBuilder()
  .withTags(["YourTag"])
  .withSummary("${description}")
  .withDescription("Detailed description here")
  // Add parameters, request body, responses as needed
  ;

router.${method.toLowerCase()}(
  "${path}",
  authenticateMiddleware, // if needed
  builder.build(),
  async (req, res, next) => {
    try {
      // Implementation here

      res.json({ /* response */ });
    } catch (error) {
      next(error);
    }
  }
);
\`\`\`

## Code Style
- Use const arrow functions
- Early returns for validation
- Proper TypeScript types
- Throw APIError with appropriate status, title, detail`;
};

const createUiComponentPrompt = (args: {name: string; type: string}): string => {
  const {name, type} = args;

  const typeGuide: Record<string, string> = {
    display: `Display components show data without user interaction.

Example patterns:
- Card layouts with Box, Text, and Image
- Status badges with conditional styling
- Data visualization with themed colors`,

    form: `Form components handle user input.

Example patterns:
- Controlled inputs with value/onChange
- Validation with error prop
- Label and helper text support`,

    interactive: `Interactive components handle user actions.

Example patterns:
- Button with variants and loading states
- Pressable areas with feedback
- Toggles and switches`,

    layout: `Layout components structure content.

Example patterns:
- Container with padding/margin
- Flex layouts with direction/gap
- Responsive wrappers with MediaQuery`,
  };

  return `Generate a reusable UI component for @terreno/ui with the following specifications:

## Component Details
- **Name**: ${name}
- **Type**: ${type}

## ${type.charAt(0).toUpperCase() + type.slice(1)} Component Guidelines
${typeGuide[type] || "Follow standard component patterns."}

## Requirements

1. **Component Structure**:
   - Use \`React.FC\` with explicit props interface
   - Export named component and props interface
   - Use @terreno/ui primitives (Box, Text, Button, etc.)

2. **Styling**:
   - Use theme values from \`useTheme()\`
   - Use spacing scale (0-12) for padding/margin
   - Use color tokens (primary500, neutral600, etc.)

3. **TypeScript**:
   - Define props interface with JSDoc comments
   - Use proper types for callbacks
   - Export component and types

4. **Performance**:
   - Wrap callbacks with \`useCallback\`
   - Use \`useMemo\` for expensive computations
   - Avoid inline object styles where possible

## Template

\`\`\`typescript
import React, { useCallback } from "react";
import { Box, Text } from "@terreno/ui";

interface ${name}Props {
  /** Primary content to display */
  children?: React.ReactNode;
  /** Optional callback when component is pressed */
  onPress?: () => void;
}

export const ${name}: React.FC<${name}Props> = ({ children, onPress }) => {
  const handlePress = useCallback(() => {
    onPress?.();
  }, [onPress]);

  return (
    <Box padding={3} backgroundColor="neutral100" borderRadius="md">
      {children}
    </Box>
  );
};
\`\`\`

## Code Style
- Use const arrow functions
- Named exports
- Explicit return types
- camelCase for props`;
};

const createFormScreenPrompt = (args: {name: string; fields: string; endpoint: string}): string => {
  const {name, fields, endpoint} = args;

  const parsedFields = fields.split(",").map((f) => {
    const [fieldName, fieldType] = f.trim().split(":");
    return {name: fieldName, type: fieldType || "text"};
  });

  const fieldsList = parsedFields.map((f) => `- ${f.name}: ${f.type}`).join("\n");

  const componentMap: Record<string, string> = {
    boolean: "BooleanField",
    date: "DateTimeField",
    email: "EmailField",
    number: "NumberField",
    password: "PasswordField",
    select: "SelectField",
    text: "TextField",
    textarea: "TextArea",
  };

  const components = [...new Set(parsedFields.map((f) => componentMap[f.type] || "TextField"))];

  return `Generate a form screen using @terreno/ui with the following specifications:

## Screen Details
- **Name**: ${name}Screen
- **API Endpoint**: use${endpoint.charAt(0).toUpperCase() + endpoint.slice(1)}Mutation

## Form Fields
${fieldsList}

## Required Imports
\`\`\`typescript
import { ${components.join(", ")}, Box, Page, Button } from "@terreno/ui";
import { use${endpoint.charAt(0).toUpperCase() + endpoint.slice(1)}Mutation } from "@/store/apiSdk";
\`\`\`

## Requirements

1. **State Management**:
   - useState for each form field
   - useState for errors object
   - Type-safe error interface

2. **Validation**:
   - Validate required fields
   - Email format validation for email fields
   - Clear validation on field change

3. **Form Submission**:
   - Validate before submitting
   - Use mutation with .unwrap()
   - Handle API errors (extract field errors)
   - Show loading state on submit button

4. **Error Display**:
   - Show field-specific errors
   - Handle general API errors

## Example Structure

\`\`\`typescript
import React, { useCallback, useState } from "react";
import { Box, Page, Button, ${components.join(", ")} } from "@terreno/ui";
import { use${endpoint.charAt(0).toUpperCase() + endpoint.slice(1)}Mutation } from "@/store/apiSdk";

interface FormErrors {
  ${parsedFields.map((f) => `${f.name}?: string;`).join("\n  ")}
}

const ${name}Screen: React.FC = () => {
  ${parsedFields.map((f) => `const [${f.name}, set${f.name.charAt(0).toUpperCase() + f.name.slice(1)}] = useState(${f.type === "boolean" ? "false" : f.type === "number" ? "0" : '""'});`).join("\n  ")}
  const [errors, setErrors] = useState<FormErrors>({});
  const [${endpoint}, { isLoading }] = use${endpoint.charAt(0).toUpperCase() + endpoint.slice(1)}Mutation();

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};
    // Add validation logic
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [/* dependencies */]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;

    try {
      await ${endpoint}({ /* fields */ }).unwrap();
      // Success handling
    } catch (err: unknown) {
      const apiError = err as {data?: {fields?: FormErrors}};
      if (apiError.data?.fields) {
        setErrors(apiError.data.fields);
      }
    }
  }, [validate, ${endpoint}]);

  return (
    <Page navigation={undefined} title="${name}">
      <Box padding={4} gap={3}>
        {/* Form fields here */}
        <Button text="Submit" onClick={handleSubmit} loading={isLoading} fullWidth />
      </Box>
    </Page>
  );
};

export default ${name}Screen;
\`\`\``;
};

const addAuthenticationPrompt = (args: {features?: string}): string => {
  const features = args.features?.split(",").map((f) => f.trim()) || ["email"];

  return `Generate authentication setup for a Terreno application with the following features:

## Features
${features.map((f) => `- ${f}`).join("\n")}

## Backend Setup (@terreno/api)

1. **User Model** (\`models/user.ts\`):
   - Add \`betterAuthId\` for Better Auth account linkage
   - Add baseUserPlugin for standard fields
   - Include email, name, and admin fields

2. **Better Auth Configuration** (\`utils/betterAuthConfig.ts\`):
   - Export \`createBetterAuth\` with email/password enabled
   - Set \`trustedOrigins\` from \`getWebOrigins()\`
   - Read \`BETTER_AUTH_SECRET\` and \`BETTER_AUTH_URL\` from environment

3. **Server wiring** (\`server.ts\`):
   - Register \`BetterAuthApp\` with \`createBetterAuth\`
   - Set \`AUTH_PROVIDER=better-auth\` in \`.env\`
   - Use a MongoDB replica set (\`MONGO_URI\` with \`replicaSet=rs0\`) for change streams
   ${features.includes("passwordReset") ? "- Enable Better Auth password reset in the auth config" : ""}

## Frontend Setup (@terreno/syncdb for session, requests, and data; @terreno/ui)

4. **Session and clients** (no Redux store):
   - \`lib/betterAuth.ts\`: \`createBetterAuthClient\` from \`@terreno/syncdb/auth\` with \`baseUrl\` from \`@terreno/syncdb/config\`
   - \`store/syncdb.ts\`: \`authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient))\` and \`createSyncDb\`
   - \`store/apiClient.ts\`: \`createApiClient({authProvider, baseUrl, headers: appHeaders})\` for non-synced routes
   - \`app/_layout.tsx\`: \`<ApiClientProvider client={apiClient}>\` + \`<SessionProvider authClient={betterAuthClient} syncDbs={[syncDb]} onLogout={apiClient.reset}>\`

5. **Login Screen** (\`app/login.tsx\`):
   - Email and password fields only (no name field on login)
   - \`betterAuthClient.signIn.email\` on submit
   - \`onSignUpPress\` navigates to a separate signup screen

6. **Signup Screen** (\`app/signup.tsx\`):
   - Name, email, password fields via \`SignUpScreen\`
   - \`betterAuthClient.signUp.email\` on submit
   - \`onLoginPress\` navigates back to login

${
  features.includes("passwordReset")
    ? `7. **Password Reset**:
   - Forgot password screen with email input
   - Reset password screen with token validation via Better Auth`
    : ""
}

## Auth State Management

\`\`\`typescript
import {useSession} from "@terreno/syncdb/auth";
import {betterAuthClient} from "@/lib/betterAuth";

// Check authentication (inside a component under <SessionProvider>)
const {userId, isAuthenticated, isLoading, refresh, logout} = useSession();

// Sign in, then resolve the new session immediately
const result = await betterAuthClient.signIn.email({ email, password });
await refresh();

// Sign out: Better Auth sign-out, syncDb sign-out, and onLogout cleanup
await logout();
\`\`\`

## Protected Routes

\`\`\`typescript
// In app navigation
if (!isAuthenticated) {
  return <Navigate to="/login" />;
}
\`\`\``;
};

const styleGuidePrompt = (): string => {
  return loadMarkdown("style-guide.md");
};

const migrateToTerrenoAppPrompt = (args: {serverFile?: string}): string => {
  const guide = loadMarkdown("migrate-to-terreno-app.md");

  if (args.serverFile) {
    return `${guide}

---

## Your Task

Migrate the server file at \`${args.serverFile}\` from \`setupServer\` to \`TerrenoApp\`.

1. Read the file at \`${args.serverFile}\`
2. Identify all setupServer usage, addRoutes callbacks, addMiddleware callbacks, and environment variable dependencies
3. Rewrite the file using TerrenoApp.create() with fluent API calls
4. Add \`@terreno/api-health\` HealthApp plugin if a health endpoint is needed
5. Configure graceful shutdown
6. Update imports
7. Run through the migration checklist above to verify completeness`;
  }

  return guide;
};

const terrenoUpgradePrompt = (args: {targetVersion?: string}): string => {
  const target = args.targetVersion?.trim();
  const targetLine = target
    ? `Target Terreno semver: **${target}** (bump all @terreno/* packages together).`
    : "Target: **latest** published @terreno/* versions (keep lockstep).";

  return `You are upgrading a Terreno application (${targetLine})

Execute the **upgrading-terreno** skill (source: \`.rulesync/skills/upgrading-terreno/SKILL.md\`). Do not invent a second ordering. The skill's ten steps and \`references/ordering.md\` are authoritative.

## Discovery (agents without skill support)

1. Refuse unless the git tree is clean and you are not on \`master\`/\`main\`.
2. Call \`terreno_get_upgrade_guide\` with \`fromVersion\` = installed lockstep semver and \`toVersion\` = target.
3. Print versions, notes, packages, and the skill's step list; stop for confirmation before mutating.
4. Follow \`docs/how-to/upgrade-terreno.md\`. At the Expo phase invoke **upgrading-expo** by name.
5. On failure report succeeded/failed/rollback (\`git reset --hard\` on this branch). Multi-version jumps retry one version at a time.

Do not continue past a failed compile or test run.`;
};

export const handlePromptRequest = (
  name: string,
  args: Record<string, string>
): {messages: Array<{role: "user"; content: {type: "text"; text: string}}>} => {
  // Handle bootstrap prompts
  if (name === "terreno_bootstrap") {
    return handleBootstrapPromptRequest(name, args);
  }

  let content: string;

  switch (name) {
    case "terreno_create_crud_feature":
      content = createCrudFeaturePrompt(args as Parameters<typeof createCrudFeaturePrompt>[0]);
      break;
    case "terreno_create_api_endpoint":
      content = createApiEndpointPrompt(args as Parameters<typeof createApiEndpointPrompt>[0]);
      break;
    case "terreno_create_ui_component":
      content = createUiComponentPrompt(args as Parameters<typeof createUiComponentPrompt>[0]);
      break;
    case "terreno_create_form_screen":
      content = createFormScreenPrompt(args as Parameters<typeof createFormScreenPrompt>[0]);
      break;
    case "terreno_add_authentication":
      content = addAuthenticationPrompt(args as Parameters<typeof addAuthenticationPrompt>[0]);
      break;
    case "terreno_style_guide":
      content = styleGuidePrompt();
      break;
    case "terreno_migrate_to_terreno_app":
      content = migrateToTerrenoAppPrompt(args as Parameters<typeof migrateToTerrenoAppPrompt>[0]);
      break;
    case "terreno_upgrade":
      content = terrenoUpgradePrompt(args as Parameters<typeof terrenoUpgradePrompt>[0]);
      break;
    default:
      content = `Unknown prompt: ${name}`;
  }

  return {
    messages: [
      {
        content: {
          text: content,
          type: "text",
        },
        role: "user",
      },
    ],
  };
};
