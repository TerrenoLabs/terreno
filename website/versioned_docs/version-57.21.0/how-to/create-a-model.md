# How to Create a Mongoose Model

Learn how to create a Mongoose model with Terreno conventions for use with modelRouter.

## Prerequisites

- Basic understanding of MongoDB and Mongoose
- @terreno/api installed
- MongoDB connection configured

## Step-by-step

### 1. Define TypeScript interfaces

Create type definitions for your model document, model statics, and methods:

``````typescript
// src/types/models/todoTypes.ts
import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel} from "@terreno/api";

export interface TodoDocument extends DefaultDoc {
  title: string;
  completed: boolean;
  ownerId: mongoose.Types.ObjectId;
}

export interface TodoModel extends DefaultModel<TodoDocument> {
  // Add custom static methods here if needed
}
``````

### 2. Create the schema with field descriptions

**Important:** Every field **must** include a `description` property. Terreno's `describeModel()` reads descriptions into the canonical field graph; that graph feeds the OpenAPI spec, admin `/admin/config` field metadata, and MCP tool schemas.

``````typescript
// src/models/todo.ts
import mongoose from "mongoose";
import type {TodoDocument, TodoModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const todoSchema = new mongoose.Schema<TodoDocument, TodoModel>(
  {
    completed: {
      default: false,
      description: "Whether the todo item has been completed",
      type: Boolean,
    },
    ownerId: {
      description: "The user who owns this todo",
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    title: {
      description: "The title of the todo item",
      required: true,
      trim: true,
      type: String,
    },
  },
  {
    strict: "throw",
    toJSON: {virtuals: true},
    toObject: {virtuals: true},
  }
);
``````

### 3. Add plugins

Apply default plugins to get standard fields (created, updated, deleted):

``````typescript
addDefaultPlugins(todoSchema);
``````

The default plugins typically include:
- `createdUpdatedPlugin` — Adds `created` and `updated` timestamps
- `isDeletedPlugin` — Adds soft delete support with `deleted` field
- `findExactlyOne` and `findOneOrNone` — Safe query methods

### 4. Export the model

``````typescript
export const Todo = mongoose.model<TodoDocument, TodoModel>("Todo", todoSchema);
``````

### 5. Create routes with modelRouter

Use the model with `modelRouter` to generate CRUD endpoints:

``````typescript
// src/api/todos.ts
import {Router} from "express";
import {modelRouter, Permissions, OwnerQueryFilter} from "@terreno/api";
import {Todo} from "../models/todo";

export const addTodoRoutes = (router: Router) => {
  router.use(
    "/todos",
    modelRouter(Todo, {
      permissions: {
        create: [Permissions.IsAuthenticated],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsOwner],
        update: [Permissions.IsOwner],
        delete: [Permissions.IsOwner],
      },
      preCreate: (body, req) => ({
        ...body,
        ownerId: req.user?._id,
      }),
      queryFilter: OwnerQueryFilter,
      queryFields: ["completed", "ownerId"],
      sort: "-created",
    })
  );
};
``````

## Field description guidelines

When writing field descriptions:

- **Be concise:** One clear sentence is usually enough
- **Explain purpose, not type:** The type is already specified
- **Use active voice:** "The user who owns..." not "The owner of..."
- **Include constraints if relevant:** "Email address (must be unique)"

### Good examples

``````typescript
{
  email: {
    description: "User's email address (must be unique)",
    type: String,
    required: true,
    unique: true,
  },
  createdAt: {
    description: "Timestamp when the record was created",
    type: Date,
    default: Date.now,
  },
  status: {
    description: "Current status of the order",
    type: String,
    enum: ["pending", "processing", "completed"],
  },
}
``````

## Next steps

- Learn about [modelRouter options](../reference/api.md)
- Explore [permissions and access control](../reference/api.md#permissions)
- See the [example-backend](../../example-backend/) for a complete working example

## See also

- [@terreno/api reference](../reference/api.md)
- [Getting started tutorial](../tutorials/getting-started.md)
- [example-backend source](../../example-backend/src/models/)
