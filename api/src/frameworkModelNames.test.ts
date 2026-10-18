import {afterAll, describe, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import {createAuditEventModel} from "./audit/auditEventModel";
import {AuthToken} from "./authTokens";
import {FRAMEWORK_MODEL_PUBLIC_NAMES, publicFrameworkModelName} from "./frameworkModelNames";
import {McpServiceToken} from "./models/mcpServiceToken";
import {Notification} from "./models/notification";
import {NotificationPreference} from "./models/notificationPreference";
import {getMembershipModel, getOrganizationModel} from "./orgs/organizationModel";
import {getWebhookReceiptModel} from "./webhooks/idempotency/webhookReceipt";

const CONSUMER_MODEL_NAMES = [
  "AuditEvent",
  "AuthToken",
  "McpServiceToken",
  "Membership",
  "Notification",
  "NotificationPreference",
  "Organization",
  "WebhookReceipt",
] as const;

afterAll(() => {
  for (const modelName of CONSUMER_MODEL_NAMES) {
    if (mongoose.models[modelName]) {
      mongoose.deleteModel(modelName);
    }
  }
});

describe("framework model names", () => {
  it("uses Terreno-specific names without changing existing collection names", () => {
    const models = [
      [createAuditEventModel(mongoose.connection), "TerrenoAuditEvent", "auditevents"],
      [AuthToken, "TerrenoAuthToken", "authtokens"],
      [McpServiceToken, "TerrenoMcpServiceToken", "mcpservicetokens"],
      [getMembershipModel(), "TerrenoMembership", "memberships"],
      [Notification, "TerrenoInboxNotification", "notifications"],
      [NotificationPreference, "TerrenoNotificationPreference", "notificationpreferences"],
      [getOrganizationModel(), "TerrenoOrganization", "organizations"],
      [getWebhookReceiptModel(), "TerrenoWebhookReceipt", "webhookReceipts"],
    ] as const;

    for (const [model, modelName, collectionName] of models) {
      assert.equal(model.modelName, modelName);
      assert.equal(model.collection.collectionName, collectionName);
      assert.equal(publicFrameworkModelName(modelName), FRAMEWORK_MODEL_PUBLIC_NAMES[modelName]);
    }
    assert.equal(publicFrameworkModelName("Todo"), "Todo");
    assert.equal(publicFrameworkModelName("TerrenoInboxNotification"), "Notification");
    assert.equal(publicFrameworkModelName("TerrenoAnnouncement"), "Announcement");
    assert.equal(publicFrameworkModelName("TerrenoJob"), "Job");
  });

  it("allows consumers to register the former generic model names", () => {
    for (const modelName of CONSUMER_MODEL_NAMES) {
      assert.doesNotThrow(() => mongoose.model(modelName, new mongoose.Schema({})));
    }
  });
});
