import {createHash, randomBytes} from "node:crypto";
import {DateTime, Duration} from "luxon";
import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "./plugins";
import type {AuthTokenDocument, AuthTokenModel, AuthTokenType} from "./types/authToken";

export type {AuthTokenDocument, AuthTokenModel, AuthTokenType} from "./types/authToken";

export const AUTH_TOKEN_TTL = {
  emailVerification: Duration.fromObject({hours: 24}),
  passwordReset: Duration.fromObject({hours: 1}),
} as const;

const AUTH_TOKEN_TYPES: AuthTokenType[] = ["passwordReset", "emailVerification"];

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const authTokenSchema = new mongoose.Schema<AuthTokenDocument, AuthTokenModel>(
  {
    consumedAt: {
      description: "When this token was consumed; unset until first successful consume",
      type: Date,
    },
    expiresAt: {
      description: "When this token expires and can no longer be consumed",
      required: true,
      type: Date,
    },
    tokenHash: {
      description: "SHA-256 hash of the one-time token plaintext",
      required: true,
      type: String,
      unique: true,
    },
    type: {
      description: "Whether this token is for password reset or email verification",
      enum: AUTH_TOKEN_TYPES,
      required: true,
      type: String,
    },
    userId: {
      description: "The user this token was issued for",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

authTokenSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});

authTokenSchema.plugin(createdUpdatedPlugin);
authTokenSchema.plugin(findOneOrNone);
authTokenSchema.plugin(findExactlyOne);

authTokenSchema.statics = {
  ...authTokenSchema.statics,
  async consume(
    this: AuthTokenModel,
    token: string,
    type: AuthTokenType
  ): Promise<AuthTokenDocument | null> {
    const now = DateTime.now().toJSDate();
    const consumed = await this.findOneAndUpdate(
      {
        consumedAt: {$exists: false},
        expiresAt: {$gt: now},
        tokenHash: hashToken(token),
        type,
      },
      {$set: {consumedAt: now}},
      {returnDocument: "after"}
    );
    return consumed;
  },

  async invalidateUnusedFor(
    this: AuthTokenModel,
    user: {_id: {toString(): string}},
    type: AuthTokenType
  ): Promise<void> {
    const userId = new mongoose.Types.ObjectId(String(user._id));
    await this.updateMany(
      {
        consumedAt: {$exists: false},
        type,
        userId,
      },
      {$set: {consumedAt: DateTime.now().toJSDate()}}
    );
  },

  async issueFor(
    this: AuthTokenModel,
    user: {_id: {toString(): string}},
    type: AuthTokenType
  ): Promise<{authToken: AuthTokenDocument; token: string}> {
    const token = randomBytes(32).toString("hex");
    const ttl = AUTH_TOKEN_TTL[type];
    const now = DateTime.now();
    const userId = new mongoose.Types.ObjectId(String(user._id));
    await this.invalidateUnusedFor(user, type);
    const authToken = await this.create({
      expiresAt: now.plus(ttl).toJSDate(),
      tokenHash: hashToken(token),
      type,
      userId,
    });
    return {authToken, token};
  },
};

export const AuthToken =
  (mongoose.models.TerrenoAuthToken as AuthTokenModel | undefined) ??
  mongoose.model<AuthTokenDocument, AuthTokenModel>(
    "TerrenoAuthToken",
    authTokenSchema,
    "authtokens"
  );
