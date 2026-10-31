/**
 * Tests for cataloging Mongoose schemas and classifying generate-time diffs.
 */
import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {buildSchemaCatalog, diffSchemaCatalog} from "./schemaCatalog";

const catalogTodo = (): mongoose.Model<mongoose.Document> => {
  const schema = new mongoose.Schema(
    {
      notes: {description: "Notes", type: String},
      title: {description: "Title", required: true, type: String},
    },
    {collection: "todos"}
  );
  schema.index({title: 1});
  return mongoose.model<mongoose.Document>(
    `TodoCatalog${Math.random().toString(16).slice(2)}`,
    schema
  );
};

describe("buildSchemaCatalog", () => {
  it("records paths, required flags, and indexes without methods", () => {
    const Model = catalogTodo();
    const catalog = buildSchemaCatalog({models: [Model]});
    const model = catalog.models[Model.modelName];
    expect(model.collection).toBe("todos");
    expect(model.fields.map((field) => field.path).sort()).toEqual(["notes", "title"]);
    expect(model.fields.find((field) => field.path === "title")?.required).toBe(true);
    expect(model.fields.find((field) => field.path === "notes")?.required).toBe(false);
    expect(model.indexes.some((index) => index.keys.title === 1)).toBe(true);
    const again = buildSchemaCatalog({models: [Model]});
    expect(JSON.stringify(again)).toBe(JSON.stringify(catalog));
  });
});

describe("diffSchemaCatalog", () => {
  it("classifies optional field and index adds as safe", () => {
    const before = {
      models: {
        Todo: {
          collection: "todos",
          fields: [{instance: "String", path: "title", required: true, unique: false}],
          indexes: [],
          modelName: "Todo",
        },
      },
    };
    const after = {
      models: {
        Todo: {
          collection: "todos",
          fields: [
            {instance: "String", path: "notes", required: false, unique: false},
            {instance: "String", path: "title", required: true, unique: false},
          ],
          indexes: [{keys: {title: 1}, unique: false}],
          modelName: "Todo",
        },
      },
    };
    const diff = diffSchemaCatalog({after, before});
    expect(diff.ops.map((op) => op.kind).sort()).toEqual(["addIndex", "addOptionalField"]);
    expect(diff.ops.every((op) => op.safe)).toBe(true);
  });

  it("classifies required, unique, and rename as unsafe", () => {
    const before = {
      models: {
        Todo: {
          collection: "todos",
          fields: [{instance: "String", path: "title", required: false, unique: false}],
          indexes: [],
          modelName: "Todo",
        },
      },
    };
    const after = {
      models: {
        Todo: {
          collection: "todos",
          fields: [
            {instance: "String", path: "heading", required: true, unique: false},
            {instance: "String", path: "owner", required: false, unique: true},
          ],
          indexes: [{keys: {owner: 1}, unique: true}],
          modelName: "Todo",
        },
      },
    };
    const diff = diffSchemaCatalog({after, before});
    const kinds = diff.ops.map((op) => op.kind).sort();
    expect(kinds).toContain("renameField");
    expect(kinds).toContain("addRequiredField");
    expect(kinds).toContain("addUniqueIndex");
    expect(diff.ops.filter((op) => !op.safe).length).toBeGreaterThan(0);
    expect(diff.ops.find((op) => op.kind === "renameField")?.safe).toBe(false);
    expect(diff.ops.find((op) => op.kind === "addRequiredField")?.safe).toBe(false);
    expect(diff.ops.find((op) => op.kind === "addUniqueIndex")?.safe).toBe(false);
  });

  it("classifies tightening required on an existing path as unsafe", () => {
    const before = {
      models: {
        Todo: {
          collection: "todos",
          fields: [{instance: "String", path: "title", required: false, unique: false}],
          indexes: [{keys: {title: 1}, unique: false}],
          modelName: "Todo",
        },
      },
    };
    const after = {
      models: {
        Todo: {
          collection: "todos",
          fields: [{instance: "String", path: "title", required: true, unique: false}],
          indexes: [],
          modelName: "Todo",
        },
      },
    };
    const diff = diffSchemaCatalog({after, before});
    expect(diff.ops.some((op) => op.kind === "addRequiredField" && op.safe === false)).toBe(true);
    expect(diff.ops.some((op) => op.kind === "dropIndex" && op.safe === true)).toBe(true);
  });

  it("classifies removed paths and same-path type changes as unsafe", () => {
    const before = {
      models: {
        Todo: {
          collection: "todos",
          fields: [
            {instance: "String", path: "notes", required: false, unique: false},
            {instance: "String", path: "title", required: true, unique: false},
          ],
          indexes: [],
          modelName: "Todo",
        },
      },
    };
    const after = {
      models: {
        Todo: {
          collection: "todos",
          fields: [{instance: "Number", path: "title", required: true, unique: false}],
          indexes: [],
          modelName: "Todo",
        },
      },
    };
    const diff = diffSchemaCatalog({after, before});
    expect(diff.ops).toEqual(
      expect.arrayContaining([
        {kind: "removeField", modelName: "Todo", path: "notes", safe: false},
        {kind: "changeFieldType", modelName: "Todo", path: "title", safe: false},
      ])
    );
  });
});
