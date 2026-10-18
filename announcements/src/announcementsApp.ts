import {
  type AdminContribution,
  APIError,
  asyncHandler,
  authenticateMiddleware,
  createOpenApiBuilder,
  findOneOrNoneFor,
  logger,
  type ModelRouterOptions,
  modelRouter,
  type OpenApiMiddleware,
  type PermissionMethod,
  Permissions,
  type TerrenoPlugin,
} from "@terreno/api";
import {type Application, type Request, type Response, Router} from "express";
import {DateTime} from "luxon";
import type {Model} from "mongoose";
import {registerAnnouncementHelpRoutes} from "./helpRoutes";
import {Announcement, toAnnouncementPublic} from "./models/announcement";
import {AnnouncementAcknowledgement} from "./models/announcementAcknowledgement";
import {AnnouncementClickEvent} from "./models/announcementClickEvent";
import {AnnouncementImpression, isValidPlatform} from "./models/announcementImpression";
import {fetchAnnouncementOverview, parseOverviewPagination} from "./overview";
import {
  isAnnouncementVisibleNow,
  isAnnouncementVisibleToUser,
  matchAudienceByType,
  matchesPlatform,
  parseQueryVersion,
  passesMinBuildNumber,
  selectPendingAnnouncements,
} from "./pending";
import {
  announcementReleaseImportSchema,
  importAnnouncementRelease,
  requireAnnouncementUploadAccess,
} from "./releaseImport";
import {
  announcementClickBodySchema,
  announcementClickPlatformSchema,
  announcementImpressionBodySchema,
  parseAnnouncementBody,
} from "./requestBodies";
import type {
  AcknowledgementPolicy,
  AnnouncementDocument,
  AnnouncementPlatform,
  AnnouncementsOptions,
} from "./types";

const DEFAULT_BASE_PATH = "/announcements";

const defaultIsStaff = (user: unknown): boolean => (user as {admin?: boolean}).admin === true;

const parsePlatform = (req: Request): AnnouncementPlatform => {
  const queryPlatform = req.query.platform;
  if (isValidPlatform(queryPlatform)) {
    return queryPlatform;
  }

  const userAgent = req.get("user-agent")?.toLowerCase() ?? "";
  if (userAgent.includes("iphone") || userAgent.includes("ipad")) {
    return "ios";
  }
  if (userAgent.includes("android")) {
    return "android";
  }
  return "web";
};

const requireAdmin = (user: {_id?: unknown; admin?: boolean} | undefined): void => {
  if (!user?.admin) {
    throw new APIError({status: 403, title: "Admin access required"});
  }
};

const requireOverviewAccess = async ({
  permissions,
  user,
}: {
  permissions: PermissionMethod<AnnouncementDocument>[];
  user: unknown;
}): Promise<void> => {
  if (permissions.length === 0) {
    throw new APIError({status: 403, title: "Admin access required"});
  }
  for (const permission of permissions) {
    const isAllowed = await permission("list", user as never);
    if (!isAllowed) {
      throw new APIError({status: 403, title: "Admin access required"});
    }
  }
};

const getUserId = (user: {_id?: unknown; id?: string}): string => {
  const userId = user._id ?? user.id;
  if (!userId) {
    throw new APIError({status: 401, title: "Authentication required"});
  }
  return String(userId);
};

const hasPrimaryAction = (announcement: AnnouncementDocument): boolean => {
  const label = announcement.primaryAction?.label?.trim();
  const url = announcement.primaryAction?.url?.trim();
  return Boolean(label && url);
};

const requireVisibleAnnouncement = async ({
  announcement,
  isStaff,
  matchAudience,
  platform,
  queryVersion,
  user,
}: {
  announcement: AnnouncementDocument | null;
  isStaff: (user: unknown) => boolean;
  matchAudience: (user: unknown, announcement: AnnouncementDocument) => boolean | Promise<boolean>;
  platform: AnnouncementPlatform;
  queryVersion?: number;
  user: unknown;
}): Promise<AnnouncementDocument> => {
  if (!announcement) {
    throw new APIError({status: 404, title: "Announcement not found"});
  }

  const visible = await isAnnouncementVisibleToUser({
    announcement,
    isStaff,
    matchAudience,
    platform,
    queryVersion,
    user,
  });
  if (!visible) {
    throw new APIError({status: 404, title: "Announcement not found"});
  }

  return announcement;
};

export class AnnouncementsApp implements TerrenoPlugin {
  private options: AnnouncementsOptions;

  constructor(options?: AnnouncementsOptions) {
    this.options = options ?? {};
  }

  adminContribution(): AdminContribution {
    return {
      customScreens: [
        {
          displayName: "Overview",
          group: "Announcements",
          icon: "bullhorn",
          name: "announcements",
        },
      ],
      models: [
        {
          admin: {
            defaultSort: "-priority,-publishedAt",
            displayName: "All announcements",
            group: "Announcements",
            listDisplayLinks: ["title"],
            listFields: [
              "title",
              "status",
              "priority",
              "version",
              "publishedAt",
              "expiresAt",
              "acknowledgementPolicy",
            ],
            searchFields: ["title"],
            sortableFields: ["title", "status", "priority", "version", "publishedAt", "created"],
          },
          model: Announcement as Model<AnnouncementDocument>,
          routePath: "/announcements",
        },
        {
          admin: {
            adminPermissions: {
              create: [],
              delete: [],
              list: [Permissions.IsAdmin],
              read: [Permissions.IsAdmin],
              update: [],
            },
            defaultSort: "-acknowledgedAt",
            displayName: "Acknowledgements",
            group: "Announcements",
            listFields: ["userId", "announcementId", "version", "acknowledgedAt"],
          },
          model: AnnouncementAcknowledgement as Model<unknown>,
          routePath: "/announcement-acknowledgements",
        },
        {
          admin: {
            adminPermissions: {
              create: [],
              delete: [],
              list: [Permissions.IsAdmin],
              read: [Permissions.IsAdmin],
              update: [],
            },
            defaultSort: "-viewedAt",
            displayName: "Impressions",
            group: "Announcements",
            listFields: ["userId", "announcementId", "version", "viewedAt", "platform"],
          },
          model: AnnouncementImpression as Model<unknown>,
          routePath: "/announcement-impressions",
        },
        {
          admin: {
            adminPermissions: {
              create: [],
              delete: [],
              list: [Permissions.IsAdmin],
              read: [Permissions.IsAdmin],
              update: [],
            },
            defaultSort: "-clickedAt",
            displayName: "Click events",
            group: "Announcements",
            listFields: ["userId", "announcementId", "version", "action", "clickedAt", "platform"],
          },
          model: AnnouncementClickEvent as Model<unknown>,
          routePath: "/announcement-click-events",
        },
      ],
    };
  }

  register(app: Application, openApi?: unknown): void {
    const basePath = this.options.basePath ?? DEFAULT_BASE_PATH;
    const defaultAcknowledgementPolicy: AcknowledgementPolicy =
      this.options.defaultAcknowledgementPolicy ?? "dismiss-only";
    const overviewPermissions = this.options.adminOverviewPermissions ?? [Permissions.IsAdmin];
    const matchAudience = this.options.matchAudience ?? (() => true);
    const isStaff = this.options.isStaff ?? defaultIsStaff;

    const matchesAnnouncementAudience = async (
      user: unknown,
      announcement: AnnouncementDocument
    ): Promise<boolean> => {
      if (!matchAudienceByType({announcement, isStaff, user})) {
        return false;
      }
      return matchAudience(user, announcement);
    };

    const routerOptions: ModelRouterOptions<AnnouncementDocument> = {
      ...(openApi ? {openApi: openApi as OpenApiMiddleware} : {}),
      collectionActions: {
        "import-release": {
          allowAnonymous: true,
          body: announcementReleaseImportSchema,
          description:
            "Idempotently create or update a release pack. Defaults to drafts; set publish=true to publish.",
          handler: async ({body, req}) => {
            requireAnnouncementUploadAccess({req, uploadToken: this.options.uploadToken});
            return importAnnouncementRelease({input: body});
          },
          method: "POST",
          permissions: [Permissions.IsAny],
          summary: "Import a product release announcement pack",
          tag: "announcements",
        },
      },
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAdmin],
        read: [Permissions.IsAdmin],
        update: [Permissions.IsAdmin],
        ...this.options.permissions,
      },
      queryFields: ["status", "priority", "title"],
      sort: "-priority,-publishedAt",
    };

    const userRouter = Router();

    userRouter.get(
      "/pending",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const userId = getUserId(user as {_id?: unknown; id?: string});
        const platform = parsePlatform(req);
        const queryVersion = parseQueryVersion(req.query.version);
        const published = (await Announcement.find({status: "published"}).lean()) as Array<
          AnnouncementDocument & {requiresAcknowledgement?: boolean}
        >;
        const audienceFiltered: AnnouncementDocument[] = [];
        for (const announcement of published) {
          const matches = await matchesAnnouncementAudience(user, announcement);
          if (matches) {
            audienceFiltered.push(announcement);
          }
        }

        const acknowledgements = await AnnouncementAcknowledgement.find({userId}).select(
          "announcementId version"
        );
        const impressions = await AnnouncementImpression.find({userId}).select(
          "announcementId version"
        );

        const pending = selectPendingAnnouncements({
          acknowledgements: acknowledgements.map((ack) => ({
            announcementId: ack.announcementId.toString(),
            version: ack.version,
          })),
          announcements: audienceFiltered,
          defaultAcknowledgementPolicy,
          impressions: impressions.map((impression) => ({
            announcementId: impression.announcementId.toString(),
            version: impression.version,
          })),
          platform,
          queryVersion,
        });

        const current = pending[0]
          ? toAnnouncementPublic(pending[0], defaultAcknowledgementPolicy)
          : null;
        const remainingCount = Math.max(pending.length - (current ? 1 : 0), 0);

        logger.info("Pending announcements fetched", {
          currentId: current?.id,
          platform,
          remainingCount,
          userId,
        });

        return res.json({data: {current, remainingCount}});
      })
    );

    userRouter.get(
      "/feed",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const platform = parsePlatform(req);
        const queryVersion = parseQueryVersion(req.query.version);
        const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
        const page = Math.max(Number(req.query.page ?? 1), 1);
        const published = (await Announcement.find({status: "published"}).lean()) as Array<
          AnnouncementDocument & {requiresAcknowledgement?: boolean}
        >;
        const visible: AnnouncementDocument[] = [];

        for (const announcement of published) {
          const matchesAudience = await matchesAnnouncementAudience(user, announcement);
          if (!matchesAudience) {
            continue;
          }
          if (!isAnnouncementVisibleNow({announcement})) {
            continue;
          }
          if (!matchesPlatform({announcement, platform})) {
            continue;
          }
          if (!passesMinBuildNumber({announcement, queryVersion})) {
            continue;
          }
          visible.push(announcement);
        }

        const sorted = visible.sort((left, right) => {
          if (right.priority !== left.priority) {
            return right.priority - left.priority;
          }
          const rightPublished = right.publishedAt?.getTime() ?? 0;
          const leftPublished = left.publishedAt?.getTime() ?? 0;
          return rightPublished - leftPublished;
        });

        const start = (page - 1) * limit;
        const pageItems = sorted
          .slice(start, start + limit)
          .map((announcement) => toAnnouncementPublic(announcement, defaultAcknowledgementPolicy));

        return res.json({
          data: pageItems,
          page,
          total: sorted.length,
        });
      })
    );

    userRouter.post(
      "/:id/acknowledge",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const userId = getUserId(user as {_id?: unknown; id?: string});
        const announcement = await requireVisibleAnnouncement({
          announcement: await Announcement.findById(req.params.id),
          isStaff,
          matchAudience,
          platform: parsePlatform(req),
          queryVersion: parseQueryVersion(req.query.version),
          user,
        });

        const existing = await findOneOrNoneFor(AnnouncementAcknowledgement, {
          announcementId: announcement._id,
          userId,
          version: announcement.version,
        });

        if (!existing) {
          await AnnouncementAcknowledgement.create({
            acknowledgedAt: DateTime.utc().toJSDate(),
            announcementId: announcement._id,
            userId,
            version: announcement.version,
          });
        }

        return res.json({data: {acknowledged: true}});
      })
    );

    userRouter.post(
      "/:id/impression",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const userId = getUserId(user as {_id?: unknown; id?: string});
        const body = parseAnnouncementBody({
          body: req.body,
          schema: announcementImpressionBodySchema,
        });
        const platform = body.platform ?? parsePlatform(req);
        const announcement = await requireVisibleAnnouncement({
          announcement: await Announcement.findById(req.params.id),
          isStaff,
          matchAudience,
          platform,
          queryVersion: parseQueryVersion(req.query.version),
          user,
        });

        await AnnouncementImpression.create({
          announcementId: announcement._id,
          platform,
          userId,
          version: announcement.version,
          viewedAt: DateTime.utc().toJSDate(),
        });

        return res.json({data: {recorded: true}});
      })
    );

    userRouter.post(
      "/:id/click",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const userId = getUserId(user as {_id?: unknown; id?: string});
        const {platform: bodyPlatform} = parseAnnouncementBody({
          body: req.body,
          schema: announcementClickPlatformSchema,
        });
        const platform = bodyPlatform ?? parsePlatform(req);
        const announcement = await requireVisibleAnnouncement({
          announcement: await Announcement.findById(req.params.id),
          isStaff,
          matchAudience,
          platform,
          queryVersion: parseQueryVersion(req.query.version),
          user,
        });

        const body = parseAnnouncementBody({body: req.body, schema: announcementClickBodySchema});

        if (!hasPrimaryAction(announcement)) {
          throw new APIError({status: 400, title: "Announcement has no primary action"});
        }

        await AnnouncementClickEvent.create({
          action: body.action,
          announcementId: announcement._id,
          clickedAt: DateTime.utc().toJSDate(),
          platform,
          userId,
          version: announcement.version,
        });

        return res.json({data: {recorded: true}});
      })
    );

    const adminRouter = Router();
    const routeOpenApi = openApi ? {openApi: openApi as OpenApiMiddleware} : undefined;

    adminRouter.get(
      "/config",
      [
        authenticateMiddleware(),
        ...(routeOpenApi
          ? [
              createOpenApiBuilder(routeOpenApi)
                .withTags(["announcements"])
                .withSummary("Get announcement plugin configuration")
                .withResponse(200, {
                  data: {
                    properties: {
                      defaultAcknowledgementPolicy: {
                        description: '"required" or "dismiss-only"',
                        type: "string",
                      },
                    },
                    type: "object",
                  },
                })
                .build(),
            ]
          : []),
      ],
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req.user as {_id?: unknown; admin?: boolean} | undefined);
        return res.json({data: {defaultAcknowledgementPolicy}});
      })
    );

    adminRouter.get(
      "/overview",
      [
        authenticateMiddleware(),
        ...(routeOpenApi
          ? [
              createOpenApiBuilder(routeOpenApi)
                .withTags(["announcements"])
                .withSummary("Admin overview of announcements with aggregate metrics")
                .withQueryParameter("page", {type: "number"}, {required: false})
                .withQueryParameter("limit", {type: "number"}, {required: false})
                .withResponse(200, {
                  data: {
                    items: {
                      properties: {
                        _id: {type: "string"},
                        acknowledgementPolicy: {type: "string"},
                        audienceType: {type: "string"},
                        displayMode: {type: "string"},
                        expiresAt: {type: "string"},
                        metrics: {
                          properties: {
                            acknowledgements: {type: "number"},
                            clicks: {type: "number"},
                            impressions: {type: "number"},
                          },
                          type: "object",
                        },
                        priority: {type: "number"},
                        publishedAt: {type: "string"},
                        status: {type: "string"},
                        title: {type: "string"},
                        version: {type: "number"},
                      },
                      type: "object",
                    },
                    type: "array",
                  },
                  limit: {type: "number"},
                  more: {type: "boolean"},
                  page: {type: "number"},
                  total: {type: "number"},
                  totals: {
                    properties: {
                      acknowledgements: {type: "number"},
                      announcements: {type: "number"},
                      archived: {type: "number"},
                      clicks: {type: "number"},
                      draft: {type: "number"},
                      impressions: {type: "number"},
                      published: {type: "number"},
                    },
                    type: "object",
                  },
                })
                .build(),
            ]
          : []),
      ],
      asyncHandler(async (req: Request, res: Response) => {
        await requireOverviewAccess({permissions: overviewPermissions, user: req.user});
        const {limit, page} = parseOverviewPagination(req.query);
        const overview = await fetchAnnouncementOverview({
          defaultAcknowledgementPolicy,
          limit,
          page,
        });
        return res.json(overview);
      })
    );

    adminRouter.post(
      "/:id/publish",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req.user as {_id?: unknown; admin?: boolean} | undefined);
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
          throw new APIError({status: 404, title: "Announcement not found"});
        }
        if (announcement.status !== "draft") {
          throw new APIError({
            status: 400,
            title: "Only draft announcements can be published",
          });
        }

        announcement.status = "published";
        announcement.publishedAt = DateTime.utc().toJSDate();
        await announcement.save();

        logger.info("Announcement published", {announcementId: announcement._id.toString()});
        return res.json({data: announcement});
      })
    );

    adminRouter.post(
      "/:id/archive",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req.user as {_id?: unknown; admin?: boolean} | undefined);
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
          throw new APIError({status: 404, title: "Announcement not found"});
        }
        if (announcement.status !== "published") {
          throw new APIError({
            status: 400,
            title: "Only published announcements can be archived",
          });
        }

        announcement.status = "archived";
        announcement.archivedAt = DateTime.utc().toJSDate();
        await announcement.save();

        logger.info("Announcement archived", {announcementId: announcement._id.toString()});
        return res.json({data: announcement});
      })
    );

    app.use(basePath, userRouter);
    app.use(basePath, adminRouter);
    if (this.options.help?.enabled) {
      registerAnnouncementHelpRoutes({
        app,
        basePath,
        defaultAcknowledgementPolicy,
        isStaff,
        matchAudience,
      });
    }
    app.use(basePath, modelRouter(Announcement as Model<AnnouncementDocument>, routerOptions));

    app.use(
      "/announcement-acknowledgements",
      modelRouter(AnnouncementAcknowledgement as Model<unknown>, {
        permissions: {
          create: [],
          delete: [],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [],
        },
        populatePaths: [
          {fields: ["title", "version", "status"], path: "announcementId"},
          {fields: ["email", "name"], path: "userId"},
        ],
      })
    );

    app.use(
      "/announcement-impressions",
      modelRouter(AnnouncementImpression as Model<unknown>, {
        permissions: {
          create: [],
          delete: [],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [],
        },
        populatePaths: [
          {fields: ["title", "version", "status"], path: "announcementId"},
          {fields: ["email", "name"], path: "userId"},
        ],
      })
    );

    app.use(
      "/announcement-click-events",
      modelRouter(AnnouncementClickEvent as Model<unknown>, {
        permissions: {
          create: [],
          delete: [],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [],
        },
        populatePaths: [
          {fields: ["title", "version", "status"], path: "announcementId"},
          {fields: ["email", "name"], path: "userId"},
        ],
      })
    );

    logger.info("AnnouncementsApp registered", {basePath, defaultAcknowledgementPolicy});
  }
}
