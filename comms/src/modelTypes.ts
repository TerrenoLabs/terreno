import type {FindExactlyOnePlugin, FindOneOrNonePlugin, HasUpsert} from "@terreno/api";
import type mongoose from "mongoose";

import type {CommsChannel, CommsErrorClass, CommsMessageStatus} from "./types";

export type CommsMessageMethods = Record<never, never>;

export interface CommsMessageAttempt {
  at: Date;
  error?: string;
  errorClass?: CommsErrorClass;
  errorCode?: string;
  provider: string;
  providerMessageId?: string;
}

export interface CommsMessageDocument
  extends mongoose.Document<mongoose.Types.ObjectId>,
    CommsMessageMethods {
  attemptCount: number;
  attempts: CommsMessageAttempt[];
  channel: CommsChannel;
  created: Date;
  deleted: boolean;
  error?: string;
  errorClass?: CommsErrorClass;
  errorCode?: string;
  lastAttemptAt?: Date;
  metadata?: Record<string, unknown>;
  payload?: unknown;
  payloadExpiresAt?: Date;
  provider: string;
  providerMessageId?: string;
  retriedById?: mongoose.Types.ObjectId;
  retriedFromId?: mongoose.Types.ObjectId;
  status: CommsMessageStatus;
  subject?: string;
  templateId?: string;
  to: string;
  updated: Date;
  userId?: mongoose.Types.ObjectId;
}

export interface LogSendParams {
  attemptCount?: number;
  attempts?: CommsMessageAttempt[];
  channel: CommsChannel;
  error?: string;
  errorClass?: CommsErrorClass;
  errorCode?: string;
  lastAttemptAt?: Date;
  metadata?: Record<string, unknown>;
  payload?: unknown;
  payloadExpiresAt?: Date;
  provider: string;
  providerMessageId?: string;
  retriedById?: mongoose.Types.ObjectId | string;
  retriedFromId?: mongoose.Types.ObjectId | string;
  status: CommsMessageStatus;
  subject?: string;
  templateId?: string;
  to: string;
  userId?: mongoose.Types.ObjectId | string;
}

export interface CommsMessageStatics
  extends FindExactlyOnePlugin<CommsMessageDocument>,
    FindOneOrNonePlugin<CommsMessageDocument> {
  appendAttempt(params: {
    error?: string;
    errorClass?: CommsErrorClass;
    errorCode?: string;
    id: mongoose.Types.ObjectId | string;
    metadata?: Record<string, unknown>;
    payload?: unknown;
    payloadExpiresAt?: Date;
    providerMessageId?: string;
    status: CommsMessageStatus;
    attempt: CommsMessageAttempt;
  }): Promise<CommsMessageDocument | null>;
  clearExpiredPayloads(): Promise<number>;
  logSend(params: LogSendParams): Promise<CommsMessageDocument | null>;
}

export interface CommsMessageModel
  extends mongoose.Model<CommsMessageDocument>,
    CommsMessageStatics {}

export type CommsMessageSchema = mongoose.Schema<
  CommsMessageDocument,
  CommsMessageModel,
  CommsMessageMethods
>;

export type PushTokenPlatform = "android" | "ios" | "web";

export type PushTokenMethods = Record<never, never>;

export interface PushTokenDocument
  extends mongoose.Document<mongoose.Types.ObjectId>,
    PushTokenMethods {
  active: boolean;
  created: Date;
  deleted: boolean;
  deviceId?: string;
  lastSeenAt: Date;
  platform: PushTokenPlatform;
  token: string;
  tokenEpoch?: number;
  updated: Date;
  userId: mongoose.Types.ObjectId;
}

export interface PushTokenStatics
  extends FindExactlyOnePlugin<PushTokenDocument>,
    FindOneOrNonePlugin<PushTokenDocument>,
    HasUpsert<PushTokenDocument> {}

export interface PushTokenModel extends mongoose.Model<PushTokenDocument>, PushTokenStatics {}

export type PushTokenSchema = mongoose.Schema<PushTokenDocument, PushTokenModel, PushTokenMethods>;
