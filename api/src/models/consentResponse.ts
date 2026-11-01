import mongoose from "mongoose";
import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "../plugins";
import type {ConsentResponseDocument, ConsentResponseModel} from "../types/consentResponse";

const consentResponseSchema = new mongoose.Schema<ConsentResponseDocument, ConsentResponseModel>(
  {
    agreed: {
      description: "Whether the user agreed (true) or declined (false) the consent form",
      required: true,
      type: Boolean,
    },
    agreedAt: {
      description: "Timestamp when the user submitted their agreement or declination",
      required: true,
      type: Date,
    },
    checkboxValues: {
      description: "Map of checkbox index to boolean indicating whether each checkbox was checked",
      of: Boolean,
      type: Map,
    },
    consentFormId: {
      description: "Reference to the ConsentForm that was responded to",
      ref: "ConsentForm",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    contentSnapshot: {
      description: "Snapshot of the form content in the user's locale at the time of response",
      type: String,
    },
    formVersionSnapshot: {
      description: "Version number of the form at the time the user responded",
      type: Number,
    },
    ipAddress: {
      description: "IP address of the user at the time of response, captured for audit purposes",
      type: String,
    },
    locale: {
      description: "Locale code of the content version the user viewed when responding",
      required: true,
      type: String,
    },
    provisional: {
      default: false,
      description:
        "Whether another user recorded this agreement on the user's behalf. The user still sees the form and signs it themselves",
      type: Boolean,
    },
    provisionalNote: {
      description: "Required note from the provisional signer explaining how consent was obtained",
      maxlength: 2000,
      required: [
        function (this: ConsentResponseDocument): boolean {
          return this.provisional === true;
        },
        "provisionalNote is required for a provisional signature",
      ],
      trim: true,
      type: String,
    },
    provisionalSignedBy: {
      description: "The user who recorded this provisional signature",
      ref: "User",
      required: [
        function (this: ConsentResponseDocument): boolean {
          return this.provisional === true;
        },
        "provisionalSignedBy is required for a provisional signature",
      ],
      type: mongoose.Schema.Types.ObjectId,
    },
    provisionalSignerIp: {
      description: "IP address of the provisional signer, captured for audit purposes",
      type: String,
    },
    provisionalSignerUserAgent: {
      description: "User-agent string of the provisional signer's browser or app",
      type: String,
    },
    signature: {
      description: "Base64-encoded signature image or typed signature text, if captured",
      type: String,
    },
    signedAt: {
      description: "Timestamp when the user provided their signature",
      type: Date,
    },
    userAgent: {
      description: "User-agent string of the browser or app used to submit the response",
      type: String,
    },
    userId: {
      description: "Reference to the User who submitted this response",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    voidedAt: {
      description:
        "When a provisional signature was voided. Voided signatures no longer count as consent",
      type: Date,
    },
    voidedBy: {
      description: "The user who voided this provisional signature",
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
    voidReason: {
      description: "Why the provisional signature was voided",
      maxlength: 2000,
      trim: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

consentResponseSchema.index({consentFormId: 1, userId: 1});

consentResponseSchema.plugin(createdUpdatedPlugin);
consentResponseSchema.plugin(isDeletedPlugin);
consentResponseSchema.plugin(findOneOrNone);
consentResponseSchema.plugin(findExactlyOne);

export const ConsentResponse =
  (mongoose.models.ConsentResponse as ConsentResponseModel | undefined) ??
  mongoose.model<ConsentResponseDocument, ConsentResponseModel>(
    "ConsentResponse",
    consentResponseSchema
  );
