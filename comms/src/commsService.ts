import {APIError, logger} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {
  ConsoleMailProvider,
  ConsolePushProvider,
  ConsoleSmsProvider,
  ConsoleVerificationProvider,
} from "./adapters/console";
import {evaluateRetryBlock, throwRetryBlock} from "./commsRetry";
import {CommsMessage} from "./models/commsMessage";
import {PushToken} from "./models/pushToken";
import type {CommsMessageAttempt, CommsMessageDocument, PushTokenDocument} from "./modelTypes";
import type {
  CheckVerificationOptions,
  CommsChannel,
  CommsHookContext,
  CommsHookMessage,
  CommsMessageStatus,
  CommsOptions,
  CommsSendOptions,
  CommsUserModel,
  DeliveryEvent,
  MailMessage,
  MailProvider,
  OptOutEvent,
  PushMessage,
  PushProvider,
  RetryMessageOptions,
  SendPushToUserMessage,
  SendResult,
  SmsMessage,
  SmsProvider,
  StartVerificationOptions,
  VerificationProvider,
  VerificationResult,
} from "./types";

const CHANNEL_NOT_CONFIGURED_TITLE = "Comms channel not configured";
const REDACTED_RECIPIENT = "[redacted]";
const DEFAULT_RETAIN_PAYLOAD_DAYS = 30;
const CANCELLED_ERROR = "Cancelled by beforeSend";
const HOOK_THREW = "hook-threw";

const throwUnconfiguredChannel = (): never => {
  throw new APIError({status: 501, title: CHANNEL_NOT_CONFIGURED_TITLE});
};

const isProduction = (): boolean => process.env.NODE_ENV === "production";

const providerThrowResult = (error: unknown): SendResult => ({
  accepted: false,
  error: error instanceof Error ? error.message : "Provider send failed",
  errorClass: "transient",
  errorCode: "provider-throw",
});

const isTransientFailure = (result: SendResult): boolean =>
  !result.accepted && result.errorClass === "transient";

const isPermanentPushFailure = (result: SendResult): boolean =>
  result.isPermanentFailure === true || result.errorClass === "permanent";

export class CommsService {
  private readonly options: CommsOptions;
  private readonly consoleMail = new ConsoleMailProvider();
  private readonly consolePush = new ConsolePushProvider();
  private readonly consoleSms = new ConsoleSmsProvider();
  private readonly consoleVerification = new ConsoleVerificationProvider();

  private userModel: CommsUserModel | undefined;

  constructor(options?: CommsOptions) {
    this.options = options ?? {};
    this.userModel = this.options.userModel;
  }

  /** Set the user model push delivery checks, unless one was passed in the options. */
  setUserModel(userModel: CommsUserModel | undefined): void {
    this.userModel = this.options.userModel ?? userModel;
  }

  /**
   * The user's devices that may receive push: none for a missing, disabled, or deleted user, and
   * only those registered under the user's current tokenEpoch, so a password reset or session
   * revocation ends delivery to devices bound before it. The rest are released.
   */
  private async deliverablePushTokens(
    userId: mongoose.Types.ObjectId | string
  ): Promise<PushTokenDocument[]> {
    const tokens = await PushToken.find({active: true, userId});
    if (!this.userModel || tokens.length === 0) {
      return tokens;
    }
    const user = (await this.userModel.findById(userId)) as {
      deleted?: unknown;
      disabled?: unknown;
      tokenEpoch?: unknown;
    } | null;
    if (!user || user.disabled === true || user.deleted === true) {
      logger.info(`[comms] Releasing push tokens of inactive user ${String(userId)}`);
      await PushToken.updateMany({active: true, userId}, {$set: {active: false}});
      return [];
    }
    const currentEpoch = typeof user.tokenEpoch === "number" ? user.tokenEpoch : 0;
    const isCurrent = (token: PushTokenDocument): boolean =>
      (token.tokenEpoch ?? 0) === currentEpoch;
    if (tokens.every(isCurrent)) {
      return tokens;
    }
    // A row stored without tokenEpoch counts as epoch 0.
    await PushToken.updateMany(
      {
        active: true,
        tokenEpoch: {$nin: currentEpoch === 0 ? [0, null] : [currentEpoch]},
        userId,
      },
      {$set: {active: false}}
    );
    return tokens.filter(isCurrent);
  }

  async recordDeliveryEvent(event: DeliveryEvent): Promise<void> {
    const onDeliveryEvent = this.options.onDeliveryEvent;
    await this.invokeHook(
      onDeliveryEvent ? (): Promise<void> => onDeliveryEvent(event) : undefined,
      "onDeliveryEvent"
    );
    if (this.options.logMessages === false || !event.providerMessageId) {
      return;
    }
    try {
      const row = await CommsMessage.findOneOrNone({providerMessageId: event.providerMessageId});
      if (!row) {
        logger.warn(`[comms] No CommsMessage for delivery event ${event.providerMessageId}`);
        return;
      }
      if (event.status === "opened") {
        return;
      }
      row.status = event.status;
      if (event.errorClass) {
        row.errorClass = event.errorClass;
      }
      if (event.errorCode) {
        row.errorCode = event.errorCode;
      }
      await row.save();
    } catch (error: unknown) {
      logger.warn(`[comms] Failed to apply delivery event: ${String(error)}`);
      throw error;
    }
  }

  async recordOptOut(event: OptOutEvent): Promise<void> {
    const onOptOut = this.options.onOptOut;
    await this.invokeHook(onOptOut ? (): Promise<void> => onOptOut(event) : undefined, "onOptOut");
  }

  async deactivatePushToken(token: string): Promise<void> {
    try {
      const tokenDoc = await PushToken.findOneOrNone({token});
      if (!tokenDoc || tokenDoc.active === false) {
        return;
      }
      tokenDoc.active = false;
      await tokenDoc.save();
    } catch (error: unknown) {
      logger.warn(`[comms] Failed to deactivate push token: ${String(error)}`);
    }
  }

  async clearExpiredPayloads(): Promise<number> {
    return CommsMessage.clearExpiredPayloads();
  }

  private recipientForLog(recipient: string | string[]): string {
    if (this.options.redactRecipients !== false) {
      return REDACTED_RECIPIENT;
    }
    return Array.isArray(recipient) ? recipient.join(",") : recipient;
  }

  private retainPayloadDays(): number {
    return this.options.retainPayloadDays ?? DEFAULT_RETAIN_PAYLOAD_DAYS;
  }

  private async invokeHook(
    hook: (() => Promise<void>) | undefined,
    label: string
  ): Promise<string | undefined> {
    if (!hook) {
      return undefined;
    }
    try {
      await hook();
      return undefined;
    } catch (error: unknown) {
      const message = `[comms] ${label} hook failed: ${String(error)}`;
      logger.error(message);
      return HOOK_THREW;
    }
  }

  private appendHookError(
    hookErrors: Record<string, string[]>,
    label: string,
    error: string | undefined
  ): void {
    if (!error) {
      return;
    }
    const existing = hookErrors[label] ?? [];
    existing.push(error);
    hookErrors[label] = existing;
  }

  private async applyBeforeSend(
    context: CommsHookContext,
    hookErrors: Record<string, string[]>
  ): Promise<{cancel: boolean; message: CommsHookMessage}> {
    const beforeSend = this.options.beforeSend;
    if (!beforeSend) {
      return {cancel: false, message: context.message};
    }
    try {
      const result = await beforeSend(context);
      if (!result) {
        return {cancel: false, message: context.message};
      }
      return {
        cancel: result.cancel === true,
        message: result.message ?? context.message,
      };
    } catch (error: unknown) {
      this.appendHookError(hookErrors, "beforeSend", HOOK_THREW);
      logger.error(`[comms] beforeSend hook failed: ${String(error)}`);
      return {cancel: false, message: context.message};
    }
  }

  private defaultPayload(message: CommsHookMessage, channel: CommsChannel): unknown {
    if (channel === "mail") {
      const mail = message as MailMessage;
      return {
        dynamicTemplateData: mail.dynamicTemplateData,
        from: mail.from,
        html: mail.html,
        replyTo: mail.replyTo,
        subject: mail.subject,
        templateId: mail.templateId,
        text: mail.text,
        to: mail.to,
      };
    }
    if (channel === "sms") {
      const sms = message as SmsMessage;
      return {body: sms.body, to: sms.to};
    }
    if (channel === "push") {
      const push = message as PushMessage;
      return {
        badge: push.badge,
        body: push.body,
        data: push.data,
        sound: push.sound,
        title: push.title,
      };
    }
    return {channel: (message as StartVerificationOptions).channel};
  }

  private resolvePayload(context: CommsHookContext, hookErrors: Record<string, string[]>): unknown {
    if (this.retainPayloadDays() <= 0) {
      return undefined;
    }
    const payload = this.defaultPayload(context.message, context.channel);
    const redactPayload = this.options.redactPayload;
    if (!redactPayload) {
      return payload;
    }
    try {
      return redactPayload(context, payload);
    } catch (error: unknown) {
      this.appendHookError(hookErrors, "redactPayload", HOOK_THREW);
      logger.error(`[comms] redactPayload hook failed: ${String(error)}`);
      return undefined;
    }
  }

  private payloadExpiresAt(): Date | undefined {
    const days = this.retainPayloadDays();
    if (days <= 0) {
      return undefined;
    }
    return DateTime.utc().plus({days}).toJSDate();
  }

  private cloneHookErrors(hookErrors: Record<string, string[]>): Record<string, string[]> {
    return Object.fromEntries(
      Object.entries(hookErrors).map(([key, values]) => [key, [...values]])
    );
  }

  private cloneContext(
    context: CommsHookContext,
    overrides: Partial<CommsHookContext> = {}
  ): CommsHookContext {
    return {...context, ...overrides};
  }

  private resultsByToken(tokens: string[], results: SendResult[]): Map<string, SendResult> {
    const missingResult: SendResult = {
      accepted: false,
      error: "Provider returned no result for token",
    };
    return new Map(tokens.map((token, index) => [token, results[index] ?? missingResult]));
  }

  private attemptFromResult(provider: string, result: SendResult): CommsMessageAttempt {
    return {
      at: DateTime.utc().toJSDate(),
      error: result.error,
      errorClass: result.errorClass,
      errorCode: result.errorCode,
      provider,
      providerMessageId: result.providerMessageId,
    };
  }

  private async logResult({
    attempts,
    channel,
    context,
    hookErrors,
    metadata,
    omitPayload,
    provider,
    result,
    retriedFromId,
    status,
    subject,
    templateId,
    to,
    userId,
  }: {
    attempts: CommsMessageAttempt[];
    channel: CommsChannel;
    context: CommsHookContext;
    hookErrors: Record<string, string[]>;
    metadata?: Record<string, unknown>;
    omitPayload?: boolean;
    provider: string;
    result: SendResult;
    retriedFromId?: string;
    status: CommsMessageStatus;
    subject?: string;
    templateId?: string;
    to: string | string[];
    userId?: string;
  }): Promise<CommsMessageDocument | null> {
    if (this.options.logMessages === false) {
      return null;
    }

    const payload = omitPayload ? undefined : this.resolvePayload(context, hookErrors);
    const lastAttempt = attempts[attempts.length - 1];
    const mergedMetadata = {
      ...result.metadata,
      ...metadata,
      ...(Object.keys(hookErrors).length > 0 ? {hookErrors} : {}),
    };

    const logged = await CommsMessage.logSend({
      attemptCount: attempts.length,
      attempts,
      channel,
      error: result.error,
      errorClass: result.errorClass,
      errorCode: result.errorCode,
      lastAttemptAt: lastAttempt?.at,
      metadata: mergedMetadata,
      payload,
      payloadExpiresAt: payload === undefined ? undefined : this.payloadExpiresAt(),
      provider,
      providerMessageId: result.providerMessageId,
      retriedFromId,
      status,
      subject,
      templateId,
      to: this.recipientForLog(to),
      userId,
    });
    if (logged) {
      context.messageId = String(logged._id);
    }
    return logged;
  }

  private async patchHookErrors(
    logged: CommsMessageDocument | null,
    hookErrors: Record<string, string[]>
  ): Promise<void> {
    if (!logged || Object.keys(hookErrors).length === 0) {
      return;
    }
    logged.metadata = {...logged.metadata, hookErrors};
    logged.markModified("metadata");
    await logged.save().catch((error: unknown) => {
      logger.warn(`[comms] Failed to record hook errors: ${String(error)}`);
    });
  }

  private async notifyOutcomeHooks(
    context: CommsHookContext,
    result: SendResult,
    hookErrors: Record<string, string[]>
  ): Promise<void> {
    if (result.accepted) {
      const onSend = this.options.onSend;
      this.appendHookError(
        hookErrors,
        "onSend",
        await this.invokeHook(
          onSend ? (): Promise<void> => onSend(context, result) : undefined,
          "onSend"
        )
      );
      return;
    }

    const onError = this.options.onError;
    this.appendHookError(
      hookErrors,
      "onError",
      await this.invokeHook(
        onError ? (): Promise<void> => onError(context, result) : undefined,
        "onError"
      )
    );
  }

  private async retryOnce<T extends SendResult>(
    context: CommsHookContext,
    firstResult: T,
    retry: () => Promise<T>,
    hookErrors: Record<string, string[]>
  ): Promise<{attempts: SendResult[]; result: T}> {
    if (!isTransientFailure(firstResult)) {
      return {attempts: [firstResult], result: firstResult};
    }
    context.isRetry = true;
    context.attempt = 2;
    const onRetry = this.options.onRetry;
    this.appendHookError(
      hookErrors,
      "onRetry",
      await this.invokeHook(
        onRetry ? (): Promise<void> => onRetry(context, firstResult) : undefined,
        "onRetry"
      )
    );
    const secondResult = await retry();
    return {attempts: [firstResult, secondResult], result: secondResult};
  }

  private async persistRetry(
    logged: CommsMessageDocument | null,
    context: CommsHookContext,
    hookErrors: Record<string, string[]>,
    provider: string,
    result: SendResult
  ): Promise<CommsMessageDocument | null> {
    if (!logged) {
      return null;
    }
    const payload = this.resolvePayload(context, hookErrors);
    return CommsMessage.appendAttempt({
      attempt: this.attemptFromResult(provider, result),
      error: result.error,
      errorClass: result.errorClass,
      errorCode: result.errorCode,
      id: logged._id,
      metadata: Object.keys(hookErrors).length > 0 ? {hookErrors} : undefined,
      payload,
      payloadExpiresAt: payload === undefined ? undefined : this.payloadExpiresAt(),
      providerMessageId: result.providerMessageId,
      status: result.accepted ? "sent" : "failed",
    });
  }

  private async finalizeWithRetry({
    context,
    first,
    hookErrors,
    logFields,
    provider,
    retry,
  }: {
    context: CommsHookContext;
    first: SendResult;
    hookErrors: Record<string, string[]>;
    logFields: {
      channel: CommsChannel;
      metadata?: Record<string, unknown>;
      retriedFromId?: string;
      subject?: string;
      templateId?: string;
      to: string | string[];
      userId?: string;
    };
    provider: string;
    retry: () => Promise<SendResult>;
  }): Promise<SendResult> {
    const logged = await this.logResult({
      attempts: [this.attemptFromResult(provider, first)],
      channel: logFields.channel,
      context,
      hookErrors,
      metadata: logFields.metadata,
      provider,
      result: first,
      retriedFromId: logFields.retriedFromId,
      status: first.accepted ? "sent" : "failed",
      subject: logFields.subject,
      templateId: logFields.templateId,
      to: logFields.to,
      userId: logFields.userId,
    });
    const retried = await this.retryOnce(context, first, retry, hookErrors);
    let finalLogged = logged;
    if (retried.attempts.length > 1) {
      finalLogged =
        (await this.persistRetry(logged, context, hookErrors, provider, retried.result)) ?? logged;
    }
    await this.notifyOutcomeHooks(context, retried.result, hookErrors);
    await this.patchHookErrors(finalLogged, hookErrors);
    return this.withLoggedId(retried.result, finalLogged);
  }

  private withLoggedId(result: SendResult, logged: CommsMessageDocument | null): SendResult {
    if (!logged) {
      return result;
    }
    return {...result, loggedMessageId: String(logged._id)};
  }

  private loggedIdFromSend(result: SendResult | SendResult[]): string | undefined {
    if (Array.isArray(result)) {
      return result.map((row) => row.loggedMessageId).find((id) => Boolean(id));
    }
    return result.loggedMessageId;
  }

  private cancelledResult(): SendResult {
    return {
      accepted: false,
      error: CANCELLED_ERROR,
      errorClass: "permanent",
      errorCode: "before-send-cancel",
    };
  }

  private async sendMailOnce(provider: MailProvider, message: MailMessage): Promise<SendResult> {
    try {
      return await provider.sendMail(message);
    } catch (error: unknown) {
      return providerThrowResult(error);
    }
  }

  private async sendSmsOnce(provider: SmsProvider, message: SmsMessage): Promise<SendResult> {
    try {
      return await provider.sendSms(message);
    } catch (error: unknown) {
      return providerThrowResult(error);
    }
  }

  private async sendPushOnce(provider: PushProvider, message: PushMessage): Promise<SendResult[]> {
    try {
      return await provider.sendPush(message);
    } catch (error: unknown) {
      return message.tokens.map(() => providerThrowResult(error));
    }
  }

  private async startVerificationOnce(
    provider: VerificationProvider,
    options: StartVerificationOptions
  ): Promise<SendResult> {
    try {
      return await provider.startVerification(options);
    } catch (error: unknown) {
      return providerThrowResult(error);
    }
  }

  private mergeSendMetadata(
    result: SendResult,
    sendOptions?: CommsSendOptions
  ): Record<string, unknown> | undefined {
    const extra = sendOptions?.extraMetadata;
    if (!result.metadata && !extra) {
      return result.metadata;
    }
    return {...result.metadata, ...extra};
  }

  private mailProvider(): MailProvider {
    if (this.options.mail) {
      return this.options.mail;
    }
    if (isProduction()) {
      return throwUnconfiguredChannel();
    }
    logger.warn("[comms] Mail provider not configured; using console provider");
    return this.consoleMail;
  }

  private smsProvider(): SmsProvider {
    if (this.options.sms) {
      return this.options.sms;
    }
    if (isProduction()) {
      return throwUnconfiguredChannel();
    }
    logger.warn("[comms] SMS provider not configured; using console provider");
    return this.consoleSms;
  }

  private pushProvider(): PushProvider {
    if (this.options.push) {
      return this.options.push;
    }
    if (isProduction()) {
      return throwUnconfiguredChannel();
    }
    logger.warn("[comms] Push provider not configured; using console provider");
    return this.consolePush;
  }

  private verificationProvider(): VerificationProvider {
    if (this.options.verification) {
      return this.options.verification;
    }
    if (isProduction()) {
      return throwUnconfiguredChannel();
    }
    logger.warn("[comms] Verification provider not configured; using console provider");
    return this.consoleVerification;
  }

  private applyMailDefaults(message: MailMessage): MailMessage {
    return {
      ...message,
      from: message.from ?? this.options.defaultFrom,
    };
  }

  isChannelConfigured(channel: CommsChannel): boolean {
    if (channel === "mail") {
      return Boolean(this.options.mail) || !isProduction();
    }
    if (channel === "sms") {
      return Boolean(this.options.sms) || !isProduction();
    }
    if (channel === "push") {
      return Boolean(this.options.push) || !isProduction();
    }
    return Boolean(this.options.verification) || !isProduction();
  }

  async sendMail(message: MailMessage, sendOptions?: CommsSendOptions): Promise<SendResult> {
    const provider = this.mailProvider();
    const hookErrors: Record<string, string[]> = {};
    const context: CommsHookContext = {
      attempt: 1,
      channel: "mail",
      isRetry: sendOptions?.isRetry === true,
      message: this.applyMailDefaults(message),
      provider: provider.id,
      userId: sendOptions?.userId ? String(sendOptions.userId) : undefined,
    };
    const before = await this.applyBeforeSend(context, hookErrors);
    const activeMessage = this.applyMailDefaults(before.message as MailMessage);
    context.message = activeMessage;
    if (before.cancel) {
      const result = this.cancelledResult();
      const logged = await this.logResult({
        attempts: [this.attemptFromResult(provider.id, result)],
        channel: "mail",
        context,
        hookErrors,
        metadata: sendOptions?.extraMetadata,
        provider: provider.id,
        result,
        retriedFromId: sendOptions?.retriedFromId,
        status: "cancelled",
        subject: activeMessage.subject,
        templateId: activeMessage.templateId,
        to: activeMessage.to,
        userId: context.userId,
      });
      return this.withLoggedId(result, logged);
    }

    const first = await this.sendMailOnce(provider, activeMessage);
    return this.finalizeWithRetry({
      context,
      first,
      hookErrors,
      logFields: {
        channel: "mail",
        metadata: this.mergeSendMetadata(first, sendOptions),
        retriedFromId: sendOptions?.retriedFromId,
        subject: activeMessage.subject,
        templateId: activeMessage.templateId,
        to: activeMessage.to,
        userId: context.userId,
      },
      provider: provider.id,
      retry: (): Promise<SendResult> => this.sendMailOnce(provider, activeMessage),
    });
  }

  async sendSms(message: SmsMessage, sendOptions?: CommsSendOptions): Promise<SendResult> {
    const provider = this.smsProvider();
    const hookErrors: Record<string, string[]> = {};
    const context: CommsHookContext = {
      attempt: 1,
      channel: "sms",
      isRetry: sendOptions?.isRetry === true,
      message,
      provider: provider.id,
      userId: sendOptions?.userId ? String(sendOptions.userId) : undefined,
    };
    const before = await this.applyBeforeSend(context, hookErrors);
    const activeMessage = before.message as SmsMessage;
    context.message = activeMessage;
    if (before.cancel) {
      const result = this.cancelledResult();
      const logged = await this.logResult({
        attempts: [this.attemptFromResult(provider.id, result)],
        channel: "sms",
        context,
        hookErrors,
        metadata: sendOptions?.extraMetadata,
        provider: provider.id,
        result,
        retriedFromId: sendOptions?.retriedFromId,
        status: "cancelled",
        to: activeMessage.to,
        userId: context.userId,
      });
      return this.withLoggedId(result, logged);
    }

    const first = await this.sendSmsOnce(provider, activeMessage);
    return this.finalizeWithRetry({
      context,
      first,
      hookErrors,
      logFields: {
        channel: "sms",
        metadata: this.mergeSendMetadata(first, sendOptions),
        retriedFromId: sendOptions?.retriedFromId,
        to: activeMessage.to,
        userId: context.userId,
      },
      provider: provider.id,
      retry: (): Promise<SendResult> => this.sendSmsOnce(provider, activeMessage),
    });
  }

  async sendPushToUser(
    message: SendPushToUserMessage,
    sendOptions?: CommsSendOptions
  ): Promise<SendResult[]> {
    const provider = this.pushProvider();
    const hookErrors: Record<string, string[]> = {};
    const tokens = await this.deliverablePushTokens(message.userId);
    if (tokens.length === 0) {
      return [];
    }

    const providerMessage: PushMessage = {
      badge: message.badge,
      body: message.body,
      data: message.data,
      sound: message.sound,
      title: message.title,
      tokens: tokens.map((token) => token.token),
    };
    const context: CommsHookContext = {
      attempt: 1,
      channel: "push",
      isRetry: sendOptions?.isRetry === true,
      message: providerMessage,
      provider: provider.id,
      userId: String(message.userId),
    };
    const before = await this.applyBeforeSend(context, hookErrors);
    const activeMessage = before.message as PushMessage;
    context.message = activeMessage;
    if (before.cancel) {
      const result = this.cancelledResult();
      const loggedRows = await Promise.all(
        tokens.map(
          (token): Promise<CommsMessageDocument | null> =>
            this.logResult({
              attempts: [this.attemptFromResult(provider.id, result)],
              channel: "push",
              context: this.cloneContext(context),
              hookErrors,
              metadata: sendOptions?.extraMetadata,
              provider: provider.id,
              result,
              retriedFromId: sendOptions?.retriedFromId,
              status: "cancelled",
              to: token.token,
              userId: String(message.userId),
            })
        )
      );
      return tokens.map((_, index) => this.withLoggedId(result, loggedRows[index] ?? null));
    }

    const sendTokens = activeMessage.tokens;
    if (sendTokens.length === 0) {
      return [];
    }

    const firstByToken = this.resultsByToken(
      sendTokens,
      await this.sendPushOnce(provider, activeMessage)
    );
    const loggedByToken = new Map<string, CommsMessageDocument | null>();
    await Promise.all(
      sendTokens.map(async (tokenValue): Promise<void> => {
        const result = firstByToken.get(tokenValue) as SendResult;
        const tokenContext = this.cloneContext(context);
        const logged = await this.logResult({
          attempts: [this.attemptFromResult(provider.id, result)],
          channel: "push",
          context: tokenContext,
          hookErrors,
          metadata: this.mergeSendMetadata(result, sendOptions),
          provider: provider.id,
          result,
          retriedFromId: sendOptions?.retriedFromId,
          status: result.accepted ? "sent" : "failed",
          to: tokenValue,
          userId: String(message.userId),
        });
        loggedByToken.set(tokenValue, logged);
      })
    );

    const retryTokens = sendTokens.filter((tokenValue) =>
      isTransientFailure(firstByToken.get(tokenValue) as SendResult)
    );
    const retryTokenSet = new Set(retryTokens);
    const beforeRetryHookErrors = this.cloneHookErrors(hookErrors);
    const finalByToken = new Map(firstByToken);
    const retryContext = this.cloneContext(context, {attempt: 2, isRetry: true});
    if (retryTokens.length > 0) {
      const onRetry = this.options.onRetry;
      const firstTransient = firstByToken.get(retryTokens[0] as string) as SendResult;
      this.appendHookError(
        hookErrors,
        "onRetry",
        await this.invokeHook(
          onRetry ? (): Promise<void> => onRetry(retryContext, firstTransient) : undefined,
          "onRetry"
        )
      );
      const retryByToken = this.resultsByToken(
        retryTokens,
        await this.sendPushOnce(provider, {...activeMessage, tokens: retryTokens})
      );
      await Promise.all(
        retryTokens.map(async (tokenValue): Promise<void> => {
          const retryResult = retryByToken.get(tokenValue) as SendResult;
          finalByToken.set(tokenValue, retryResult);
          const tokenHookErrors = this.cloneHookErrors(beforeRetryHookErrors);
          if (hookErrors.onRetry) {
            tokenHookErrors.onRetry = [...hookErrors.onRetry];
          }
          const logged = loggedByToken.get(tokenValue) ?? null;
          const appended = await this.persistRetry(
            logged,
            this.cloneContext(retryContext, {
              messageId: logged ? String(logged._id) : undefined,
            }),
            tokenHookErrors,
            provider.id,
            retryResult
          );
          if (appended) {
            loggedByToken.set(tokenValue, appended);
          }
        })
      );
    }

    await Promise.all(
      sendTokens.map(async (tokenValue): Promise<void> => {
        const result = finalByToken.get(tokenValue) as SendResult;
        const tokenHookErrors = this.cloneHookErrors(beforeRetryHookErrors);
        if (retryTokenSet.has(tokenValue) && hookErrors.onRetry) {
          tokenHookErrors.onRetry = [...hookErrors.onRetry];
        }
        const logged = loggedByToken.get(tokenValue) ?? null;
        const didRetry = retryTokenSet.has(tokenValue);
        await this.notifyOutcomeHooks(
          this.cloneContext(context, {
            attempt: didRetry ? 2 : 1,
            isRetry: didRetry,
            messageId: logged ? String(logged._id) : undefined,
          }),
          result,
          tokenHookErrors
        );
        await this.patchHookErrors(logged, tokenHookErrors);
        if (!result.accepted && isPermanentPushFailure(result)) {
          await this.deactivatePushToken(tokenValue);
        }
      })
    );

    return sendTokens.map((tokenValue) =>
      this.withLoggedId(
        finalByToken.get(tokenValue) as SendResult,
        loggedByToken.get(tokenValue) ?? null
      )
    );
  }

  async startVerification(options: StartVerificationOptions): Promise<SendResult> {
    const provider = this.verificationProvider();
    const hookErrors: Record<string, string[]> = {};
    const context: CommsHookContext = {
      attempt: 1,
      channel: "verification",
      isRetry: false,
      message: options,
      provider: provider.id,
    };
    const before = await this.applyBeforeSend(context, hookErrors);
    const activeOptions = before.message as StartVerificationOptions;
    context.message = activeOptions;
    if (before.cancel) {
      const result = this.cancelledResult();
      await this.logResult({
        attempts: [this.attemptFromResult(provider.id, result)],
        channel: "verification",
        context,
        hookErrors,
        metadata: {verificationChannel: activeOptions.channel},
        provider: provider.id,
        result,
        status: "cancelled",
        to: activeOptions.to,
      });
      return result;
    }

    const first = await this.startVerificationOnce(provider, activeOptions);
    return this.finalizeWithRetry({
      context,
      first,
      hookErrors,
      logFields: {
        channel: "verification",
        metadata: {verificationChannel: activeOptions.channel},
        to: activeOptions.to,
      },
      provider: provider.id,
      retry: (): Promise<SendResult> => this.startVerificationOnce(provider, activeOptions),
    });
  }

  async checkVerification(options: CheckVerificationOptions): Promise<VerificationResult> {
    const provider = this.verificationProvider();
    const hookErrors: Record<string, string[]> = {};
    const context: CommsHookContext = {
      attempt: 1,
      channel: "verification",
      isRetry: false,
      message: {channel: "sms", to: options.to},
      provider: provider.id,
    };
    try {
      const result = await provider.checkVerification(options);
      const loggedResult: SendResult = {
        accepted: result.valid,
        ...(result.valid ? {} : {error: result.error ?? "Verification check failed"}),
      };
      const logged = await this.logResult({
        attempts: [this.attemptFromResult(provider.id, loggedResult)],
        channel: "verification",
        context,
        hookErrors,
        omitPayload: true,
        provider: provider.id,
        result: loggedResult,
        status: loggedResult.accepted ? "sent" : "failed",
        to: options.to,
      });
      await this.notifyOutcomeHooks(context, loggedResult, hookErrors);
      await this.patchHookErrors(logged, hookErrors);
      return result;
    } catch (error: unknown) {
      const loggedResult = providerThrowResult(error);
      const logged = await this.logResult({
        attempts: [this.attemptFromResult(provider.id, loggedResult)],
        channel: "verification",
        context,
        hookErrors,
        omitPayload: true,
        provider: provider.id,
        result: loggedResult,
        status: "failed",
        to: options.to,
      });
      await this.notifyOutcomeHooks(context, loggedResult, hookErrors);
      await this.patchHookErrors(logged, hookErrors);
      return {error: loggedResult.error, valid: false};
    }
  }

  async retryMessage(options: RetryMessageOptions): Promise<CommsMessageDocument> {
    if (!mongoose.isValidObjectId(options.messageId)) {
      throw new APIError({status: 404, title: "Comms message not found"});
    }
    const original = await CommsMessage.findOneOrNone({_id: options.messageId});
    if (!original) {
      throw new APIError({status: 404, title: "Comms message not found"});
    }
    const block = evaluateRetryBlock({
      isChannelConfigured: (channel) => this.isChannelConfigured(channel),
      message: original,
    });
    if (block) {
      throwRetryBlock(block);
    }

    const sendOptions: CommsSendOptions = {
      extraMetadata: options.retriedByUserId
        ? {retriedByUserId: options.retriedByUserId}
        : undefined,
      isRetry: true,
      retriedFromId: String(original._id),
      userId: original.userId,
    };
    const payload = original.payload as Record<string, unknown>;
    let sendResult: SendResult | SendResult[] | undefined;

    if (original.channel === "mail") {
      sendResult = await this.sendMail(
        {
          dynamicTemplateData: payload.dynamicTemplateData as Record<string, unknown> | undefined,
          from: payload.from as string | undefined,
          html: payload.html as string | undefined,
          replyTo: payload.replyTo as string | undefined,
          subject: String(payload.subject ?? original.subject ?? ""),
          templateId: (payload.templateId as string | undefined) ?? original.templateId,
          text: payload.text as string | undefined,
          to: (payload.to as string | string[]) ?? original.to,
        },
        sendOptions
      );
    } else if (original.channel === "sms") {
      sendResult = await this.sendSms(
        {
          body: String(payload.body ?? ""),
          to: String(payload.to ?? original.to),
        },
        sendOptions
      );
    } else if (original.userId) {
      sendResult = await this.sendPushToUser(
        {
          badge: payload.badge as number | undefined,
          body: String(payload.body ?? ""),
          data: payload.data as Record<string, unknown> | undefined,
          sound: payload.sound as string | null | undefined,
          title: String(payload.title ?? ""),
          userId: original.userId,
        },
        sendOptions
      );
    } else {
      throwRetryBlock({
        code: "comms-retry-not-retryable",
        title: "Push retries require a linked user",
      });
    }

    const loggedId = this.loggedIdFromSend(sendResult ?? []);
    if (!loggedId) {
      throw new APIError({status: 500, title: "Retry did not create a communication log"});
    }
    const retried = await CommsMessage.findOneOrNone({_id: loggedId});
    if (!retried) {
      throw new APIError({status: 500, title: "Retry did not create a communication log"});
    }
    original.retriedById = retried._id;
    await original.save();
    return retried;
  }
}
