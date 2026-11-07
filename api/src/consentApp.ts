/**
 * ConsentApp plugin for @terreno/api.
 *
 * Registers consent form management and user consent response routes as a TerrenoPlugin.
 * Provides admin CRUD for consent forms, read-only access to responses, and user-facing
 * endpoints for fetching pending consents and submitting responses.
 */

import {type Application, type RequestHandler, Router} from "express";
import {DateTime} from "luxon";
import type mongoose from "mongoose";
import type {CollectionActionConfig} from "./actions";
import type {AdminContribution} from "./adminTypes";
import {asyncHandler, modelRouter, type OpenApiMiddleware} from "./api";
import type {AuditEventOperation, AuditEventVerb} from "./audit/auditEventModel";
import {isAuditRecorderInstalled, recordAuditEvent} from "./audit/record";
import type {User} from "./auth";
import {authenticateMiddleware} from "./auth";
import {
  getConsentStatuses,
  loadConsentTargetUser,
  provisionalSignerPopulate,
  type ResolveConsentForms,
  resolveFormsForUser,
} from "./consentStatus";
import {APIError} from "./errors";
import {logger} from "./logger";
import {ConsentForm} from "./models/consentForm";
import {ConsentResponse} from "./models/consentResponse";
import {createOpenApiBuilder, type OpenApiSchemaProperty} from "./openApiBuilder";
import {type PermissionMethod, Permissions} from "./permissions";
import {getOpenApiSpecForModel, type PopulatePath} from "./populate";
import type {AnyTerrenoAccess} from "./rbac/types";
import type {TerrenoPlugin} from "./terrenoPlugin";
import type {ConsentFormDocument} from "./types/consentForm";
import type {ConsentResponseDocument} from "./types/consentResponse";
import {isValidObjectId} from "./utils";
import {z} from "./zodOpenApi";

/** Shared populate config for consent response list/read endpoints. */
export const consentResponsePopulatePaths: PopulatePath[] = [
  {
    fields: ["title", "slug", "version", "type"],
    path: "consentFormId",
  },
  {
    fields: ["name", "email"],
    path: "userId",
  },
  {
    fields: ["name", "email"],
    path: "provisionalSignedBy",
  },
];

/** A consent document as `toJSON` serializes it: model fields plus the `id` virtual. */
const consentDocumentOpenApiSchema = (model: mongoose.Model<unknown>): OpenApiSchemaProperty => {
  const {properties, required} = getOpenApiSpecForModel(model);
  return {
    properties: {
      ...(properties as Record<string, OpenApiSchemaProperty>),
      id: {description: "The document id, the same value as _id", type: "string"},
    },
    required: Array.from(new Set([...required, "_id", "id"])),
    type: "object",
  };
};

/** Documentation only: request validation stays off so the handlers behave as before. */
const buildConsentOpenApi = (
  openApi: OpenApiMiddleware | undefined
): {pending: RequestHandler; respond: RequestHandler} => {
  const noop: RequestHandler = (_req, _res, next) => next();
  if (!openApi?.path) {
    return {pending: noop, respond: noop};
  }
  const consentForm = consentDocumentOpenApiSchema(
    ConsentForm as unknown as mongoose.Model<unknown>
  );
  const consentResponse = consentDocumentOpenApiSchema(
    ConsentResponse as unknown as mongoose.Model<unknown>
  );
  return {
    pending: createOpenApiBuilder({openApi})
      .withTags(["consents"])
      .withSummary("List active consent forms the current user still has to answer")
      .withResponse(200, {data: {items: consentForm, type: "array"}}, {required: ["data"]})
      .withValidation({enabled: false})
      .build(),
    respond: createOpenApiBuilder({openApi})
      .withTags(["consents"])
      .withSummary("Submit the current user's response to a consent form")
      .withRequestBody({
        agreed: {description: "Whether the user agreed", required: true, type: "boolean"},
        checkboxValues: {
          additionalProperties: {type: "boolean"},
          description: "Checkbox index (as a string) to whether it was checked",
          type: "object",
        },
        consentFormId: {
          description: "The consent form being answered",
          required: true,
          type: "string",
        },
        locale: {description: "Locale the form was shown in", required: true, type: "string"},
        signature: {
          description: "Signature image data, required when the form captures a signature",
          type: "string",
        },
      })
      .withResponse(200, {data: consentResponse}, {required: ["data"]})
      .withValidation({enabled: false})
      .build(),
  };
};

const PROVISIONAL_NOTE_MAX_LENGTH = 2000;

const provisionalSignBody = z
  .object({
    consentFormId: z.string().min(1, "consentFormId is required"),
    locale: z.string().min(1).optional(),
    note: z
      .string()
      .trim()
      .min(1, "note is required")
      .max(
        PROVISIONAL_NOTE_MAX_LENGTH,
        `note must be at most ${PROVISIONAL_NOTE_MAX_LENGTH} characters`
      ),
    userId: z.string().min(1, "userId is required"),
  })
  .strict();

type ProvisionalSignBody = z.infer<typeof provisionalSignBody>;

const voidProvisionalBody = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, "reason is required")
      .max(
        PROVISIONAL_NOTE_MAX_LENGTH,
        `reason must be at most ${PROVISIONAL_NOTE_MAX_LENGTH} characters`
      ),
  })
  .strict();

type VoidProvisionalBody = z.infer<typeof voidProvisionalBody>;

const voidedByPopulate = {path: "voidedBy", select: "name email"};

const consentStatusQuery = z.object({userId: z.string().min(1, "userId is required")});

type ConsentStatusQuery = z.infer<typeof consentStatusQuery>;

const consentStatusSigner = z.object({
  email: z.string().optional(),
  id: z.string(),
  name: z.string().optional(),
});

/** OpenAPI shape of `ConsentStatusRow`, so generated SDKs type the status rows. */
const consentStatusRows = z.array(
  z.object({
    form: z
      .object({
        _id: z.string(),
        content: z.record(z.string(), z.string()),
        id: z.string(),
        slug: z.string(),
        title: z.string(),
        type: z.string(),
        version: z.number(),
      })
      .passthrough(),
    isConsented: z.boolean(),
    provisional: z
      .object({
        note: z.string().optional(),
        responseId: z.string(),
        signedAt: z.string(),
        signedBy: consentStatusSigner.nullable(),
      })
      .optional(),
    respondedAt: z.string().optional(),
    status: z.enum(["pending", "provisional", "signed", "declined"]),
  })
);

const consentResponseUser = z
  .object({
    _id: z.string(),
    email: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

/** OpenAPI shape of the provisional `ConsentResponse` the sign and void actions return. */
const provisionalConsentResponse = z
  .object({
    _id: z.string(),
    agreed: z.boolean(),
    agreedAt: z.string(),
    consentFormId: z.string(),
    contentSnapshot: z.string().optional(),
    formVersionSnapshot: z.number().optional(),
    id: z.string(),
    locale: z.string(),
    provisional: z.boolean(),
    provisionalNote: z.string().optional(),
    provisionalSignedBy: consentResponseUser,
    userId: z.string(),
    voidedAt: z.string().optional(),
    voidedBy: consentResponseUser.optional(),
    voidReason: z.string().optional(),
  })
  .passthrough();

export interface ConsentAppOptions {
  /**
   * RBAC access control. When set, users whose roles grant `consentResponse:signOnBehalf` may
   * record provisional signatures for other users. When unset, only `user.admin` may.
   */
  accessControl?: AnyTerrenoAccess;
  auditTrail?: boolean;
  aiConfig?: {
    generateContent: (params: {
      type: string;
      description: string;
      locale: string;
    }) => Promise<string>;
    translateContent: (params: {
      content: string;
      fromLocale: string;
      toLocale: string;
    }) => Promise<string>;
  };
  resolveConsentForms?: ResolveConsentForms;
  supportedLocales?: string[];
}

const requireAdmin = (user: User | undefined): void => {
  if (!user?.admin) {
    throw new APIError({status: 403, title: "Admin access required"});
  }
};

interface PopulatedSigner {
  _id: mongoose.Types.ObjectId;
  email?: string;
  name?: string;
}

/** The populated provisional signer, or null when unset or not populated. */
const populatedSigner = (value: unknown): PopulatedSigner | null => {
  if (!value || typeof value !== "object" || !("_id" in value)) {
    return null;
  }
  return value as PopulatedSigner;
};

const signerDisplayName = (signer: PopulatedSigner | null): string => {
  return signer?.name || signer?.email || "Staff";
};

/** The id of a ref that may or may not be populated. */
const idOf = (value: unknown): string => {
  if (value && typeof value === "object" && "_id" in value) {
    return String((value as {_id: unknown})._id);
  }
  return String(value);
};

/** Best-effort AuditEvent for sign-on-behalf actions; a no-op unless AuditApp is registered. */
const recordConsentAudit = ({
  action,
  actorId,
  consentFormId,
  operation,
  recordId,
  recordLabel,
  userId,
  verb,
}: {
  action: "signOnBehalf" | "viewStatus" | "voidProvisional";
  actorId: string;
  consentFormId?: string;
  operation: AuditEventOperation;
  recordId?: string;
  recordLabel?: string;
  userId: string;
  verb: AuditEventVerb;
}): void => {
  if (!isAuditRecorderInstalled()) {
    return;
  }
  void recordAuditEvent({
    actorId,
    after: {action, userId, ...(consentFormId ? {consentFormId} : {})},
    modelName: "ConsentResponse",
    operation,
    recordId,
    recordLabel,
    source: "modelRouter",
    verb,
  });
};

export class ConsentApp implements TerrenoPlugin {
  private options: ConsentAppOptions;

  constructor(options: ConsentAppOptions = {}) {
    this.options = options;
  }

  adminContribution(): AdminContribution {
    return {
      models: [
        {
          admin: {
            defaultSort: "order",
            displayName: "Consent Forms",
            fieldOrder: [
              "title",
              "slug",
              "type",
              "version",
              "order",
              "active",
              "required",
              "content",
              "defaultLocale",
              "requireScrollToBottom",
              "captureSignature",
              "agreeButtonText",
              "allowDecline",
              "declineButtonText",
              "checkboxes",
            ],
            fieldOverrides: {
              checkboxes: {widget: "checkbox-list"},
              content: {widget: "locale-content"},
              defaultLocale: {widget: "locale-default"},
            },
            fieldsets: [
              {
                fields: ["title", "slug", "type", "version", "order", "active", "required"],
                title: "Basics",
              },
              {
                fields: ["content", "defaultLocale", "requireScrollToBottom", "checkboxes"],
                title: "Content",
              },
              {
                fields: [
                  "captureSignature",
                  "agreeButtonText",
                  "allowDecline",
                  "declineButtonText",
                ],
                title: "Actions",
              },
            ],
            filters: [
              {field: "active", kind: "boolean", label: "Active"},
              {
                choices: [
                  {label: "Agreement", value: "agreement"},
                  {label: "Privacy", value: "privacy"},
                  {label: "HIPAA", value: "hipaa"},
                  {label: "Research", value: "research"},
                  {label: "Terms", value: "terms"},
                  {label: "Custom", value: "custom"},
                ],
                field: "type",
                kind: "choice",
                label: "Type",
              },
            ],
            group: "Compliance",
            listDisplay: ["title", "type", "version", "active", "order"],
            listFields: ["title", "type", "version", "active", "order"],
            searchFields: ["title", "slug"],
            sortableFields: ["title", "type", "version", "active", "order", "created"],
          },
          model: ConsentForm as unknown as import("mongoose").Model<unknown>,
          routePath: "/consent-forms",
        },
        {
          admin: {
            adminPermissions: {
              create: [],
              delete: [],
              update: [],
            },
            defaultSort: "-agreedAt",
            displayName: "Consent Responses",
            filters: [
              {field: "agreed", kind: "boolean", label: "Agreed"},
              {field: "provisional", kind: "boolean", label: "Provisional"},
              {field: "locale", kind: "text", label: "Locale"},
            ],
            group: "Compliance",
            listFields: ["userId", "agreed", "provisional", "locale", "agreedAt"],
            searchFields: ["locale"],
            sortableFields: ["agreed", "provisional", "locale", "agreedAt", "created"],
          },
          model: ConsentResponse as unknown as import("mongoose").Model<unknown>,
          populatePaths: consentResponsePopulatePaths,
          routePath: "/consent-responses",
        },
      ],
    };
  }

  register(app: Application, openApi?: unknown): void {
    const {accessControl, auditTrail, resolveConsentForms, aiConfig} = this.options;
    const consentOpenApi = buildConsentOpenApi(openApi as OpenApiMiddleware | undefined);

    if (!accessControl) {
      logger.warn(
        "ConsentApp registered without accessControl; only admins may sign consent on behalf of other users"
      );
    }
    const canSignOnBehalf: PermissionMethod<unknown> = accessControl
      ? accessControl.permission({consentResponse: ["signOnBehalf"]})
      : Permissions.IsAdmin;
    const signOnBehalfPermissions = [Permissions.IsAuthenticated, canSignOnBehalf];

    const collectionActions: Record<string, CollectionActionConfig<unknown, unknown, unknown>> = {};

    if (aiConfig) {
      collectionActions.generate = {
        handler: async ({body, user}) => {
          requireAdmin(user);
          const typedBody = body as {type?: string; description?: string; locale?: string};
          if (!typedBody.type) {
            throw new APIError({status: 400, title: "type is required"});
          }
          if (!typedBody.description) {
            throw new APIError({status: 400, title: "description is required"});
          }
          const locale = typedBody.locale ?? "en";
          const content = await aiConfig.generateContent({
            description: typedBody.description,
            locale,
            type: typedBody.type,
          });
          logger.info("ConsentForm content generated", {locale, type: typedBody.type});
          return {content};
        },
        method: "POST",
        permissions: [Permissions.IsAuthenticated],
        summary: "Generate consent form content with AI",
      };

      collectionActions.translate = {
        handler: async ({body, user}) => {
          requireAdmin(user);
          const typedBody = body as {
            content?: string;
            fromLocale?: string;
            toLocale?: string;
          };
          if (!typedBody.content) {
            throw new APIError({status: 400, title: "content is required"});
          }
          if (!typedBody.fromLocale) {
            throw new APIError({status: 400, title: "fromLocale is required"});
          }
          if (!typedBody.toLocale) {
            throw new APIError({status: 400, title: "toLocale is required"});
          }
          const translated = await aiConfig.translateContent({
            content: typedBody.content,
            fromLocale: typedBody.fromLocale,
            toLocale: typedBody.toLocale,
          });
          logger.info("ConsentForm content translated", {
            fromLocale: typedBody.fromLocale,
            toLocale: typedBody.toLocale,
          });
          return {content: translated};
        },
        method: "POST",
        permissions: [Permissions.IsAuthenticated],
        summary: "Translate consent form content with AI",
      };
    }

    app.use(
      "/consent-forms",
      modelRouter(ConsentForm, {
        collectionActions,
        instanceActions: {
          publish: {
            handler: async ({doc, user}) => {
              requireAdmin(user);
              const form = doc as ConsentFormDocument;

              const newFormData = {
                active: true,
                agreeButtonText: form.agreeButtonText,
                allowDecline: form.allowDecline,
                captureSignature: form.captureSignature,
                checkboxes: form.checkboxes,
                content: form.content,
                declineButtonText: form.declineButtonText,
                defaultLocale: form.defaultLocale,
                order: form.order,
                required: form.required,
                requireScrollToBottom: form.requireScrollToBottom,
                slug: form.slug,
                title: form.title,
                type: form.type,
                version: form.version + 1,
              };

              const newForm = await ConsentForm.create(newFormData);

              await ConsentForm.updateMany(
                {_id: {$ne: newForm._id}, slug: form.slug},
                {active: false}
              );

              logger.info("ConsentForm published", {
                newVersion: newForm.version,
                slug: newForm.slug,
              });

              return newForm;
            },
            method: "POST",
            permissions: [Permissions.IsAuthenticated],
            summary: "Publish a new version of a consent form",
          },
        },
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        queryFields: ["slug", "type", "active", "version"],
        sort: "order",
      })
    );

    // Admin read-only access to consent responses, plus provisional signing actions
    app.use(
      "/consent-responses",
      modelRouter(ConsentResponse, {
        // Documented in OpenAPI so client SDKs get the provisional signing actions. The admin
        // list and read routes are documented too; they are the same admin-only CRUD reads.
        ...(openApi ? {openApi: openApi as OpenApiMiddleware} : {}),
        collectionActions: {
          provisional: {
            body: provisionalSignBody,
            description:
              "Record that another user agreed to a consent form on the target user's behalf. " +
              "The form stays in the target user's pending list until they respond themselves.",
            handler: async ({body, req, user}) => {
              const signer = user as User;
              const {consentFormId, locale, note, userId} = body as ProvisionalSignBody;

              if (!isValidObjectId(consentFormId)) {
                throw new APIError({status: 400, title: "consentFormId is invalid"});
              }
              if (String(signer.id) === userId) {
                throw new APIError({status: 400, title: "Cannot sign provisionally for yourself"});
              }

              const targetUser = await loadConsentTargetUser(userId);
              const form = await ConsentForm.findOneOrNone({_id: consentFormId});
              if (!form) {
                throw new APIError({status: 404, title: "Consent form not found"});
              }
              if (!form.active) {
                throw new APIError({status: 400, title: "Consent form is not active"});
              }

              const {resolvedForms} = await resolveFormsForUser(targetUser, resolveConsentForms);
              if (!resolvedForms.some((resolved) => resolved._id.equals(form._id))) {
                throw new APIError({
                  status: 400,
                  title: "Consent form does not apply to this user",
                });
              }

              const responseLocale = locale ?? form.defaultLocale;
              const responseData: Record<string, unknown> = {
                agreed: true,
                agreedAt: DateTime.now().toJSDate(),
                consentFormId: form._id,
                formVersionSnapshot: form.version,
                locale: responseLocale,
                provisional: true,
                provisionalNote: note,
                provisionalSignedBy: signer.id,
                userId,
              };
              if (auditTrail) {
                responseData.contentSnapshot =
                  form.content.get(responseLocale) ?? form.content.get(form.defaultLocale);
                responseData.provisionalSignerIp = req.ip;
                responseData.provisionalSignerUserAgent = req.headers["user-agent"];
              }

              const response = await ConsentResponse.create(responseData);

              recordConsentAudit({
                action: "signOnBehalf",
                actorId: String(signer.id),
                consentFormId: form._id.toString(),
                operation: "create",
                recordId: response._id.toString(),
                recordLabel: form.title,
                userId,
                verb: "created",
              });

              logger.info("Provisional consent recorded", {
                consentFormId: form._id.toString(),
                signerId: String(signer.id),
                userId,
              });

              return response.populate(provisionalSignerPopulate);
            },
            method: "POST",
            permissions: signOnBehalfPermissions,
            response: provisionalConsentResponse,
            summary: "Sign a consent form provisionally on behalf of another user",
          },
          status: {
            description:
              "Consent status of every form that applies to a user: pending, provisional, " +
              "signed, or declined. Provisional counts as consented.",
            handler: async ({query, user}) => {
              const {userId} = query as ConsentStatusQuery;
              const rows = await getConsentStatuses({resolveConsentForms, userId});
              recordConsentAudit({
                action: "viewStatus",
                actorId: String((user as User).id),
                operation: "read",
                recordLabel: "Consent status",
                userId,
                verb: "viewed",
              });
              return rows;
            },
            method: "GET",
            permissions: signOnBehalfPermissions,
            query: consentStatusQuery,
            response: consentStatusRows,
            summary: "List a user's consent status for each form",
          },
        },
        instanceActions: {
          void: {
            body: voidProvisionalBody,
            description:
              "Mark a provisional signature made in error as void. The record is kept for audit " +
              "and no longer counts as consent.",
            handler: async ({body, doc, user}) => {
              const response = doc as ConsentResponseDocument;
              const {reason} = body as VoidProvisionalBody;
              if (!response.provisional) {
                throw new APIError({
                  status: 400,
                  title: "Only provisional signatures can be voided",
                });
              }
              if (response.voidedAt) {
                throw new APIError({
                  status: 400,
                  title: "Provisional signature is already voided",
                });
              }

              const actorId = String((user as User).id);
              const voided = await ConsentResponse.findOneAndUpdate(
                {_id: response._id, voidedAt: null},
                {
                  $set: {
                    voidedAt: DateTime.now().toJSDate(),
                    voidedBy: actorId,
                    voidReason: reason,
                  },
                },
                {returnDocument: "after"}
              );
              if (!voided) {
                throw new APIError({
                  status: 400,
                  title: "Provisional signature is already voided",
                });
              }

              const targetUserId = idOf(response.userId);
              const consentFormId = idOf(response.consentFormId);
              recordConsentAudit({
                action: "voidProvisional",
                actorId,
                consentFormId,
                operation: "update",
                recordId: response._id.toString(),
                userId: targetUserId,
                verb: "updated",
              });
              logger.info("Provisional consent voided", {
                consentFormId,
                responseId: response._id.toString(),
                userId: targetUserId,
                voidedBy: actorId,
              });

              return voided.populate([provisionalSignerPopulate, voidedByPopulate]);
            },
            method: "POST",
            permissions: signOnBehalfPermissions,
            response: provisionalConsentResponse,
            summary: "Void a provisional consent signature",
          },
        },
        permissions: {
          create: [],
          delete: [],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [],
        },
        populatePaths: consentResponsePopulatePaths,
      })
    );

    // User-facing consent endpoints
    const router = Router();

    // GET /consents/pending - fetch pending consent forms for the current user
    router.get(
      "/pending",
      authenticateMiddleware(),
      consentOpenApi.pending,
      asyncHandler(async (req, res) => {
        const user = req.user as User | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        logger.debug("Fetching pending consent forms", {userId: user.id});

        const {activeForms, resolvedForms} = await resolveFormsForUser(user, resolveConsentForms);
        if (resolveConsentForms) {
          logger.debug("resolveConsentForms applied", {
            activeFormCount: activeForms.length,
            resolvedFormCount: resolvedForms.length,
            userAdmin: Boolean(user.admin),
            userId: user.id,
          });
        }

        // Only the user's own responses clear a form. A provisional signature counts as
        // consent for compliance, but the user still sees and signs the form themselves.
        const existingResponses = await ConsentResponse.find({
          provisional: {$ne: true},
          userId: user.id,
        });

        const pendingForms = resolvedForms.filter((form) => {
          const formId = form._id.toString();
          const matchingResponses = existingResponses.filter(
            (r) => r.consentFormId.toString() === formId
          );
          if (matchingResponses.length === 0) {
            return true;
          }
          return !matchingResponses.some((r) => r.formVersionSnapshot === form.version);
        });

        // The user sees who signed provisionally and when, never the signer's note.
        const provisionalResponses = await ConsentResponse.find({
          consentFormId: {$in: pendingForms.map((form) => form._id)},
          provisional: true,
          userId: user.id,
          voidedAt: null,
        })
          .sort({agreedAt: -1})
          .populate(provisionalSignerPopulate);
        const pendingData = pendingForms.map((form) => {
          const latest = provisionalResponses.find(
            (response) =>
              response.consentFormId.toString() === form._id.toString() &&
              response.formVersionSnapshot === form.version
          );
          const formJson = form.toJSON();
          if (!latest) {
            return formJson;
          }
          return {
            ...formJson,
            provisionalSignature: {
              signedAt: latest.agreedAt,
              signedByName: signerDisplayName(populatedSigner(latest.provisionalSignedBy)),
            },
          };
        });

        const filteredOutByResolverCount = Math.max(activeForms.length - resolvedForms.length, 0);
        const filteredOutByResponsesCount = Math.max(resolvedForms.length - pendingForms.length, 0);

        logger.info("Pending consent forms fetched", {
          activeFormCount: activeForms.length,
          filteredOutByResolverCount,
          filteredOutByResponsesCount,
          pendingFormCount: pendingForms.length,
          resolvedFormCount: resolvedForms.length,
          responseCount: existingResponses.length,
          userAdmin: Boolean(user.admin),
          userId: user.id,
        });

        return res.json({data: pendingData});
      })
    );

    // POST /consents/respond - submit a consent response
    router.post(
      "/respond",
      authenticateMiddleware(),
      consentOpenApi.respond,
      asyncHandler(async (req, res) => {
        const user = req.user as User | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const {agreed, checkboxValues, consentFormId, locale, signature} = req.body;

        if (!consentFormId) {
          throw new APIError({status: 400, title: "consentFormId is required"});
        }
        if (agreed === undefined || agreed === null) {
          throw new APIError({status: 400, title: "agreed field is required"});
        }
        if (!locale) {
          throw new APIError({status: 400, title: "locale is required"});
        }

        const form = await ConsentForm.findExactlyOne(
          {_id: consentFormId},
          {status: 404, title: "Consent form not found"}
        );

        if (!form.active) {
          throw new APIError({status: 400, title: "Consent form is not active"});
        }

        if (form.captureSignature && agreed && !signature) {
          throw new APIError({
            status: 400,
            title: "Signature is required for this consent form",
          });
        }

        if (agreed && form.checkboxes.length > 0) {
          const values = checkboxValues ?? {};
          for (let i = 0; i < form.checkboxes.length; i++) {
            const checkbox = form.checkboxes[i];
            if (checkbox.required && !values[i.toString()]) {
              throw new APIError({
                status: 400,
                title: `Required checkbox "${checkbox.label}" must be checked`,
              });
            }
          }
        }

        const responseData: Record<string, unknown> = {
          agreed,
          agreedAt: DateTime.now().toJSDate(),
          consentFormId: form._id,
          locale,
          userId: user.id,
        };

        if (checkboxValues !== undefined) {
          responseData.checkboxValues = checkboxValues;
        }

        if (signature) {
          responseData.signature = signature;
          responseData.signedAt = DateTime.now().toJSDate();
        }

        if (auditTrail) {
          responseData.ipAddress = req.ip;
          responseData.userAgent = req.headers["user-agent"];
          responseData.contentSnapshot =
            form.content.get(locale) ?? form.content.get(form.defaultLocale);
          responseData.formVersionSnapshot = form.version;
        } else {
          responseData.formVersionSnapshot = form.version;
        }

        const response = await ConsentResponse.create(responseData);

        logger.info("Consent response recorded", {
          agreed,
          consentFormId: form._id.toString(),
          locale,
          userId: user.id,
        });

        return res.json({data: response});
      })
    );

    // GET /consents/my - fetch the current user's consent responses with form data
    router.get(
      "/my",
      authenticateMiddleware(),
      asyncHandler(async (req, res) => {
        const user = req.user as User | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const responses = await ConsentResponse.find({userId: user.id})
          .sort({agreedAt: -1})
          .populate(provisionalSignerPopulate);

        const formIds = responses.map((r) => r.consentFormId);
        const forms = await ConsentForm.find({_id: {$in: formIds}});
        const formMap = new Map(forms.map((f) => [f._id.toString(), f]));

        const data = responses.map((response) => {
          const form = formMap.get(response.consentFormId.toString());
          return {
            _id: response._id,
            agreed: response.agreed,
            agreedAt: response.agreedAt,
            checkboxValues: response.checkboxValues,
            contentSnapshot: response.contentSnapshot,
            form: form
              ? {
                  captureSignature: form.captureSignature,
                  checkboxes: form.checkboxes,
                  slug: form.slug,
                  title: form.title,
                  type: form.type,
                  version: form.version,
                }
              : null,
            formVersionSnapshot: response.formVersionSnapshot,
            ipAddress: response.ipAddress,
            locale: response.locale,
            provisional: Boolean(response.provisional),
            // Name only: the signer's note and request metadata stay admin-only.
            provisionalSignedBy: response.provisional
              ? {name: signerDisplayName(populatedSigner(response.provisionalSignedBy))}
              : null,
            signature: response.signature,
            signedAt: response.signedAt,
            userAgent: response.userAgent,
            voidedAt: response.voidedAt,
          };
        });

        return res.json({data});
      })
    );

    if (auditTrail) {
      router.get(
        "/audit/:userId",
        authenticateMiddleware(),
        asyncHandler(async (req, res) => {
          const user = req.user as User | undefined;
          if (!user?.admin) {
            throw new APIError({status: 403, title: "Admin access required"});
          }

          const responses = await ConsentResponse.find({userId: req.params.userId})
            .sort({agreedAt: -1})
            .populate(provisionalSignerPopulate)
            .populate(voidedByPopulate);

          const formIds = responses.map((r) => r.consentFormId);
          const forms = await ConsentForm.find({_id: {$in: formIds}});
          const formMap = new Map(forms.map((f) => [f._id.toString(), f]));

          const auditEntries = responses.map((response) => {
            const form = formMap.get(response.consentFormId.toString());
            return {
              agreed: response.agreed,
              agreedAt: response.agreedAt,
              contentSnapshot: response.contentSnapshot,
              form: form
                ? {
                    slug: form.slug,
                    title: form.title,
                    type: form.type,
                    version: form.version,
                  }
                : null,
              formVersionSnapshot: response.formVersionSnapshot,
              ipAddress: response.ipAddress,
              locale: response.locale,
              provisional: Boolean(response.provisional),
              provisionalNote: response.provisionalNote,
              provisionalSignedBy: populatedSigner(response.provisionalSignedBy),
              provisionalSignerIp: response.provisionalSignerIp,
              provisionalSignerUserAgent: response.provisionalSignerUserAgent,
              responseId: response._id,
              signedAt: response.signedAt,
              userAgent: response.userAgent,
              voidedAt: response.voidedAt,
              voidedBy: populatedSigner(response.voidedBy),
              voidReason: response.voidReason,
            };
          });

          return res.json({data: auditEntries});
        })
      );
    }

    app.use("/consents", router);

    logger.info("ConsentApp registered", {auditTrail: Boolean(auditTrail)});
  }
}
