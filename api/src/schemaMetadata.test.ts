import {describe, expect, it} from "bun:test";
import mongoose, {Schema} from "mongoose";
import {z} from "zod";

import {
  describeModel,
  describeModelForRouter,
  type FieldDescription,
  fieldDescriptionToAdminMeta,
  fieldDescriptionToOpenApiProperty,
  fieldDescriptionToZodType,
  modelDescriptionToAdminFields,
  modelDescriptionToOpenApiSpec,
  nestDottedFieldDescriptions,
} from "./schemaMetadata";

const fixtureSchema = new Schema({
  completed: {default: false, description: "Whether the item is done", type: Boolean},
  createdAt: {description: "When the record was created", type: Date},
  label: {description: "Display label", required: true, type: String},
  metadata: {description: "Arbitrary metadata", type: Schema.Types.Mixed},
  ownerId: {description: "Owning user", ref: "User", required: true, type: Schema.Types.ObjectId},
  status: {
    description: "Workflow status",
    enum: ["draft", "published"],
    type: String,
  },
  tags: {description: "Search tags", type: [String]},
  tasks: {
    description: "Nested tasks",
    type: [
      new Schema({
        done: {description: "Whether the task is done", type: Boolean},
        title: {description: "Task title", required: true, type: String},
      }),
    ],
  },
});

fixtureSchema.add({
  created: {description: "Created timestamp", type: Date},
  deleted: {default: false, description: "Soft delete flag", type: Boolean},
  updated: {description: "Updated timestamp", type: Date},
});

const FixtureModel =
  mongoose.models.SchemaMetadataFixture ?? mongoose.model("SchemaMetadataFixture", fixtureSchema);

const mapSchema = new Schema({
  attributes: {description: "Untyped map values", type: Map},
  checkboxValues: {description: "Boolean map", of: Boolean, type: Map},
  lastEatenWith: {description: "Date map", of: Date, type: Map},
  typedMap: {description: "String map", of: String, type: Map},
});

const MapModel =
  mongoose.models.SchemaMetadataMap ?? mongoose.model("SchemaMetadataMap", mapSchema);

const embeddedSchema = new Schema({
  profile: {
    description: "Nested profile",
    type: new Schema({
      bio: {description: "Short bio", type: String},
    }),
  },
  "settings.theme": {description: "Theme name", type: String},
});

const EmbeddedModel =
  mongoose.models.SchemaMetadataEmbedded ??
  mongoose.model("SchemaMetadataEmbedded", embeddedSchema);

describe("describeModel", () => {
  it("returns a field graph snapshot for the fixture schema", () => {
    const description = describeModel(FixtureModel);

    expect(description.modelName).toBe("SchemaMetadataFixture");
    expect(description.fields).toMatchSnapshot();
  });

  it("marks system fields", () => {
    const description = describeModel(FixtureModel);

    expect(description.fields._id?.system).toBe(true);
    expect(description.fields.__v?.system).toBe(true);
    expect(description.fields.created?.system).toBe(true);
    expect(description.fields.updated?.system).toBe(true);
    expect(description.fields.deleted?.system).toBe(true);
  });

  it("captures enum, ref, array, subdocument, and mixed fields", () => {
    const description = describeModel(FixtureModel);

    expect(description.fields.status).toEqual(
      expect.objectContaining({
        enum: ["draft", "published"],
        kind: "string",
      })
    );
    expect(description.fields.ownerId).toEqual(
      expect.objectContaining({
        kind: "objectId",
        ref: "User",
        required: true,
      })
    );
    expect(description.fields.tags).toEqual(
      expect.objectContaining({
        isArray: true,
        item: expect.objectContaining({kind: "string"}),
      })
    );
    expect(description.fields.tasks).toEqual(
      expect.objectContaining({
        isArray: true,
        item: expect.objectContaining({
          fields: expect.objectContaining({
            done: expect.objectContaining({kind: "boolean"}),
            title: expect.objectContaining({kind: "string", required: true}),
          }),
        }),
      })
    );
    expect(description.fields.metadata).toEqual(
      expect.objectContaining({
        kind: "mixed",
      })
    );
  });

  it("describes map fields from Map of/caster kinds, not a date fallback", () => {
    const description = describeModel(MapModel);

    expect(description.fields.attributes).toEqual(
      expect.objectContaining({
        item: expect.objectContaining({kind: "mixed"}),
        kind: "map",
      })
    );
    expect(description.fields.typedMap).toEqual(
      expect.objectContaining({
        item: expect.objectContaining({kind: "string"}),
        kind: "map",
      })
    );
    expect(description.fields.checkboxValues).toEqual(
      expect.objectContaining({
        item: expect.objectContaining({kind: "boolean"}),
        kind: "map",
      })
    );
    expect(description.fields.lastEatenWith).toEqual(
      expect.objectContaining({
        item: expect.objectContaining({kind: "date"}),
        kind: "map",
      })
    );
    expect(Object.keys(description.fields).some((path) => path.includes("$*"))).toBe(false);

    expect(fieldDescriptionToOpenApiProperty(description.fields.lastEatenWith)).toEqual({
      additionalProperties: {format: "date-time", type: "string"},
      description: "Date map",
      type: "object",
    });
    expect(fieldDescriptionToOpenApiProperty(description.fields.checkboxValues)).toEqual({
      additionalProperties: {type: "boolean"},
      description: "Boolean map",
      type: "object",
    });
    expect(fieldDescriptionToOpenApiProperty(description.fields.typedMap)).toEqual({
      additionalProperties: {type: "string"},
      description: "String map",
      type: "object",
    });
  });

  it("merges extraProperties into the field graph", () => {
    const extraField: FieldDescription = {
      description: "Synthetic field",
      kind: "string",
      required: false,
    };
    const description = describeModel(FixtureModel, {
      extraProperties: {synthetic: extraField},
    });

    expect(description.fields.synthetic).toEqual(extraField);
  });
});

describe("describeModelForRouter", () => {
  it("adds write masks from system fields and validation exclusions", () => {
    const description = describeModelForRouter(FixtureModel, {
      validation: {
        excludeFromCreate: ["ownerId"],
        excludeFromUpdate: ["status"],
      },
    });

    expect(description.fields.created?.writableOnCreate).toBe(false);
    expect(description.fields.ownerId?.writableOnCreate).toBe(false);
    expect(description.fields.label?.writableOnCreate).toBe(true);
    expect(description.fields.status?.writableOnUpdate).toBe(false);
    expect(description.fields.label?.writableOnUpdate).toBe(true);
  });

  it("respects fieldView write masks for nested paths", () => {
    const description = describeModelForRouter(EmbeddedModel, {
      fieldView: {read: "*", write: ["profile"]},
    });

    expect(description.fields.profile?.writableOnCreate).toBe(true);
    expect(description.fields["settings.theme"]?.writableOnCreate).toBe(false);
  });
});

describe("nestDottedFieldDescriptions", () => {
  it("nests dotted paths into embedded field graphs", () => {
    const nested = nestDottedFieldDescriptions({
      "settings.theme": {kind: "string", required: false},
      title: {kind: "string", required: true},
    });

    expect(nested.settings).toEqual(
      expect.objectContaining({
        fields: {
          theme: {kind: "string", required: false},
        },
        kind: "embedded",
      })
    );
    expect(nested.title).toEqual({kind: "string", required: true});
  });
});

describe("modelDescriptionToOpenApiSpec", () => {
  it("converts the fixture description into OpenAPI properties", () => {
    const description = describeModel(FixtureModel);
    const spec = modelDescriptionToOpenApiSpec(description);

    expect(spec.properties.ownerId).toEqual({
      description: "Owning user",
      format: "objectid",
      type: "string",
    });
    expect(spec.properties.metadata).toEqual({
      description: "Arbitrary metadata",
    });
    expect(spec.required).toContain("label");
    expect(spec.required).toContain("ownerId");
    expect(spec.properties.__v).toBeUndefined();
  });
});

describe("fieldDescriptionToOpenApiProperty", () => {
  it("maps arrays, embedded objects, maps, and date-only fields", () => {
    const arrayField: FieldDescription = {
      description: "Tags",
      isArray: true,
      item: {kind: "string", required: false},
      kind: "string",
      required: false,
    };
    const embeddedField: FieldDescription = {
      description: "Profile",
      fields: {
        bio: {description: "Bio", kind: "string", required: false},
      },
      kind: "embedded",
      required: false,
    };
    const mapField: FieldDescription = {
      description: "Attributes",
      item: {kind: "string", required: false},
      kind: "map",
      required: false,
    };

    expect(fieldDescriptionToOpenApiProperty(arrayField)).toEqual({
      description: "Tags",
      items: {type: "string"},
      type: "array",
    });
    expect(
      fieldDescriptionToOpenApiProperty({
        description: "Platforms",
        enum: ["ios", "android", "web"],
        isArray: true,
        item: {enum: ["ios", "android", "web"], kind: "string", required: false},
        kind: "string",
        required: false,
      })
    ).toEqual({
      description: "Platforms",
      items: {enum: ["ios", "android", "web"], type: "string"},
      type: "array",
    });
    expect(fieldDescriptionToOpenApiProperty(embeddedField)).toEqual(
      expect.objectContaining({
        description: "Profile",
        properties: {bio: {description: "Bio", type: "string"}},
        type: "object",
      })
    );
    expect(fieldDescriptionToOpenApiProperty(mapField)).toEqual({
      additionalProperties: {type: "string"},
      description: "Attributes",
      type: "object",
    });
    expect(
      fieldDescriptionToOpenApiProperty({
        description: "Birthday",
        kind: "dateOnly",
        required: false,
      })
    ).toEqual({
      description: "Birthday",
      type: "dateonly",
    });
  });
});

describe("modelDescriptionToAdminFields", () => {
  it("converts the fixture description into admin field metadata", () => {
    const description = describeModel(FixtureModel);
    const fields = modelDescriptionToAdminFields(description);

    expect(fields.ownerId).toEqual(
      expect.objectContaining({
        ref: "User",
        required: true,
        searchable: false,
        type: "objectid",
      })
    );
    expect(fields.tags).toEqual(
      expect.objectContaining({
        itemType: "string",
        type: "array",
      })
    );
    expect(fields.tasks).toEqual(
      expect.objectContaining({
        items: expect.objectContaining({
          title: expect.objectContaining({required: true, type: "string"}),
        }),
        type: "array",
      })
    );
  });
});

describe("fieldDescriptionToAdminMeta", () => {
  it("maps embedded object fields for admin forms", () => {
    const meta = fieldDescriptionToAdminMeta({
      description: "Profile",
      fields: {
        bio: {description: "Bio", kind: "string", required: false},
      },
      kind: "embedded",
      required: false,
    });

    expect(meta).toEqual(
      expect.objectContaining({
        items: {
          bio: expect.objectContaining({searchable: true, type: "string"}),
        },
        type: "object",
      })
    );
  });
});

describe("fieldDescriptionToZodType", () => {
  it("builds zod types for primitive, enum, array, and map fields", () => {
    expect(fieldDescriptionToZodType({kind: "string", required: true}, z).parse("ok")).toBe("ok");
    expect(
      fieldDescriptionToZodType(
        {enum: ["draft", "published"], kind: "string", required: true},
        z
      ).parse("draft")
    ).toBe("draft");
    expect(
      fieldDescriptionToZodType(
        {
          description: "Tags",
          isArray: true,
          item: {kind: "string", required: false},
          kind: "string",
          required: false,
        },
        z
      ).parse(["a"])
    ).toEqual(["a"]);
    expect(
      fieldDescriptionToZodType(
        {
          description: "Attributes",
          item: {kind: "string", required: false},
          kind: "map",
          required: false,
        },
        z
      ).parse({key: "value"})
    ).toEqual({key: "value"});
    expect(
      fieldDescriptionToZodType(
        {
          description: "Metadata",
          fields: {note: {kind: "string", required: false}},
          kind: "embedded",
          required: false,
        },
        z
      ).parse({note: "hello"})
    ).toEqual({note: "hello"});
  });
});

const conditionalRequiredSchema = new Schema({
  flagged: {default: false, description: "Whether the record is flagged", type: Boolean},
  kind: {description: "Record kind", required: true, type: String},
  note: {
    description: "Only required for flagged records",
    required: [
      function (this: {flagged?: boolean}): boolean {
        return this.flagged === true;
      },
      "note is required when flagged",
    ],
    type: String,
  },
});

const ConditionalRequiredModel =
  mongoose.models.SchemaMetadataConditionalRequired ??
  mongoose.model("SchemaMetadataConditionalRequired", conditionalRequiredSchema);

describe("conditionally required fields", () => {
  it("are not marked required, so clients do not expect them on every document", () => {
    const description = describeModel(ConditionalRequiredModel);
    expect(description.fields.kind?.required).toBe(true);
    expect(description.fields.note?.required).toBe(false);

    const {required} = modelDescriptionToOpenApiSpec(description);
    expect(required).toContain("kind");
    expect(required).not.toContain("note");
  });

  it("still enforce the requirement when saving", async () => {
    const doc = new ConditionalRequiredModel({flagged: true, kind: "alert"});
    const error = await doc.validate().catch((validationError: unknown) => validationError);
    expect((error as mongoose.Error.ValidationError).errors.note?.message).toBe(
      "note is required when flagged"
    );
  });
});
