import type express from "express";

import {asyncHandler, type OpenApiMiddleware} from "./api";
import {VersionConfig} from "./models/versionConfig";
import {createOpenApiBuilder} from "./openApiBuilder";
import type {TerrenoPlugin} from "./terrenoPlugin";

export type VersionCheckStatus = "ok" | "warning" | "required";

export interface VersionCheckResponse {
  message?: string;
  /** How often the client should poll for updates, in milliseconds. */
  pollingIntervalMs?: number;
  requiredVersion?: number;
  status: VersionCheckStatus;
  updateUrl?: string;
  warningVersion?: number;
}

const DEFAULT_WARNING_MESSAGE =
  "A new version is available. Please update for the best experience.";
const DEFAULT_REQUIRED_MESSAGE = "This version is no longer supported. Please update to continue.";
const DEFAULT_POLLING_INTERVAL_MINUTES = 1440;

/**
 * TerrenoPlugin that adds a public GET /version-check endpoint for upgrade enforcement.
 * Compares client build number against admin-configured thresholds per platform.
 */
export class VersionCheckPlugin implements TerrenoPlugin {
  register(app: express.Application, openApi?: unknown): void {
    // Documentation only: request validation stays off so unparseable versions still get "ok".
    const versionCheckOpenApi = createOpenApiBuilder(
      openApi ? {openApi: openApi as OpenApiMiddleware} : {}
    )
      .withTags(["version"])
      .withSummary("Check whether the client build must or should update")
      .withQueryParameter(
        "platform",
        {enum: ["web", "mobile"], type: "string"},
        {description: "Client platform. Any other value is treated as web."}
      )
      .withQueryParameter(
        "version",
        {type: "integer"},
        {description: "Client build number. When missing or not a number, the status is ok."}
      )
      .withResponse(
        200,
        {
          message: {
            description: "Message to show when status is warning or required",
            type: "string",
          },
          pollingIntervalMs: {
            description: "How often the client should poll for updates, in milliseconds",
            type: "number",
          },
          requiredVersion: {description: "Minimum supported build number", type: "number"},
          status: {enum: ["ok", "warning", "required"], type: "string"},
          updateUrl: {description: "Where the user can get the update", type: "string"},
          warningVersion: {description: "Builds below this number get a warning", type: "number"},
        },
        {required: ["status"]}
      )
      .withValidation({enabled: false})
      .build();

    app.get(
      "/version-check",
      versionCheckOpenApi,
      asyncHandler(async (req, res) => {
        const versionParam = req.query.version;
        const platform = req.query.platform as string | undefined;

        let version: number | undefined;
        if (typeof versionParam === "string") {
          version = parseInt(versionParam, 10);
        } else if (typeof versionParam === "number") {
          version = versionParam;
        }

        if (version === undefined || Number.isNaN(version)) {
          return res.json({status: "ok" as VersionCheckStatus});
        }

        const platformNormalized = platform === "web" || platform === "mobile" ? platform : "web";

        const config = await VersionConfig.findOneOrNone({_singleton: "config"});

        if (!config) {
          return res.json({
            pollingIntervalMs: DEFAULT_POLLING_INTERVAL_MINUTES * 60 * 1000,
            status: "ok" as VersionCheckStatus,
          });
        }

        const requiredVersion =
          platformNormalized === "web"
            ? (config.webRequiredVersion ?? 0)
            : (config.mobileRequiredVersion ?? 0);
        const warningVersion =
          platformNormalized === "web"
            ? (config.webWarningVersion ?? 0)
            : (config.mobileWarningVersion ?? 0);

        const response: VersionCheckResponse = {
          pollingIntervalMs:
            (config.pollingIntervalMinutes ?? DEFAULT_POLLING_INTERVAL_MINUTES) * 60 * 1000,
          requiredVersion: requiredVersion > 0 ? requiredVersion : undefined,
          status: "ok",
          updateUrl: config.updateUrl || undefined,
          warningVersion: warningVersion > 0 ? warningVersion : undefined,
        };

        if (requiredVersion > 0 && version < requiredVersion) {
          response.status = "required";
          response.message = config.requiredMessage ?? DEFAULT_REQUIRED_MESSAGE;
        } else if (warningVersion > 0 && version < warningVersion) {
          response.status = "warning";
          response.message = config.warningMessage ?? DEFAULT_WARNING_MESSAGE;
        }

        return res.json(response);
      })
    );
  }
}
