import {OpenFeature} from "@openfeature/server-sdk";
import {
  type AdminContribution,
  APIError,
  asyncHandler,
  authenticateMiddleware,
  logger,
  type ModelRouterOptions,
  modelRouter,
  type OpenApiMiddleware,
  Permissions,
  type TerrenoPlugin,
} from "@terreno/api";
import type express from "express";
import type {Model} from "mongoose";
import mongoose from "mongoose";
import {evaluateAllFlags} from "./evaluate";
import {FeatureFlag} from "./featureFlagModel";
import {buildFlagDefinition} from "./flagConfiguration";
import {MongoFeatureFlagProvider} from "./openFeatureProvider";
import type {
  FeatureFlagDocument,
  FeatureFlagsLiveUpdatesOptions,
  FeatureFlagsOptions,
  FlagConfigurationResponse,
  FlagDefinition,
  SegmentFunction,
} from "./types";

let evaluateDeprecationWarned = false;

const resolveSocketServer = (
  live: FeatureFlagsLiveUpdatesOptions
): import("./types").FeatureFlagsSocketEmitter | null => {
  const server = live.socketIoServer;
  if (typeof server === "function") {
    return server();
  }
  return server;
};

/**
 * TerrenoPlugin that provides feature flags and A/B testing.
 *
 * Creates admin CRUD endpoints for managing flags and a user-facing
 * evaluation endpoint that returns all flag values for the current user.
 *
 * @example
 * ```typescript
 * const segments = {
 *   "pro-users": (user) => user.plan === "pro",
 *   "beta-testers": (user) => user.betaTester === true,
 * };
 *
 * new TerrenoApp({ userModel: User })
 *   .register(new FeatureFlagsApp({ segments }))
 *   .start();
 * ```
 */
export class FeatureFlagsApp implements TerrenoPlugin {
  private options: FeatureFlagsOptions;
  private segments: Record<string, SegmentFunction>;
  private mongoProvider?: MongoFeatureFlagProvider;

  constructor(options?: FeatureFlagsOptions) {
    this.options = options ?? {};
    this.segments = this.options.segments ?? {};
  }

  adminContribution(): AdminContribution {
    return {
      homeWidgets: [{displayName: "Flag Overrides", icon: "flag", id: "feature-flags-overrides"}],
      models: [
        {
          admin: {
            defaultSort: "-created",
            displayName: "Feature Flags",
            listFields: ["key", "name", "type", "enabled", "archived", "defaultVariant", "created"],
            searchFields: ["key", "name"],
            sortableFields: ["key", "name", "type", "enabled", "archived", "created"],
          },
          model: FeatureFlag as Model<FeatureFlagDocument>,
          routePath: "/feature-flags",
        },
      ],
    };
  }

  register(app: express.Application, openApi?: unknown): void {
    const basePath = this.options.basePath ?? "/feature-flags";
    const openFeatureDomain = this.options.openFeatureDomain ?? "feature-flags";

    const routerOptions: ModelRouterOptions<FeatureFlagDocument> = {
      ...(openApi ? {openApi: openApi as OpenApiMiddleware} : {}),
      permissions: this.options.permissions ?? {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAdmin],
        read: [Permissions.IsAdmin],
        update: [Permissions.IsAdmin],
      },
      sort: "-created",
    };

    this.mongoProvider = new MongoFeatureFlagProvider({
      flagModel: FeatureFlag,
      segments: this.segments,
    });
    OpenFeature.setProvider(openFeatureDomain, this.mongoProvider);

    app.use(
      `${basePath}/flags`,
      modelRouter(FeatureFlag as Model<FeatureFlagDocument>, routerOptions)
    );

    app.get(
      `${basePath}/flagConfiguration`,
      authenticateMiddleware(),
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const user = req.user as {_id?: unknown; id?: string} | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const targetingKey = String(user._id ?? user.id);
        const flags = await FeatureFlag.find({archived: {$ne: true}});
        const config: Record<string, FlagDefinition> = {};

        for (const flag of flags) {
          // Disabled boolean flags are sent as `off` so clients can tell a turned-off
          // flag from one that was never created. Disabled variant flags stay omitted.
          if (!flag.enabled && flag.type !== "boolean") {
            continue;
          }
          config[flag.key] = buildFlagDefinition(flag, targetingKey, user, this.segments);
        }

        const body: FlagConfigurationResponse = {data: config};
        return res.json(body);
      })
    );

    app.get(
      `${basePath}/evaluate`,
      authenticateMiddleware(),
      asyncHandler(async (req: express.Request, res: express.Response) => {
        if (!evaluateDeprecationWarned) {
          evaluateDeprecationWarned = true;
          logger.warn(
            "[feature-flags] GET /evaluate is deprecated; migrate clients to GET /flagConfiguration or use @terreno/rtk useFeatureFlags / useTerrenoFeatureFlags."
          );
        }

        const sunset = new Date(Date.now() + 90 * 86400000).toUTCString();
        res.setHeader("Deprecation", "true");
        res.setHeader("Sunset", sunset);

        const user = req.user as {_id?: unknown; id?: string} | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const userId = String(user._id ?? user.id);
        const results = await evaluateAllFlags(FeatureFlag, userId, user, this.segments);

        return res.json({data: results});
      })
    );

    app.get(
      `${basePath}/segments`,
      authenticateMiddleware(),
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const user = req.user;
        const allowed = this.options.segmentsPermission
          ? this.options.segmentsPermission(user)
          : Boolean((user as {admin?: boolean} | undefined)?.admin);
        if (!allowed) {
          throw new APIError({status: 403, title: "Only admins can view segments"});
        }

        return res.json({data: Object.keys(this.segments)});
      })
    );

    const live = this.options.liveUpdates;
    if (live && this.mongoProvider) {
      const eventName = live.eventName ?? "featureFlagsChanged";
      let stream: {
        close: () => Promise<void> | void;
        on: (event: string, handler: (...args: unknown[]) => void) => unknown;
      } | null = null;
      let didRetry = false;

      const cleanupStream = (): void => {
        try {
          stream?.close();
        } catch {
          /* ignore close errors */
        }
        stream = null;
      };

      const bindStream = (): void => {
        try {
          stream = FeatureFlag.watch([], {fullDocument: "updateLookup"});
        } catch (err) {
          logger.warn(
            `[feature-flags] FeatureFlag.watch() failed — live updates require MongoDB as a replica set (even single-node). ${String(err)}`
          );
          return;
        }

        stream.on("change", (change) => {
          const key = (change as {fullDocument?: {key?: string}}).fullDocument?.key;
          const ioResolved = resolveSocketServer(live);
          if (ioResolved) {
            ioResolved.emit(eventName, {key});
          }
          this.mongoProvider?.emitConfigurationChanged();
        });

        stream.on("error", (err) => {
          logger.warn(`[feature-flags] change stream error: ${String(err)}`);
          cleanupStream();
          if (!didRetry) {
            didRetry = true;
            bindStream();
            return;
          }
          logger.warn("[feature-flags] change stream disabled after repeated errors");
        });
      };

      bindStream();

      const onConnectionClose = (): void => {
        cleanupStream();
      };
      mongoose.connection.on("close", onConnectionClose);
    }
  }
}
