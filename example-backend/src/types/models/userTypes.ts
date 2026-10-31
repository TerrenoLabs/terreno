import type {
  PassportLocalMongooseDocument,
  PassportLocalMongooseModel,
} from "passport-local-mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "../modelPlugins";

type UserMethods = {
  getDisplayName: (this: UserDocument) => string;
};

type UserStatics = DefaultStatics<UserDocument> & {
  findByEmail: (this: UserModel, email: string) => Promise<UserDocument | null>;
};

export type UserModel = DefaultModel<UserDocument> &
  UserStatics &
  PassportLocalMongooseModel<UserDocument>;

export type UserDocument = DefaultDoc &
  UserMethods &
  PassportLocalMongooseDocument & {
    admin: boolean;
    betterAuthId?: string;
    /** Set by platform staff to refuse every request and socket handshake (isDisabledPlugin). */
    disabled: boolean;
    email: string;
    name: string;
    oauthProvider?: "google" | "github" | "apple" | null;
    emailVerified: boolean;
    tokenEpoch: number;
  };
