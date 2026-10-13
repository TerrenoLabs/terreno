import type {Tool} from "@modelcontextprotocol/server";
import {type BlockError, parseBlocks, validateBlocks} from "@terreno/blocks";
import {bootstrapTools, handleBootstrapToolCall} from "./bootstrap.js";
import {askUpdateHelp, getUpdateNote, searchUpdateNotes} from "./help/updateNotes.js";
import {getComponentDocsMarkdown, searchDocs} from "./search/docIndex.js";
import {getUpgradeGuideMarkdown} from "./upgradeGuide.js";

const docSearchTools: Tool[] = [
  {
    description:
      "Search Terreno documentation (Diátaxis docs, bundled package guides, and @terreno/ui component props) with BM25-style keyword search. **Call this before guessing** modelRouter, OpenAPI, RTK Query, or UI APIs — same workflow as Laravel Boost search-docs.",
    inputSchema: {
      properties: {
        packages: {
          description:
            'Optional filter: short names or npm scopes, e.g. ["api", "@terreno/ui"]. Matches chunks tagged for those packages.',
          items: {type: "string"},
          type: "array",
        },
        queries: {
          description:
            'One or more search phrases (multiple angles help, e.g. ["toggle", "switch field"]).',
          items: {type: "string"},
          type: "array",
        },
        tokenLimit: {
          description: "Approximate max tokens of markdown to return (default 3000, hard-capped).",
          type: "number",
        },
        version: {
          description:
            "Optional @terreno/* lockstep version (e.g. 57.2.0). Omit for current `next` docs. Unmatched versions fall back to the nearest retained snapshot.",
          type: "string",
        },
      },
      required: ["queries"],
      type: "object",
    },
    name: "terreno_search_docs",
  },
  {
    description:
      "Return the full props table for one @terreno/ui component from ui-types-documentation.json, plus short related markdown excerpts when available.",
    inputSchema: {
      properties: {
        component: {
          description: 'Component name as exported by @terreno/ui, e.g. "Button", "TextField".',
          type: "string",
        },
        version: {
          description:
            "Optional @terreno/* lockstep version (e.g. 57.2.0). Omit for current TypeDoc props. Unmatched versions fall back to the nearest retained snapshot.",
          type: "string",
        },
      },
      required: ["component"],
      type: "object",
    },
    name: "terreno_get_component_docs",
  },
  {
    description:
      "Return bundled Terreno lockstep upgrade notes between two semver versions (markdown). Use before major bumps to @terreno/* packages.",
    inputSchema: {
      properties: {
        fromVersion: {
          description: "Installed @terreno/* semver (e.g. 0.19.0)",
          type: "string",
        },
        toVersion: {
          description: "Target semver to upgrade to (e.g. 0.20.0)",
          type: "string",
        },
      },
      required: ["fromVersion", "toVersion"],
      type: "object",
    },
    name: "terreno_get_upgrade_guide",
  },
];

const helpTools: Tool[] = [
  {
    description:
      "Search Terreno update notes: bundled @terreno/* upgrade markdown and, when TERRENO_HELP_API_URL is set, product announcements from a Terreno backend help API. Use before answering what changed in a release.",
    inputSchema: {
      properties: {
        includeArchived: {
          description:
            "When true, include archived announcement notes from the help API (published-only by default).",
          type: "boolean",
        },
        limit: {
          description: "Maximum number of matches to return (default 10).",
          type: "number",
        },
        queries: {
          description: 'Keyword phrases, e.g. ["billing", "syncdb offline"].',
          items: {type: "string"},
          type: "array",
        },
        question: {
          description: "Optional natural-language question; treated as an extra search phrase.",
          type: "string",
        },
        source: {
          description: 'Where to search: "auto" (default), "bundled", or "announcement".',
          enum: ["auto", "bundled", "announcement"],
          type: "string",
        },
      },
      type: "object",
    },
    name: "terreno_search_update_notes",
  },
  {
    description:
      "Return the full text of one update note by id (upgrade:57.3.0 or announcement:<mongoId>) or upgrade semver.",
    inputSchema: {
      properties: {
        id: {
          description: 'Update id from terreno_search_update_notes, e.g. "upgrade:57.3.0".',
          type: "string",
        },
        includeArchived: {
          description: "Allow archived announcement notes when fetching from the help API.",
          type: "boolean",
        },
      },
      required: ["id"],
      type: "object",
    },
    name: "terreno_get_update_note",
  },
  {
    description:
      "Ask a natural-language question against update notes; returns ranked excerpts and ids to fetch with terreno_get_update_note.",
    inputSchema: {
      properties: {
        includeArchived: {
          description: "Include archived announcement notes when the help API is configured.",
          type: "boolean",
        },
        limit: {
          description: "Maximum matches to include in the answer (default 5).",
          type: "number",
        },
        question: {
          description: "Question about what changed, e.g. How do I migrate billing webhooks?",
          type: "string",
        },
      },
      required: ["question"],
      type: "object",
    },
    name: "terreno_ask_update_help",
  },
];

export const tools: Tool[] = [
  ...bootstrapTools,
  ...docSearchTools,
  ...helpTools,
  {
    description:
      "Generate a Mongoose model with proper Terreno conventions including schema, interfaces, and plugins",
    inputSchema: {
      properties: {
        fields: {
          description: "Array of field definitions",
          items: {
            properties: {
              default: {
                description: "Default value (as string)",
                type: "string",
              },
              name: {description: "Field name", type: "string"},
              ref: {
                description: "Reference model name for ObjectId fields",
                type: "string",
              },
              required: {description: "Is the field required?", type: "boolean"},
              type: {
                description: "Field type: String, Number, Boolean, Date, ObjectId, Array, Mixed",
                type: "string",
              },
              unique: {description: "Is the field unique?", type: "boolean"},
            },
            required: ["name", "type"],
            type: "object",
          },
          type: "array",
        },
        hasOwner: {
          description: "Add ownerId field referencing User model",
          type: "boolean",
        },
        name: {
          description: "The model name (e.g., 'Todo', 'User', 'Product')",
          type: "string",
        },
        softDelete: {
          description: "Enable soft delete with isDeleted field",
          type: "boolean",
        },
      },
      required: ["name", "fields"],
      type: "object",
    },
    name: "terreno_generate_model",
  },
  {
    description:
      "Generate a modelRouter route configuration for a Mongoose model. For non-CRUD operations, add instanceActions (/:id/action) or collectionActions (/action) with Zod schemas — see docs/explanation/model-router-actions.md",
    inputSchema: {
      properties: {
        modelName: {
          description: "The model name (e.g., 'Todo')",
          type: "string",
        },
        ownerFiltered: {
          description: "Filter queries by owner",
          type: "boolean",
        },
        permissions: {
          description: "Permission configuration",
          properties: {
            create: {description: "Permission for create", type: "string"},
            delete: {description: "Permission for delete", type: "string"},
            list: {description: "Permission for list", type: "string"},
            read: {description: "Permission for read", type: "string"},
            update: {description: "Permission for update", type: "string"},
          },
          type: "object",
        },
        queryFields: {
          description: "Fields allowed in query filters",
          items: {type: "string"},
          type: "array",
        },
        routePath: {
          description: "The route path (e.g., '/todos')",
          type: "string",
        },
        sort: {
          description: "Default sort field (prefix with - for descending)",
          type: "string",
        },
      },
      required: ["modelName", "routePath"],
      type: "object",
    },
    name: "terreno_generate_route",
  },
  {
    description: "Generate a React Native screen component using @terreno/ui components",
    inputSchema: {
      properties: {
        fields: {
          description: "Fields to display or edit",
          items: {type: "string"},
          type: "array",
        },
        modelName: {
          description: "Model name for data fetching (e.g., 'Todo')",
          type: "string",
        },
        name: {
          description: "Screen name (e.g., 'TodoList', 'UserProfile')",
          type: "string",
        },
        type: {
          description: "Type of screen to generate",
          enum: ["list", "detail", "form", "empty"],
          type: "string",
        },
      },
      required: ["name", "type"],
      type: "object",
    },
    name: "terreno_generate_screen",
  },
  {
    description: "Generate form field components for a data model",
    inputSchema: {
      properties: {
        fields: {
          description: "Array of field definitions",
          items: {
            properties: {
              label: {description: "Display label", type: "string"},
              name: {description: "Field name", type: "string"},
              options: {
                description: "Options for select fields",
                items: {
                  properties: {
                    label: {type: "string"},
                    value: {type: "string"},
                  },
                  type: "object",
                },
                type: "array",
              },
              required: {description: "Is field required?", type: "boolean"},
              type: {
                description: "Field type for form input",
                enum: [
                  "text",
                  "email",
                  "password",
                  "number",
                  "textarea",
                  "select",
                  "boolean",
                  "date",
                  "datetime",
                ],
                type: "string",
              },
            },
            required: ["name", "type"],
            type: "object",
          },
          type: "array",
        },
      },
      required: ["fields"],
      type: "object",
    },
    name: "terreno_generate_form_fields",
  },
  {
    description: "Validate a Mongoose schema follows Terreno conventions",
    inputSchema: {
      properties: {
        schema: {
          description: "The schema code to validate",
          type: "string",
        },
      },
      required: ["schema"],
      type: "object",
    },
    name: "terreno_validate_model_schema",
  },
  {
    description:
      "Validate a whole-reply UI block document. Returns the same report as terreno-blocks validate.",
    inputSchema: {
      properties: {
        document: {
          description: "Whole-reply YAML or JSON block document",
          type: "string",
        },
      },
      required: ["document"],
      type: "object",
    },
    name: "terreno_validate_ui_blocks",
  },
  {
    description:
      "Generate admin panel integration files and instructions for a Terreno project. Creates frontend screen files and provides backend/frontend setup snippets for @terreno/admin-backend and @terreno/admin-frontend.",
    inputSchema: {
      properties: {
        models: {
          description: "Array of model configurations for the admin panel",
          items: {
            properties: {
              displayName: {
                description: "Human-readable display name (e.g., 'Todos')",
                type: "string",
              },
              listFields: {
                description:
                  "Fields to show in the admin list table (e.g., ['title', 'completed', 'created'])",
                items: {type: "string"},
                type: "array",
              },
              modelName: {
                description: "The Mongoose model name (e.g., 'Todo')",
                type: "string",
              },
              routePath: {
                description: "The route path for this model (e.g., '/todos')",
                type: "string",
              },
            },
            required: ["modelName", "routePath", "displayName", "listFields"],
            type: "object",
          },
          type: "array",
        },
      },
      required: ["models"],
      type: "object",
    },
    name: "terreno_install_admin",
  },
];

export const generateModel = (args: {
  name: string;
  fields: Array<{
    name: string;
    type: string;
    required?: boolean;
    unique?: boolean;
    ref?: string;
    default?: string;
  }>;
  hasOwner?: boolean;
  softDelete?: boolean;
}): string => {
  const {name, fields, hasOwner, softDelete} = args;
  const lowerName = name.toLowerCase();

  const interfaceFields = fields
    .map((f) => {
      let tsType = "string";
      if (f.type === "Number") tsType = "number";
      else if (f.type === "Boolean") tsType = "boolean";
      else if (f.type === "Date") tsType = "Date";
      else if (f.type === "ObjectId") tsType = "mongoose.Types.ObjectId";
      else if (f.type === "Array") tsType = "unknown[]";

      return `  ${f.name}${f.required ? "" : "?"}: ${tsType};`;
    })
    .join("\n");

  const schemaFields = fields
    .map((f) => {
      const props: string[] = [
        `type: ${f.type === "ObjectId" ? "mongoose.Schema.Types.ObjectId" : f.type}`,
      ];
      if (f.required) props.push("required: true");
      if (f.unique) props.push("unique: true");
      if (f.ref) props.push(`ref: "${f.ref}"`);
      if (f.default !== undefined) {
        props.push(`default: ${f.default}`);
      }
      if (f.type === "String") props.push("trim: true");

      return `    ${f.name}: { ${props.join(", ")} },`;
    })
    .join("\n");

  const ownerField = hasOwner
    ? `    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },\n`
    : "";

  const ownerInterface = hasOwner ? `  ownerId: mongoose.Types.ObjectId;\n` : "";

  const plugins = softDelete ? `\n${lowerName}Schema.plugin(isDeletedPlugin);` : "";

  return `import mongoose from "mongoose";
import { addDefaultPlugins${softDelete ? ", isDeletedPlugin" : ""} } from "@terreno/api";

interface ${name}Document extends mongoose.Document {
${interfaceFields}
${ownerInterface}  created: Date;
  updated: Date;
}

interface ${name}Model extends mongoose.Model<${name}Document> {
  // Add static methods here
}

const ${lowerName}Schema = new mongoose.Schema<${name}Document, ${name}Model>(
  {
${schemaFields}
${ownerField}  },
  {
    strict: "throw",
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addDefaultPlugins(${lowerName}Schema);${plugins}

export const ${name} = mongoose.model<${name}Document, ${name}Model>("${name}", ${lowerName}Schema);
export type { ${name}Document, ${name}Model };
`;
};

export const generateRoute = (args: {
  modelName: string;
  routePath: string;
  permissions?: {
    create?: string;
    list?: string;
    read?: string;
    update?: string;
    delete?: string;
  };
  queryFields?: string[];
  ownerFiltered?: boolean;
  sort?: string;
}): string => {
  const {modelName, routePath, permissions, queryFields, ownerFiltered, sort} = args;
  const lowerName = modelName.toLowerCase();

  const permMap: Record<string, string> = {
    admin: "Permissions.IsAdmin",
    any: "Permissions.IsAny",
    authenticated: "Permissions.IsAuthenticated",
    authOrReadOnly: "Permissions.IsAuthenticatedOrReadOnly",
    owner: "Permissions.IsOwner",
  };

  const getPerm = (p?: string) => permMap[p ?? "authenticated"] ?? "Permissions.IsAuthenticated";

  const permConfig = permissions
    ? `
      permissions: {
        create: [${getPerm(permissions.create)}],
        list: [${getPerm(permissions.list)}],
        read: [${getPerm(permissions.read)}],
        update: [${getPerm(permissions.update)}],
        delete: [${getPerm(permissions.delete)}],
      },
      // Or use RBAC: access: { resource: "${lowerName}" }, with TerrenoApp accessControl`
    : `
      permissions: {
        create: [Permissions.IsAuthenticated],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAuthenticated],
        delete: [Permissions.IsAuthenticated],
      },
      // Or use RBAC: access: { resource: "${lowerName}" }, with TerrenoApp accessControl`;

  const queryFieldsConfig = queryFields?.length
    ? `\n      queryFields: ${JSON.stringify(queryFields)},`
    : "";

  const ownerConfig = ownerFiltered
    ? `
      queryFilter: OwnerQueryFilter,
      preCreate: (body, req) => ({
        ...body,
        ownerId: (req.user as UserDocument)?._id,
      }),`
    : "";

  const sortConfig = sort ? `\n      sort: "${sort}",` : "";

  const imports = ownerFiltered
    ? `import { modelRouter, Permissions, OwnerQueryFilter } from "@terreno/api";
import { ${modelName}, ${modelName}Document } from "../models/${lowerName}";
import { UserDocument } from "../models/user";`
    : `import { modelRouter, Permissions } from "@terreno/api";
import { ${modelName} } from "../models/${lowerName}";`;

  return `import { Router } from "express";
${imports}

// Non-CRUD endpoints: use instanceActions (POST/GET /:id/actionName) or
// collectionActions (POST/GET /actionName) on modelRouter options. See
// docs/explanation/model-router-actions.md. Requires zod in the backend app.

export const add${modelName}Routes = (router: Router) => {
  router.use(
    "${routePath}",
    modelRouter(${modelName}, {${permConfig}${queryFieldsConfig}${ownerConfig}${sortConfig}
    })
  );
};
`;
};

export const generateScreen = (args: {
  name: string;
  type: "list" | "detail" | "form" | "empty";
  modelName?: string;
  fields?: string[];
}): string => {
  const {name, type, modelName, fields} = args;

  if (type === "empty") {
    return `import React from "react";
import { Box, Page, Text } from "@terreno/ui";

const ${name}Screen: React.FC = () => {
  return (
    <Page navigation={undefined} title="${name}">
      <Box padding={4}>
        <Text>Content goes here</Text>
      </Box>
    </Page>
  );
};

export default ${name}Screen;
`;
  }

  if (type === "list" && modelName) {
    const pluralLower = `${modelName.toLowerCase()}s`;
    return `import React, { useCallback } from "react";
import { Box, Page, Text, Button, ScrollView } from "@terreno/ui";
import { useGet${modelName}sQuery } from "@/store/openApiSdk";

const ${name}Screen: React.FC = () => {
  const { data: ${pluralLower}, isLoading, error, refetch } = useGet${modelName}sQuery({});

  if (isLoading) {
    return (
      <Page navigation={undefined} title="${name}">
        <Box flex={1} alignItems="center" justifyContent="center">
          <Text>Loading...</Text>
        </Box>
      </Page>
    );
  }

  if (error) {
    return (
      <Page navigation={undefined} title="${name}">
        <Box flex={1} alignItems="center" justifyContent="center" gap={2}>
          <Text color="error500">Failed to load data</Text>
          <Button text="Retry" onClick={refetch} />
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title="${name}">
      <ScrollView>
        <Box padding={4} gap={2}>
          {${pluralLower}?.map((item) => (
            <Box key={item.id} padding={3} backgroundColor="neutral100" borderRadius="md">
              <Text>{item.${fields?.[0] ?? "id"}}</Text>
            </Box>
          ))}
        </Box>
      </ScrollView>
    </Page>
  );
};

export default ${name}Screen;
`;
  }

  if (type === "form" && modelName) {
    const fieldStates = (fields ?? ["name"])
      .map((f) => `  const [${f}, set${f.charAt(0).toUpperCase() + f.slice(1)}] = useState("");`)
      .join("\n");

    const fieldInputs = (fields ?? ["name"])
      .map(
        (f) => `          <TextField
            label="${f.charAt(0).toUpperCase() + f.slice(1)}"
            value={${f}}
            onChangeText={set${f.charAt(0).toUpperCase() + f.slice(1)}}
            error={errors.${f}}
          />`
      )
      .join("\n");

    const bodyFields = (fields ?? ["name"]).map((f) => `${f}`).join(", ");

    return `import React, { useCallback, useState } from "react";
import { Box, Page, Button, TextField } from "@terreno/ui";
import { useCreate${modelName}Mutation } from "@/store/openApiSdk";

interface FormErrors {
  ${(fields ?? ["name"]).map((f) => `${f}?: string;`).join("\n  ")}
}

const ${name}Screen: React.FC = () => {
${fieldStates}
  const [errors, setErrors] = useState<FormErrors>({});
  const [create${modelName}, { isLoading }] = useCreate${modelName}Mutation();

  const handleSubmit = useCallback(async () => {
    const newErrors: FormErrors = {};
    ${(fields ?? ["name"]).map((f) => `if (!${f}.trim()) newErrors.${f} = "${f.charAt(0).toUpperCase() + f.slice(1)} is required";`).join("\n    ")}

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      await create${modelName}({ ${bodyFields} }).unwrap();
      // Success - navigate or show message
    } catch (err: unknown) {
      const apiError = err as {data?: {fields?: FormErrors}};
      if (apiError.data?.fields) {
        setErrors(apiError.data.fields);
      }
    }
  }, [${bodyFields}, create${modelName}]);

  return (
    <Page navigation={undefined} title="Create ${modelName}">
      <Box padding={4} gap={3}>
${fieldInputs}
        <Button
          text="Create"
          onClick={handleSubmit}
          loading={isLoading}
          fullWidth
        />
      </Box>
    </Page>
  );
};

export default ${name}Screen;
`;
  }

  if (type === "detail" && modelName) {
    return `import React from "react";
import { Box, Page, Text, Button, ScrollView } from "@terreno/ui";
import { useGet${modelName}Query } from "@/store/openApiSdk";
import { useLocalSearchParams } from "expo-router";

const ${name}Screen: React.FC = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item, isLoading, error, refetch } = useGet${modelName}Query({ id: id! }, { skip: !id });

  if (isLoading) {
    return (
      <Page navigation={undefined} title="${name}">
        <Box flex={1} alignItems="center" justifyContent="center">
          <Text>Loading...</Text>
        </Box>
      </Page>
    );
  }

  if (error || !item) {
    return (
      <Page navigation={undefined} title="${name}">
        <Box flex={1} alignItems="center" justifyContent="center" gap={2}>
          <Text color="error500">Failed to load data</Text>
          <Button text="Retry" onClick={refetch} />
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title="${name}">
      <ScrollView>
        <Box padding={4} gap={2}>
          ${(fields ?? ["id"]).map((f) => `<Text>{item.${f}}</Text>`).join("\n          ")}
        </Box>
      </ScrollView>
    </Page>
  );
};

export default ${name}Screen;
`;
  }

  return `// Screen type "${type}" not fully supported, using empty template
import React from "react";
import { Box, Page, Text } from "@terreno/ui";

const ${name}Screen: React.FC = () => {
  return (
    <Page navigation={undefined} title="${name}">
      <Box padding={4}>
        <Text>Content goes here</Text>
      </Box>
    </Page>
  );
};

export default ${name}Screen;
`;
};

export const generateFormFields = (args: {
  fields: Array<{
    name: string;
    type: string;
    label?: string;
    required?: boolean;
    options?: Array<{label: string; value: string}>;
  }>;
}): string => {
  const {fields} = args;

  const imports = new Set(["Box"]);
  const fieldComponents: string[] = [];

  for (const field of fields) {
    const label = field.label ?? field.name.charAt(0).toUpperCase() + field.name.slice(1);
    const stateName = field.name;
    const setterName = `set${field.name.charAt(0).toUpperCase() + field.name.slice(1)}`;

    switch (field.type) {
      case "text":
        imports.add("TextField");
        fieldComponents.push(`        <TextField
          label="${label}"
          value={${stateName}}
          onChangeText={${setterName}}
          ${field.required ? `error={errors.${field.name}}` : ""}
        />`);
        break;
      case "email":
        imports.add("EmailField");
        fieldComponents.push(`        <EmailField
          label="${label}"
          value={${stateName}}
          onChangeText={${setterName}}
          ${field.required ? `error={errors.${field.name}}` : ""}
        />`);
        break;
      case "password":
        imports.add("PasswordField");
        fieldComponents.push(`        <PasswordField
          label="${label}"
          value={${stateName}}
          onChangeText={${setterName}}
          ${field.required ? `error={errors.${field.name}}` : ""}
        />`);
        break;
      case "number":
        imports.add("NumberField");
        fieldComponents.push(`        <NumberField
          label="${label}"
          value={${stateName}}
          onChangeValue={${setterName}}
          ${field.required ? `error={errors.${field.name}}` : ""}
        />`);
        break;
      case "textarea":
        imports.add("TextArea");
        fieldComponents.push(`        <TextArea
          label="${label}"
          value={${stateName}}
          onChangeText={${setterName}}
          ${field.required ? `error={errors.${field.name}}` : ""}
        />`);
        break;
      case "select": {
        imports.add("SelectField");
        const optionsStr = field.options
          ? JSON.stringify(field.options, null, 2).replace(/\n/g, "\n          ")
          : "[]";
        fieldComponents.push(`        <SelectField
          label="${label}"
          value={${stateName}}
          onChangeValue={${setterName}}
          options={${optionsStr}}
          ${field.required ? `error={errors.${field.name}}` : ""}
        />`);
        break;
      }
      case "boolean":
        imports.add("BooleanField");
        fieldComponents.push(`        <BooleanField
          label="${label}"
          value={${stateName}}
          onChangeValue={${setterName}}
        />`);
        break;
      case "date":
      case "datetime":
        imports.add("DateTimeField");
        fieldComponents.push(`        <DateTimeField
          label="${label}"
          value={${stateName}}
          onChange={${setterName}}
          mode="${field.type === "date" ? "date" : "datetime"}"
        />`);
        break;
    }
  }

  const stateDeclarations = fields
    .map((f) => {
      const defaultValue = f.type === "boolean" ? "false" : f.type === "number" ? "0" : '""';
      return `  const [${f.name}, set${f.name.charAt(0).toUpperCase() + f.name.slice(1)}] = useState(${defaultValue});`;
    })
    .join("\n");

  return `import React, { useState } from "react";
import { ${Array.from(imports).join(", ")} } from "@terreno/ui";

// State declarations (add to your component):
${stateDeclarations}

// Form fields (add inside your component's return):
{/* Form Fields */}
<Box gap={3}>
${fieldComponents.join("\n")}
</Box>
`;
};

const formatBlockIssue = (error: BlockError): string =>
  `${error.path}  ${error.code}  ${error.message} — ${error.fix}`;

/** Same stdout as `terreno-blocks validate` for one document. */
export const validateUiBlocks = (args: {document?: string}): string => {
  if (typeof args.document !== "string") {
    return "document is required\n";
  }
  const parsed = parseBlocks(args.document);
  if (!parsed.ok) {
    return `${parsed.errors.map(formatBlockIssue).join("\n")}\n`;
  }
  const validated = validateBlocks(parsed.value);
  if (!validated.ok) {
    return `${validated.errors.map(formatBlockIssue).join("\n")}\n`;
  }
  if (validated.warnings.length === 0) {
    return "";
  }
  return `${validated.warnings.map(formatBlockIssue).join("\n")}\n`;
};

export const validateModelSchema = (args: {schema: string}): string => {
  const {schema} = args;
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Check for strict mode
  if (!schema.includes('strict: "throw"') && !schema.includes("strict: 'throw'")) {
    issues.push("Missing strict: 'throw' in schema options");
    suggestions.push("Add { strict: 'throw' } to schema options for better error handling");
  }

  // Check for virtuals
  if (
    !schema.includes("toJSON: { virtuals: true }") &&
    !schema.includes("toJSON: {virtuals: true}")
  ) {
    issues.push("Missing toJSON virtuals configuration");
    suggestions.push(
      "Add { toJSON: { virtuals: true }, toObject: { virtuals: true } } to schema options"
    );
  }

  // Check for plugins
  if (!schema.includes("addDefaultPlugins") && !schema.includes("createdUpdatedPlugin")) {
    issues.push("Missing default plugins");
    suggestions.push("Add addDefaultPlugins(schema) or manually add createdUpdatedPlugin");
  }

  // Check for interface
  if (!schema.includes("interface") || !schema.includes("Document")) {
    issues.push("Missing TypeScript interfaces");
    suggestions.push("Define interfaces for Document and Model types");
  }

  // Check for findOne usage
  if (
    schema.includes(".findOne(") &&
    !schema.includes("findOneOrThrow") &&
    !schema.includes("findOneOrNone")
  ) {
    issues.push("Using findOne instead of findOneOrThrow/findOneOrNone");
    suggestions.push("Replace findOne with findOneOrThrow or findOneOrNone for safer queries");
  }

  // Check for Date usage
  if (schema.includes("new Date(") || schema.includes("Date.now")) {
    issues.push("Using native Date instead of Luxon");
    suggestions.push("Use Luxon DateTime instead of native Date for date handling");
  }

  if (issues.length === 0) {
    return "✓ Schema follows Terreno conventions";
  }

  return `Schema Validation Results:

Issues Found:
${issues.map((i) => `- ${i}`).join("\n")}

Suggestions:
${suggestions.map((s) => `- ${s}`).join("\n")}`;
};

export const generateInstallAdmin = (args: {
  models: Array<{
    modelName: string;
    routePath: string;
    displayName: string;
    listFields: string[];
  }>;
}): string => {
  const {models} = args;

  const modelConfigs = models
    .map(
      (m) =>
        `    {
      model: ${m.modelName},
      routePath: "${m.routePath}",
      displayName: "${m.displayName}",
      listFields: ${JSON.stringify(m.listFields)},
    },`
    )
    .join("\n");

  const modelImports = models.map((m) => m.modelName).join(", ");

  interface GeneratedFile {
    path: string;
    content: string;
  }

  const files: GeneratedFile[] = [
    {
      content: `import {AdminModelList} from "@terreno/admin-frontend";
import type React from "react";
import {terrenoApi} from "@/store/sdk";
import {baseUrl} from "@terreno/rtk";

const AdminIndexScreen: React.FC = () => {
  return <AdminModelList api={terrenoApi} baseUrl={\`\${baseUrl}/admin\`} />;
};

export default AdminIndexScreen;
`,
      path: "frontend/app/(tabs)/admin/index.tsx",
    },
    {
      content: `import {AdminModelTable} from "@terreno/admin-frontend";
import type React from "react";
import {useLocalSearchParams} from "expo-router";
import {terrenoApi} from "@/store/sdk";
import {baseUrl} from "@terreno/rtk";

const AdminModelScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();

  return (
    <AdminModelTable api={terrenoApi} baseUrl={\`\${baseUrl}/admin\`} modelName={model!} />
  );
};

export default AdminModelScreen;
`,
      path: "frontend/app/(tabs)/admin/[model].tsx",
    },
    {
      content: `import {AdminModelForm} from "@terreno/admin-frontend";
import type React from "react";
import {useLocalSearchParams} from "expo-router";
import {terrenoApi} from "@/store/sdk";
import {baseUrl} from "@terreno/rtk";

const AdminCreateScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();

  return (
    <AdminModelForm
      api={terrenoApi}
      baseUrl={\`\${baseUrl}/admin\`}
      mode="create"
      modelName={model!}
    />
  );
};

export default AdminCreateScreen;
`,
      path: "frontend/app/(tabs)/admin/[model]/create.tsx",
    },
    {
      content: `import {AdminModelForm} from "@terreno/admin-frontend";
import type React from "react";
import {useLocalSearchParams} from "expo-router";
import {terrenoApi} from "@/store/sdk";
import {baseUrl} from "@terreno/rtk";

const AdminEditScreen: React.FC = () => {
  const {model, id} = useLocalSearchParams<{model: string; id: string}>();

  return (
    <AdminModelForm
      api={terrenoApi}
      baseUrl={\`\${baseUrl}/admin\`}
      itemId={id}
      mode="edit"
      modelName={model!}
    />
  );
};

export default AdminEditScreen;
`,
      path: "frontend/app/(tabs)/admin/[model]/[id].tsx",
    },
  ];

  const fileList = files.map((f) => `- \`${f.path}\``).join("\n");

  const fileContents = files
    .map(
      (f) => `### \`${f.path}\`

\`\`\`typescript
${f.content}\`\`\`
`
    )
    .join("\n");

  return `# Install Admin Panel

## Files to Create

${fileList}

## Setup Instructions

### Step 1: Add \`@terreno/admin-backend\` to backend

Add the dependency to \`backend/package.json\`:

\`\`\`bash
cd backend && bun add @terreno/admin-backend
\`\`\`

### Step 2: Register AdminApp in your backend server

Add the following to your \`backend/src/server.ts\`:

\`\`\`typescript
import {AdminApp} from "@terreno/admin-backend";
import {${modelImports}} from "./models";

const adminApp = new AdminApp({
  models: [
${modelConfigs}
  ],
});
\`\`\`

Then call \`adminApp.register(app)\` inside your \`addRoutes\` function:

\`\`\`typescript
const addRoutes: AddRoutes = (router, options): void => {
  // ... existing routes ...
  adminApp.register(app);
};
\`\`\`

### Step 3: Add \`@terreno/admin-frontend\` to frontend

Add the dependency to \`frontend/package.json\`:

\`\`\`bash
cd frontend && bun add @terreno/admin-frontend
\`\`\`

### Step 4: Create the 4 screen files

Create the files listed above. Each file's content is provided below.

### Step 5: Add Admin tab to \`frontend/app/(tabs)/_layout.tsx\`

Add a new \`Tabs.Screen\` entry for the admin section:

\`\`\`typescript
<Tabs.Screen
  name="admin"
  options={{
    headerShown: false,
    tabBarIcon: ({color}) => <TabBarIcon color={color} name="cog" />,
    title: "Admin",
  }}
/>
\`\`\`

### Step 6: Install dependencies

\`\`\`bash
cd backend && bun install
cd ../frontend && bun install
\`\`\`

---

## File Contents

${fileContents}`;
};

const wrapWithFileInstructions = (
  code: string,
  filePath: string,
  additionalSteps?: string[]
): string => {
  const stepsText = additionalSteps?.length
    ? `\n\nAfter writing the file:\n${additionalSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  return `**IMPORTANT: Write this code to a file**

File path: \`${filePath}\`
${stepsText}

---

${code}`;
};

export const handleToolCall = async (
  name: string,
  args: Record<string, unknown>
): Promise<{content: Array<{type: "text"; text: string}>}> => {
  // Handle bootstrap tools
  if (name === "terreno_bootstrap_ai_rules") {
    return handleBootstrapToolCall(name, args);
  }

  let result: string;

  if (name === "terreno_search_docs") {
    const queries = args.queries;
    if (!Array.isArray(queries) || !queries.every((q) => typeof q === "string")) {
      return {
        content: [
          {
            text: '`queries` must be an array of strings, e.g. { "queries": ["modelRouter", "permissions"] }.',
            type: "text",
          },
        ],
      };
    }
    const packages = Array.isArray(args.packages)
      ? args.packages.filter((p): p is string => typeof p === "string")
      : undefined;
    const tokenLimit = typeof args.tokenLimit === "number" ? args.tokenLimit : undefined;
    const version = typeof args.version === "string" ? args.version : undefined;
    result = searchDocs({packages, queries, tokenLimit, version});
    return {content: [{text: result, type: "text"}]};
  }

  if (name === "terreno_get_component_docs") {
    const component = typeof args.component === "string" ? args.component : "";
    const componentVersion = typeof args.version === "string" ? args.version : undefined;
    result = getComponentDocsMarkdown(component, componentVersion);
    return {content: [{text: result, type: "text"}]};
  }

  if (name === "terreno_get_upgrade_guide") {
    const fromVersion = typeof args.fromVersion === "string" ? args.fromVersion.trim() : "";
    const toVersion = typeof args.toVersion === "string" ? args.toVersion.trim() : "";
    if (!fromVersion || !toVersion) {
      return {
        content: [
          {
            text: 'Provide `fromVersion` and `toVersion` semver strings, e.g. { "fromVersion": "0.19.0", "toVersion": "0.20.0" }.',
            type: "text",
          },
        ],
      };
    }
    result = getUpgradeGuideMarkdown(fromVersion, toVersion);
    return {content: [{text: result, type: "text"}]};
  }

  if (name === "terreno_search_update_notes") {
    const queries = Array.isArray(args.queries)
      ? args.queries.filter((query): query is string => typeof query === "string")
      : [];
    const question = typeof args.question === "string" ? args.question : undefined;
    const includeArchived = args.includeArchived === true;
    const limit = typeof args.limit === "number" ? args.limit : 10;
    const source =
      args.source === "bundled" || args.source === "announcement" || args.source === "auto"
        ? args.source
        : "auto";
    const payload = await searchUpdateNotes({includeArchived, limit, queries, question, source});
    return {content: [{text: JSON.stringify(payload, null, 2), type: "text"}]};
  }

  if (name === "terreno_get_update_note") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id) {
      return {
        content: [
          {
            text: 'Provide an `id` such as "upgrade:57.3.0" or "announcement:<mongoId>".',
            type: "text",
          },
        ],
      };
    }
    const includeArchived = args.includeArchived === true;
    const detail = await getUpdateNote({id, includeArchived});
    return {content: [{text: JSON.stringify(detail, null, 2), type: "text"}]};
  }

  if (name === "terreno_ask_update_help") {
    const question = typeof args.question === "string" ? args.question : "";
    const includeArchived = args.includeArchived === true;
    const limit = typeof args.limit === "number" ? args.limit : 5;
    const answer = await askUpdateHelp({includeArchived, limit, question});
    return {content: [{text: answer, type: "text"}]};
  }

  switch (name) {
    case "terreno_generate_model": {
      const modelArgs = args as Parameters<typeof generateModel>[0];
      const code = generateModel(modelArgs);
      const modelName = modelArgs.name.toLowerCase();
      result = wrapWithFileInstructions(code, `backend/src/models/${modelName}.ts`, [
        `Export from \`backend/src/models/index.ts\`: \`export * from "./${modelName}";\``,
      ]);
      break;
    }
    case "terreno_generate_route": {
      const routeArgs = args as Parameters<typeof generateRoute>[0];
      const code = generateRoute(routeArgs);
      const modelName = routeArgs.modelName.toLowerCase();
      result = wrapWithFileInstructions(code, `backend/src/api/${modelName}.ts`, [
        `Export from \`backend/src/api/index.ts\`: \`export * from "./${modelName}";\``,
        `Register in server setup: \`add${routeArgs.modelName}Routes(router, options);\``,
        `Regenerate frontend SDK: \`bun run sdk\` in the frontend directory`,
      ]);
      break;
    }
    case "terreno_generate_screen": {
      const screenArgs = args as Parameters<typeof generateScreen>[0];
      const code = generateScreen(screenArgs);
      result = wrapWithFileInstructions(code, `frontend/src/screens/${screenArgs.name}Screen.tsx`, [
        "Add the screen to your navigation configuration",
      ]);
      break;
    }
    case "terreno_generate_form_fields": {
      const code = generateFormFields(args as Parameters<typeof generateFormFields>[0]);
      result = wrapWithFileInstructions(code, "your form component file", [
        "Integrate this code into your form screen component",
      ]);
      break;
    }
    case "terreno_validate_model_schema":
      result = validateModelSchema(args as Parameters<typeof validateModelSchema>[0]);
      break;
    case "terreno_validate_ui_blocks":
      result = validateUiBlocks(args as Parameters<typeof validateUiBlocks>[0]);
      break;
    case "terreno_install_admin":
      result = generateInstallAdmin(args as Parameters<typeof generateInstallAdmin>[0]);
      break;
    default:
      result = `Unknown tool: ${name}`;
  }

  return {
    content: [{text: result, type: "text"}],
  };
};
