import type mongoose from "mongoose";

export type CommsErrorClass = "config" | "permanent" | "transient";

export interface SendResult {
  accepted: boolean;
  error?: string;
  errorClass?: CommsErrorClass;
  errorCode?: string;
  isPermanentFailure?: boolean;
  /** Id of the CommsMessage row written for this send, when logging is on. */
  loggedMessageId?: string;
  metadata?: Record<string, unknown>;
  providerMessageId?: string;
}

export interface MailMessage {
  dynamicTemplateData?: Record<string, unknown>;
  from?: string;
  html?: string;
  metadata?: Record<string, string>;
  replyTo?: string;
  /**
   * The message carries a secret, such as a password-reset or email-verification link. Its
   * payload is never stored in the message log. Auth recovery mail from `@terreno/api` sets it.
   */
  sensitive?: boolean;
  subject: string;
  templateId?: string;
  text?: string;
  to: string | string[];
}

export type CommsChannel = "mail" | "push" | "sms" | "verification";
export type CommsMessageStatus = "bounced" | "cancelled" | "delivered" | "failed" | "sent";

export interface SmsMessage {
  body: string;
  to: string;
}

export interface PushMessage {
  badge?: number;
  body: string;
  data?: Record<string, unknown>;
  sound?: string | null;
  title: string;
  tokens: string[];
}

export interface StartVerificationOptions {
  channel: "email" | "sms";
  to: string;
}

export type CommsHookMessage = MailMessage | PushMessage | SmsMessage | StartVerificationOptions;

export interface CommsHookContext {
  attempt: number;
  channel: CommsChannel;
  isRetry: boolean;
  message: CommsHookMessage;
  messageId?: string;
  provider: string;
  userId?: string;
}

export interface BeforeSendResult {
  cancel?: boolean;
  message?: CommsHookMessage;
}

export interface MailProvider {
  readonly id: string;
  sendMail(message: MailMessage): Promise<SendResult>;
}

export interface SmsProvider {
  readonly id: string;
  sendSms(message: SmsMessage): Promise<SendResult>;
}

export interface PushProvider {
  readonly id: string;
  sendPush(message: PushMessage): Promise<SendResult[]>;
}

export interface CheckVerificationOptions {
  code: string;
  to: string;
}

export interface VerificationResult {
  error?: string;
  valid: boolean;
}

export interface VerificationProvider {
  readonly id: string;
  checkVerification(options: CheckVerificationOptions): Promise<VerificationResult>;
  startVerification(options: StartVerificationOptions): Promise<SendResult>;
}

export interface DeliveryEvent {
  channel: "mail" | "push" | "sms";
  errorClass?: CommsErrorClass;
  errorCode?: string;
  providerMessageId: string;
  raw?: unknown;
  status: "bounced" | "delivered" | "failed" | "opened";
}

export interface OptOutEvent {
  channel: "mail" | "sms";
  provider: string;
  raw?: unknown;
  reason: string;
  to: string;
}

/** The app's user model, as far as push delivery reads it. */
export interface CommsUserModel {
  findById: (id: mongoose.Types.ObjectId | string) => PromiseLike<unknown>;
}

export interface CommsOptions {
  beforeSend?: (context: CommsHookContext) => Promise<BeforeSendResult | undefined>;
  defaultFrom?: string;
  logMessages?: boolean;
  mail?: MailProvider;
  onDeliveryEvent?: (event: DeliveryEvent) => Promise<void>;
  onError?: (context: CommsHookContext, result: SendResult) => Promise<void>;
  onOptOut?: (event: OptOutEvent) => Promise<void>;
  onRetry?: (context: CommsHookContext, result: SendResult) => Promise<void>;
  onSend?: (context: CommsHookContext, result: SendResult) => Promise<void>;
  push?: PushProvider;
  redactPayload?: (context: CommsHookContext, payload: unknown) => unknown;
  redactRecipients?: boolean;
  retainPayloadDays?: number;
  sms?: SmsProvider;
  /**
   * The app's user model. When set, push goes only to users that exist and are not disabled or
   * deleted, and only to devices registered under the user's current `tokenEpoch`; the other
   * devices are released. `CommsApp` sets it from `TerrenoApp` when omitted.
   */
  userModel?: CommsUserModel;
  verification?: VerificationProvider;
}

export interface CommsSendOptions {
  extraMetadata?: Record<string, unknown>;
  isRetry?: boolean;
  retriedFromId?: string;
  /** Never store this message's payload in the log, as for `MailMessage.sensitive`. */
  sensitive?: boolean;
  userId?: mongoose.Types.ObjectId | string;
}

export interface RetryMessageOptions {
  messageId: string;
  retriedByUserId?: string;
}

export interface SendPushToUserMessage extends Omit<PushMessage, "tokens"> {
  userId: mongoose.Types.ObjectId | string;
}
