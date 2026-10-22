/**
 * ConsentApp plugin for @terreno/api.
 *
 * Registers consent form management and user consent response routes as a TerrenoPlugin.
 * Provides admin CRUD for consent forms, read-only access to responses, and user-facing
 * endpoints for fetching pending consents and submitting responses.
 */

import {type Application, type RequestHandler, Router} from "express";
import {DateTime} from "luxon";
import type {Model} from "mongoose";
import type {CollectionActionConfig} from "./actions";
import type {AdminContribution} from "./adminTypes";
import {asyncHandler, modelRouter, type OpenApiMiddleware} from "./api";
import type {User} from "./auth";
import {authenticateMiddleware} from "./auth";
import {APIError} from "./errors";
import {logger} from "./logger";
import {ConsentForm} from "./models/consentForm";
import {ConsentResponse} from "./models/consentResponse";
import {createOpenApiBuilder, type OpenApiSchemaProperty} from "./openApiBuilder";
import {Permissions} from "./permissions";
import {getOpenApiSpecForModel, type PopulatePath} from "./populate";
import type {TerrenoPlugin} from "./terrenoPlugin";
import type {ConsentFormDocument} from "./types/consentForm";

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
];

/** A consent document as `toJSON` serializes it: model fields plus the `id` virtual. */
const consentDocumentOpenApiSchema = (model: Model<unknown>): OpenApiSchemaProperty => {
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
  const consentForm = consentDocumentOpenApiSchema(ConsentForm as unknown as Model<unknown>);
  const consentResponse = consentDocumentOpenApiSchema(
    ConsentResponse as unknown as Model<unknown>
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

export interface ConsentAppOptions {
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
  resolveConsentForms?: (
    user: User,
    forms: ConsentFormDocument[]
  ) => ConsentFormDocument[] | Promise<ConsentFormDocument[]>;
  supportedLocales?: string[];
}

const requireAdmin = (user: User | undefined): void => {
  if (!user?.admin) {
    throw new APIError({status: 403, title: "Admin access required"});
  }
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
              {field: "locale", kind: "text", label: "Locale"},
            ],
            group: "Compliance",
            listFields: ["userId", "agreed", "locale", "agreedAt"],
            searchFields: ["locale"],
            sortableFields: ["agreed", "locale", "agreedAt", "created"],
          },
          model: ConsentResponse as unknown as import("mongoose").Model<unknown>,
          populatePaths: consentResponsePopulatePaths,
          routePath: "/consent-responses",
        },
      ],
    };
  }

  register(app: Application, openApi?: unknown): void {
    const {auditTrail, resolveConsentForms, aiConfig} = this.options;
    const consentOpenApi = buildConsentOpenApi(openApi as OpenApiMiddleware | undefined);

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

    // Admin read-only access to consent responses
    app.use(
      "/consent-responses",
      modelRouter(ConsentResponse, {
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

        const activeForms = await ConsentForm.find({active: true}).sort({order: 1});

        let resolvedForms: ConsentFormDocument[];
        if (resolveConsentForms) {
          resolvedForms = await resolveConsentForms(user, activeForms);
          logger.debug("resolveConsentForms applied", {
            activeFormCount: activeForms.length,
            resolvedFormCount: resolvedForms.length,
            userAdmin: Boolean(user.admin),
            userId: user.id,
          });
        } else {
          resolvedForms = activeForms;
        }

        const existingResponses = await ConsentResponse.find({userId: user.id});

        const respondedFormVersions = new Map<string, number>();
        for (const response of existingResponses) {
          const formId = response.consentFormId.toString();
          respondedFormVersions.set(formId, response.formVersionSnapshot ?? 0);
        }

        const respondedFormIds = existingResponses.map((r) => r.consentFormId);
        const respondedForms = await ConsentForm.find({_id: {$in: respondedFormIds}});
        const formVersionByFormId = new Map<string, number>();
        for (const form of respondedForms) {
          formVersionByFormId.set(form._id.toString(), form.version);
        }

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

        return res.json({data: pendingForms});
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

        const responses = await ConsentResponse.find({userId: user.id}).sort({agreedAt: -1});

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
            signature: response.signature,
            signedAt: response.signedAt,
            userAgent: response.userAgent,
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

          const responses = await ConsentResponse.find({userId: req.params.userId}).sort({
            agreedAt: -1,
          });

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
              responseId: response._id,
              signedAt: response.signedAt,
              userAgent: response.userAgent,
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
