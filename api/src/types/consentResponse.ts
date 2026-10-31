import type mongoose from "mongoose";
import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "../plugins";

// biome-ignore lint/suspicious/noEmptyInterface: Prefer interface over type per project rules
export interface ConsentResponseMethods {}

export interface ConsentResponseStatics
  extends FindExactlyOnePlugin<ConsentResponseDocument>,
    FindOneOrNonePlugin<ConsentResponseDocument> {}

export interface ConsentResponseModel
  extends mongoose.Model<ConsentResponseDocument, object, ConsentResponseMethods>,
    ConsentResponseStatics {}

export interface ConsentResponseDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  consentFormId: mongoose.Types.ObjectId;
  agreed: boolean;
  agreedAt: Date;
  checkboxValues?: Map<string, boolean>;
  locale: string;
  signature?: string;
  signedAt?: Date;
  ipAddress?: string;
  userAgent?: string;
  contentSnapshot?: string;
  formVersionSnapshot?: number;
  provisional: boolean;
  provisionalSignedBy?: mongoose.Types.ObjectId;
  provisionalNote?: string;
  provisionalSignerIp?: string;
  provisionalSignerUserAgent?: string;
  voidedAt?: Date;
  voidedBy?: mongoose.Types.ObjectId;
  voidReason?: string;
  created: Date;
  updated: Date;
  deleted: boolean;
}
