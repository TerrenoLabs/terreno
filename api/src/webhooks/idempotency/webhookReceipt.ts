import {DateTime} from "luxon";
import mongoose from "mongoose";
import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "../../plugins";
import {findExactlyOne, findOneOrNone} from "../../plugins";

export const WEBHOOK_RECEIPTS_COLLECTION = "webhookReceipts";
export const DEFAULT_WEBHOOK_RECEIPT_TTL_DAYS = 7;

type WebhookReceiptMethods = Record<string, never>;

interface WebhookReceiptStatics
  extends FindExactlyOnePlugin<WebhookReceiptDocument>,
    FindOneOrNonePlugin<WebhookReceiptDocument> {}

export interface WebhookReceiptModel
  extends mongoose.Model<WebhookReceiptDocument, object, WebhookReceiptMethods>,
    WebhookReceiptStatics {}

interface WebhookReceiptDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  created: Date;
  eventId: string;
  source: string;
}

const secondsPerDay = 86_400;

const webhookReceiptSchema = new mongoose.Schema<WebhookReceiptDocument, WebhookReceiptModel>(
  {
    created: {
      default: () => DateTime.utc().toJSDate(),
      description: "When this webhook event id was first claimed",
      required: true,
      type: Date,
    },
    eventId: {
      description: "Provider event id claimed for this source",
      required: true,
      type: String,
    },
    source: {
      description: "Webhook source label (for example stripe or sendgrid)",
      required: true,
      type: String,
    },
  },
  {collection: WEBHOOK_RECEIPTS_COLLECTION, strict: "throw"}
);

webhookReceiptSchema.index({eventId: 1, source: 1}, {unique: true});
webhookReceiptSchema.index(
  {created: 1},
  {expireAfterSeconds: DEFAULT_WEBHOOK_RECEIPT_TTL_DAYS * secondsPerDay}
);

webhookReceiptSchema.plugin(findOneOrNone);
webhookReceiptSchema.plugin(findExactlyOne);

export const getWebhookReceiptModel = (): WebhookReceiptModel => {
  return (
    (mongoose.models.TerrenoWebhookReceipt as WebhookReceiptModel | undefined) ??
    mongoose.model<WebhookReceiptDocument, WebhookReceiptModel>(
      "TerrenoWebhookReceipt",
      webhookReceiptSchema,
      WEBHOOK_RECEIPTS_COLLECTION
    )
  );
};
