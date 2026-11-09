import {DateTime} from "luxon";
import mongoose, {
  type Document,
  Error as MongooseError,
  type Query,
  type Schema,
  SchemaType,
  type SchemaTypeOptions,
} from "mongoose";

import {APIError, type APIErrorOptions, InternalServerError, NotFoundError} from "./errors";

export type ModelQuery<T> = Partial<Record<keyof T, unknown>> & Record<string, unknown>;

export interface BaseUser {
  admin: boolean;
  email: string;
}

/**
 * Builds the error thrown by the query plugins. `errorArgs` is applied last so consumers can
 * override every field, including `status`; the status-specific subclass is used when the resulting
 * status still matches one of them, so Sentry sees a meaningful error type.
 */
const pluginError = (defaults: APIErrorOptions, errorArgs?: Partial<APIErrorOptions>): APIError => {
  const options: APIErrorOptions = {...defaults, ...errorArgs};
  if (options.status === 404) {
    return new NotFoundError(options);
  }
  if (options.status === 500) {
    return new InternalServerError(options);
  }
  return new APIError(options);
};

// noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
// biome-ignore lint/suspicious/noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
export const baseUserPlugin = (schema: Schema<any, any, any, any>): void => {
  schema.add({
    admin: {default: false, description: "Whether the user has admin privileges", type: Boolean},
  });
  schema.add({email: {description: "The user's email address", index: true, type: String}});
};

export interface EmailVerified {
  emailVerified: boolean;
}

/**
 * Opt-in `emailVerified` field for user schemas. Defaults to false so existing
 * documents stay unverified until they complete the email-verification flow.
 */
export const emailVerificationPlugin = (schema: Parameters<typeof baseUserPlugin>[0]): void => {
  schema.add({
    emailVerified: {
      default: false,
      description: "Whether the user has verified their email address",
      type: Boolean,
    },
  });
};

/** For models with the isDeletedPlugin, extend this interface to add the appropriate fields. */
export interface IsDeleted {
  // Whether the model should be treated as deleted or not.
  deleted: boolean;
}

// noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
// biome-ignore lint/suspicious/noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
export const isDeletedPlugin = (schema: Schema<any, any, any, any>, defaultValue = false): void => {
  schema.add({
    deleted: {
      default: defaultValue,
      description:
        "Deleted objects are not returned in any find() or findOne() by default. " +
        "Add {deleted: true} to find them.",
      index: true,
      type: Boolean,
    },
  });
  // noExplicitAny: Query<any, any> must be loose to accept arbitrary consumer queries
  // biome-ignore lint/suspicious/noExplicitAny: Query<any, any> must be loose to accept arbitrary consumer queries
  const applyDeleteFilter = (q: Query<any, any>): void => {
    const query = q.getQuery();
    if (query && query.deleted === undefined) {
      void q.where({deleted: {$ne: true}});
    }
  };
  schema.pre("find", function () {
    applyDeleteFilter(this);
  });
  schema.pre("findOne", function () {
    applyDeleteFilter(this);
  });
  schema.pre("countDocuments", function () {
    applyDeleteFilter(this);
  });
};

export const isDisabledPlugin = (
  // noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
  // biome-ignore lint/suspicious/noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
  schema: Schema<any, any, any, any>,
  defaultValue = false
): void => {
  schema.add({
    disabled: {
      default: defaultValue,
      description: "When a user is set to disable, all requests will return a 401",
      index: true,
      type: Boolean,
    },
  });
};

export interface CreatedDeleted {
  updated: {type: Date; required: true};
  created: {type: Date; required: true};
}

// noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
// biome-ignore lint/suspicious/noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
export const createdUpdatedPlugin = (schema: Schema<any, any, any, any>): void => {
  schema.add({
    updated: {description: "When this document was last updated", index: true, type: Date},
  });
  schema.add({created: {description: "When this document was created", index: true, type: Date}});

  schema.pre("save", function () {
    if (this.disableCreatedUpdatedPlugin === true) {
      return;
    }
    // If we aren't specifying created, use now.
    if (!this.created) {
      this.created = DateTime.now().toJSDate();
    }
    // All writes change the updated time.
    this.updated = DateTime.now().toJSDate();
  });

  schema.pre(/save|updateOne|insertMany/, function () {
    void this.updateOne({}, {$set: {updated: DateTime.now().toJSDate()}});
  });
};

export const firebaseJWTPlugin = (schema: Schema): void => {
  schema.add({
    firebaseId: {description: "The user's Firebase authentication ID", index: true, type: String},
  });
};

/**
 * This adds a static method `Model.findOneOrNone` to the schema. This should replace `Model.findOne` in most instances.
 * `Model.findOne` should only be used with a unique index, but that's not apparent from the docs. Otherwise you can wind
 * up with a random document that matches the query. The returns either null if no document matches, the actual
 * document, or throws an exception if multiple are found.
 * @param schema Mongoose Schema
 */
export const findOneOrNone = <T>(schema: Schema<T>): void => {
  schema.statics.findOneOrNone = async function (
    query: Record<string, unknown>,
    errorArgs?: Partial<APIErrorOptions>
  ): Promise<(Document & T) | null> {
    const results = await this.find(query);
    if (results.length === 0) {
      return null;
    }
    if (results.length > 1) {
      throw pluginError(
        {
          code: "find-one-multiple-documents",
          detail: `${this.modelName}.findOne query returned multiple documents. query: ${JSON.stringify(query)}`,
          meta: {model: this.modelName},
          status: 500,
          title: "findOne query returned multiple documents",
        },
        errorArgs
      );
    }
    return results[0];
  };
};

/**
 * Helper that performs a `findOneOrNone` lookup against any Mongoose model. Returns the matching
 * document, `null` if none match, or throws if more than one matches. If the model's schema has
 * the {@link findOneOrNone} plugin applied, the plugin static is used; otherwise the lookup is
 * performed directly via `model.find(...)`. Prefer this helper from framework code where the
 * consumer's model may or may not have the plugin installed.
 * @param model Mongoose Model
 * @param query Mongoose query object
 * @param errorArgs Optional overrides for the thrown {@link APIError} when multiple match
 */
export const findOneOrNoneFor = async <T>(
  model: mongoose.Model<T>,
  query: ModelQuery<T>,
  errorArgs?: Partial<APIErrorOptions>
): Promise<(Document & T) | null> => {
  const withStatic = model as mongoose.Model<T> & Partial<FindOneOrNonePlugin<T>>;
  if (typeof withStatic.findOneOrNone === "function") {
    return withStatic.findOneOrNone(query, errorArgs);
  }
  const results = await model.find(query as never);
  if (results.length === 0) {
    return null;
  }
  if (results.length > 1) {
    throw pluginError(
      {
        code: "find-one-multiple-documents",
        detail: `${model.modelName}.findOne query returned multiple documents. query: ${JSON.stringify(query)}`,
        meta: {model: model.modelName},
        status: 500,
        title: "findOne query returned multiple documents",
      },
      errorArgs
    );
  }
  return results[0] as unknown as Document & T;
};

/**
 * This adds a static method `Model.findExactlyOne` to the schema. This or findOneOrNone should replace `Model.findOne`
 * in most instances.
 * `Model.findOne` should only be used with a unique index, but that's not apparent from the docs. Otherwise you can wind
 * up with a random document that matches the query. The returns the one matching document, or throws an exception if
 * multiple or none are found.
 * @param schema Mongoose Schema
 */
export const findExactlyOne = <T>(schema: Schema<T>): void => {
  schema.statics.findExactlyOne = async function (
    query: Record<string, unknown>,
    errorArgs?: Partial<APIErrorOptions>
  ): Promise<Document & T> {
    const results = await this.find(query);
    if (results.length === 0) {
      throw pluginError(
        {
          code: "find-exactly-one-no-documents",
          detail: `${this.modelName}.findExactlyOne query returned no documents. query: ${JSON.stringify(query)}`,
          meta: {model: this.modelName},
          status: 404,
          title: "findExactlyOne query returned no documents",
        },
        errorArgs
      );
    }
    if (results.length > 1) {
      throw pluginError(
        {
          code: "find-exactly-one-multiple-documents",
          detail: `${this.modelName}.findExactlyOne query returned multiple documents. query: ${JSON.stringify(query)}`,
          meta: {model: this.modelName},
          status: 500,
          title: "findExactlyOne query returned multiple documents",
        },
        errorArgs
      );
    }
    return results[0];
  };
};

/**
 * This adds a static method `Model.upsert` to the schema. This method will either update an existing document
 * that matches the conditions or create a new document if none exists. It throws an error if multiple documents
 * match the conditions to prevent ambiguous updates.
 * @param schema Mongoose Schema
 */
// noExplicitAny: Schema generics with unknown collide with mongoose's loose this-binding on schema.statics
// biome-ignore lint/suspicious/noExplicitAny: Schema generics with unknown collide with mongoose's loose this-binding on schema.statics
export const upsertPlugin = <T>(schema: Schema<any, any, any, any>): void => {
  schema.statics.upsert = async function (
    this: mongoose.Model<T>,
    conditions: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<T> {
    // Try to find the document with the given conditions.
    const docs = await this.find(conditions);
    if (docs.length > 1) {
      throw new InternalServerError({
        code: "upsert-multiple-documents",
        detail: `${this.modelName}.upsert find query returned multiple documents. query: ${JSON.stringify(conditions)}`,
        meta: {model: this.modelName},
        title: "upsert find query returned multiple documents",
      });
    }
    const doc = docs[0];

    if (doc) {
      // If the document exists, update it with the provided update values.
      Object.assign(doc, update);
      return (await doc.save()) as unknown as T;
    }
    // If the document doesn't exist, create a new one with the combined conditions and update
    // values.
    const combinedData = {...conditions, ...update};
    const newDoc = new this(combinedData);
    return (await newDoc.save()) as unknown as T;
  };
};

/** For models with the upsertPlugin, extend this interface to add the upsert static method. */
export interface HasUpsert<T> {
  upsert(conditions: Record<string, unknown>, update: Record<string, unknown>): Promise<T>;
}

/** For models with the excludeArchivedPlugin, extend this interface to add the archived field. */
export interface IsArchived {
  // Archived objects are excluded from find() queries unless {archived: true} is passed.
  archived: boolean;
}

/**
 * Adds an `archived` boolean field and excludes archived documents from `find()` / `findOne()`
 * queries by default. Pass `{archived: true}` explicitly to include them. This is a soft-archive
 * analog to {@link isDeletedPlugin}: use it when documents should be hidden from normal listings
 * but kept (and still directly queryable) rather than treated as deleted.
 * @param schema Mongoose Schema
 * @param defaultValue Default value for the `archived` field (defaults to `false`)
 */
export const excludeArchivedPlugin = (
  // noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
  // biome-ignore lint/suspicious/noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
  schema: Schema<any, any, any, any>,
  defaultValue = false
): void => {
  schema.add({
    archived: {
      default: defaultValue,
      description:
        "Archived objects are not returned in any find() by default. " +
        "Add {archived: true} to find them.",
      index: true,
      type: Boolean,
    },
  });

  // Mirror isDeletedPlugin: filter both find and findOne so findExactlyOne / findOneOrNone
  // also exclude archived documents unless the query sets `archived` explicitly.
  // noExplicitAny: Query<any, any> must be loose to accept arbitrary consumer queries
  // biome-ignore lint/suspicious/noExplicitAny: Query<any, any> must be loose to accept arbitrary consumer queries
  const applyArchiveFilter = (query: Query<any, any>): void => {
    const conditions = query.getFilter();
    // Only apply the default filter when the query does not mention `archived` at all, so an
    // explicit `{archived: true}` (or `false`) is always respected.
    if (conditions.archived === undefined) {
      query.setQuery({...conditions, archived: {$ne: true}});
    }
  };

  // noExplicitAny: Query<any, any> must be loose to accept arbitrary consumer queries
  // biome-ignore lint/suspicious/noExplicitAny: Query<any, any> must be loose to accept arbitrary consumer queries
  schema.pre<Query<any, any>>("find", function () {
    applyArchiveFilter(this);
  });
  // noExplicitAny: Query<any, any> must be loose to accept arbitrary consumer queries
  // biome-ignore lint/suspicious/noExplicitAny: Query<any, any> must be loose to accept arbitrary consumer queries
  schema.pre<Query<any, any>>("findOne", function () {
    applyArchiveFilter(this);
  });
};

export interface FindOneOrNonePlugin<T> {
  findOneOrNone(
    query: Record<string, unknown>,
    errorArgs?: Partial<APIErrorOptions>
  ): Promise<(Document & T) | null>;
}

export interface FindExactlyOnePlugin<T> {
  findExactlyOne(
    query: Record<string, unknown>,
    errorArgs?: Partial<APIErrorOptions>
  ): Promise<Document & T>;
}

type DateOnlyConditionalHandler = (this: DateOnly, val: unknown) => Date | undefined;

interface SchemaTypeWithConditionalHandlers {
  $conditionalHandlers?: Record<string, DateOnlyConditionalHandler>;
}

interface SchemaTypeWithApplySetters {
  applySetters: (val: unknown, context: unknown) => Date | undefined;
}

type SchemaTypesWithDateOnly = typeof mongoose.Schema.Types & {DateOnly: typeof DateOnly};

export class DateOnly extends SchemaType {
  constructor(key: string, options: SchemaTypeOptions<Date>) {
    super(key, options, "DateOnly");
  }

  handleSingle(val: unknown) {
    return this.cast(val);
  }

  $conditionalHandlers = {
    ...(SchemaType as unknown as {prototype: SchemaTypeWithConditionalHandlers}).prototype
      .$conditionalHandlers,
    $gt: this.handleSingle,
    $gte: this.handleSingle,
    $lt: this.handleSingle,
    $lte: this.handleSingle,
  };

  // Based on castForQuery in mongoose/lib/schema/date.js
  // When using $gt, $gte, $lt, $lte, etc, we need to cast the value to a Date
  castForQuery($conditional: string | undefined, val: unknown, context: unknown): Date | undefined {
    if ($conditional == null) {
      return (this as unknown as SchemaTypeWithApplySetters).applySetters(val, context);
    }

    const handler = this.$conditionalHandlers[$conditional];

    if (!handler) {
      throw new APIError({
        detail: `Can't use ${$conditional} with DateOnly.`,
        status: 400,
        title: "Unsupported query conditional for DateOnly",
      });
    }

    return handler.call(this, val);
  }

  // When either setting a value to a DateOnly or fetching from the DB,
  // we want to strip off the time portion.
  cast(val: unknown): Date | undefined {
    if (val instanceof Date) {
      const date = DateTime.fromJSDate(val).toUTC().startOf("day");
      if (!date.isValid) {
        throw new MongooseError.CastError(
          "DateOnly",
          val,
          this.path,
          new Error("Value is not a valid date")
        );
      }
      return date.toJSDate();
    }
    if (typeof val === "string" || typeof val === "number") {
      const date = (
        typeof val === "number" ? DateTime.fromMillis(val) : DateTime.fromISO(val, {zone: "utc"})
      )
        .toUTC()
        .startOf("day");
      if (!date.isValid) {
        throw new MongooseError.CastError(
          "DateOnly",
          val,
          this.path,
          new Error("Value is not a valid date")
        );
      }
      return date.toJSDate();
    }
    // Handle $gte, $lte, etc
    if (typeof val === "object") {
      return val as Date;
    }
    throw new MongooseError.CastError(
      "DateOnly",
      val,
      this.path,
      new Error("Value is not a valid date")
    );
  }

  get(val: unknown): this {
    return (val instanceof Date
      ? DateTime.fromJSDate(val).startOf("day").toJSDate()
      : val) as unknown as this;
  }
}

// Register DateOnly with Mongoose's Schema.Types
(mongoose.Schema.Types as SchemaTypesWithDateOnly).DateOnly = DateOnly;
