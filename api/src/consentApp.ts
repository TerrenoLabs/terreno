/**
 * ConsentApp plugin for @terreno/api.
 *
 * Registers consent form management and user consent response routes as a TerrenoPlugin.
 * Provides admin CRUD for consent forms, read-only access to responses, and user-facing
 * endpoints for fetching pending consents and submitting responses.
 */

import {type Application, Router} from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import {z} from "zod";
import type {CollectionActionConfig} from "./actions";
import type {AdminContribution} from "./adminTypes";
import {asyncHandler, modelRouter} from "./api";
import {isAuditRecorderInstalled, recordAuditEvent} from "./audit/record";
import type {User} from "./auth";
import {authenticateMiddleware} from "./auth";
import {APIError} from "./errors";
import {logger} from "./logger";
import {ConsentForm} from "./models/consentForm";
import {ConsentResponse} from "./models/consentResponse";
import {type PermissionMethod, Permissions} from "./permissions";
import {findOneOrNoneFor} from "./plugins";
import type {PopulatePath} from "./populate";
import type {AnyTerrenoAccess} from "./rbac/types";
import type {TerrenoPlugin} from "./terrenoPlugin";
import type {ConsentFormDocument} from "./types/consentForm";
import {isValidObjectId} from "./utils";

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

/** Fields returned for the provisional signer on provisional consent responses. */
const provisionalSignerPopulate = {path: "provisionalSignedBy", select: "name email"};

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

/** Load the consent forms that apply to a user: active forms, narrowed by the app's resolver. */
const resolveFormsForUser = async (
  user: User,
  resolveConsentForms: ConsentAppOptions["resolveConsentForms"]
): Promise<{activeForms: ConsentFormDocument[]; resolvedForms: ConsentFormDocument[]}> => {
  const activeForms = await ConsentForm.find({active: true}).sort({order: 1});
  if (!resolveConsentForms) {
    return {activeForms, resolvedForms: activeForms};
  }
  const resolvedForms = await resolveConsentForms(user, activeForms);
  return {activeForms, resolvedForms};
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

  register(app: Application): void {
    const {accessControl, auditTrail, resolveConsentForms, aiConfig} = this.options;

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
        collectionActions: {
          provisional: {
            body: provisionalSignBody,
            description:
              "Record that another user agreed to a consent form on the target user's behalf. " +
              "The form stays in the target user's pending list until they respond themselves.",
            handler: async ({body, req, user}) => {
              const signer = user as User;
              const {consentFormId, locale, note, userId} = body as ProvisionalSignBody;

              if (!isValidObjectId(userId)) {
                throw new APIError({status: 400, title: "userId is invalid"});
              }
              if (!isValidObjectId(consentFormId)) {
                throw new APIError({status: 400, title: "consentFormId is invalid"});
              }
              if (String(signer.id) === userId) {
                throw new APIError({status: 400, title: "Cannot sign provisionally for yourself"});
              }

              const targetUser = await findOneOrNoneFor(mongoose.model("User"), {_id: userId});
              if (!targetUser) {
                throw new APIError({status: 404, title: "User not found"});
              }
              const form = await ConsentForm.findOneOrNone({_id: consentFormId});
              if (!form) {
                throw new APIError({status: 404, title: "Consent form not found"});
              }
              if (!form.active) {
                throw new APIError({status: 400, title: "Consent form is not active"});
              }

              const {resolvedForms} = await resolveFormsForUser(
                targetUser as unknown as User,
                resolveConsentForms
              );
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

              if (isAuditRecorderInstalled()) {
                void recordAuditEvent({
                  actorId: String(signer.id),
                  after: {action: "signOnBehalf", consentFormId: form._id.toString(), userId},
                  modelName: "ConsentResponse",
                  operation: "create",
                  recordId: response._id.toString(),
                  recordLabel: form.title,
                  source: "modelRouter",
                  verb: "created",
                });
              }

              logger.info("Provisional consent recorded", {
                consentFormId: form._id.toString(),
                signerId: String(signer.id),
                userId,
              });

              return response.populate(provisionalSignerPopulate);
            },
            method: "POST",
            permissions: signOnBehalfPermissions,
            summary: "Sign a consent form provisionally on behalf of another user",
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
            .populate(provisionalSignerPopulate);

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
