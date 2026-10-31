import {emailVerificationPlugin, isDisabledPlugin, rbacUserPlugin} from "@terreno/api";
import mongoose from "mongoose";
import _passportLocalMongoose from "passport-local-mongoose";
import {DEFAULT_USER_ROLE} from "../rbacRoles";
import type {UserDocument, UserModel} from "../types/models/userTypes";
import {addDefaultPlugins} from "./modelPlugins";

// Handle bundling interop - bun build --compile wraps the export incorrectly
const passportLocalMongoose =
  typeof _passportLocalMongoose === "function"
    ? _passportLocalMongoose
    : (_passportLocalMongoose as {default: typeof _passportLocalMongoose}).default;

const userSchema = new mongoose.Schema<UserDocument, UserModel>(
  {
    admin: {
      default: false,
      description: "Whether the user has admin privileges",
      type: Boolean,
    },
    betterAuthId: {
      description: "Identifier linking to the Better Auth session provider",
      index: true,
      sparse: true,
      type: String,
    },
    email: {
      description: "The user's email address, used for authentication",
      lowercase: true,
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
    name: {
      description: "The user's display name",
      required: true,
      trim: true,
      type: String,
    },
    oauthProvider: {
      description: "OAuth provider used for authentication",
      enum: ["google", "github", "apple", null],
      type: String,
    },
    tokenEpoch: {
      default: 0,
      description: "Incremented on password reset to invalidate outstanding refresh tokens",
      type: Number,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

// Add passport-local-mongoose plugin
userSchema.plugin(passportLocalMongoose, {
  usernameField: "email",
});
userSchema.plugin(rbacUserPlugin, {defaultRoles: [DEFAULT_USER_ROLE]});
userSchema.plugin(emailVerificationPlugin);
// `disabled` lets platform staff disable an account from the security routes; a disabled user's
// requests and socket handshakes are refused.
userSchema.plugin(isDisabledPlugin);

addDefaultPlugins(userSchema);

// Define methods (use .method() to avoid overwriting passport-local-mongoose methods)
userSchema.method("getDisplayName", function (this: UserDocument): string {
  return this.name;
});

export const User = mongoose.model<UserDocument, UserModel>("User", userSchema);

// Define custom statics after model creation
User.findByEmail = async (email: string): Promise<UserDocument | null> => {
  return User.findOneOrNone({email: email.toLowerCase()});
};
