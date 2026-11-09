import {
  type AdminContribution,
  APIError,
  logger,
  type TerrenoApp,
  type TerrenoPlugin,
  type WebhooksApp,
} from "@terreno/api";
import type express from "express";

import {CommsService} from "./commsService";
import {PushToken} from "./models/pushToken";
import {addCommsDashboardRoutes} from "./routes/commsDashboard";
import {addPushTokenRoutes} from "./routes/pushTokens";
import type {CommsOptions} from "./types";
import {maybeRegisterSendGridCommsWebhooks} from "./webhooks/sendgridWebhooks";
import {maybeRegisterTwilioCommsWebhooks} from "./webhooks/twilioWebhooks";

export interface CommsAppOptions extends CommsOptions {
  basePath?: string;
  webhookPublicUrl?: string;
  webhooks?: WebhooksApp;
}

let registeredCommsService: CommsService | undefined;

export const getCommsService = (): CommsService => {
  if (!registeredCommsService) {
    throw new APIError({status: 500, title: "CommsApp is not registered"});
  }
  return registeredCommsService;
};

export class CommsApp implements TerrenoPlugin {
  readonly service: CommsService;
  private readonly options: CommsAppOptions;

  constructor(options?: CommsAppOptions) {
    this.options = options ?? {};
    this.service = new CommsService(this.options);
  }

  register(app: express.Application, openApi?: unknown, terrenoApp?: TerrenoApp): void {
    const basePath = this.options.basePath ?? "/comms";
    registeredCommsService = this.service;
    this.service.setUserModel(terrenoApp?.getUserModel());

    // Atomic push-token registration depends on the unique token index to reject concurrent
    // claims, so build it explicitly instead of relying on Mongoose autoIndex being enabled.
    void PushToken.init().catch((error: unknown) => {
      logger.error(
        `[comms] Failed to build PushToken indexes; concurrent token registration cannot be ` +
          `rejected safely until the unique token index exists: ${String(error)}`
      );
    });

    addPushTokenRoutes(app, {basePath: `${basePath}/pushTokens`, openApi});
    addCommsDashboardRoutes(app, {basePath, openApi, service: this.service});
    maybeRegisterTwilioCommsWebhooks({
      basePath,
      publicUrl: this.options.webhookPublicUrl,
      service: this.service,
      sms: this.options.sms,
      webhooks: this.options.webhooks,
    });
    maybeRegisterSendGridCommsWebhooks({
      basePath,
      mail: this.options.mail,
      service: this.service,
      webhooks: this.options.webhooks,
    });
  }

  adminContribution(): AdminContribution {
    return {
      customScreens: [
        {
          displayName: "Comms Dashboard",
          icon: "paper-plane",
          name: "comms",
        },
      ],
    };
  }
}
