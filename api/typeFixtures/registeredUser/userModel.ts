import {
  AccountSecurityApp,
  BetterAuthApp,
  createAccess,
  RealtimeApp,
  rbacRouter,
  TerrenoApp,
} from "@terreno/api";
import {CommsApp} from "@terreno/comms";
import mongoose from "mongoose";

interface PlainUserDocument extends mongoose.Document {
  admin: boolean;
  email?: string;
  name?: string;
  displayName: () => string;
}

interface PlainUserModel extends mongoose.Model<PlainUserDocument> {
  findByName: (name: string) => Promise<PlainUserDocument | null>;
}

const plainUserSchema = new mongoose.Schema<PlainUserDocument, PlainUserModel>({
  admin: {default: false, type: Boolean},
  email: String,
  name: String,
});
plainUserSchema.methods = {
  displayName(this: PlainUserDocument): string {
    return this.name ?? "";
  },
};
plainUserSchema.statics = {
  async findByName(this: PlainUserModel, name: string): Promise<PlainUserDocument | null> {
    return this.findById(name);
  },
};

export const User = mongoose.model<PlainUserDocument, PlainUserModel>("PlainUser", plainUserSchema);

export const app = new TerrenoApp({userModel: User});
export const betterAuthApp = new BetterAuthApp({config: {enabled: true}, userModel: User});
export const access = createAccess({
  connection: mongoose.connection,
  statements: {todo: ["read"]},
  userModel: User,
});
export const rbac = rbacRouter({access, userModel: User});
export const accountSecurity = new AccountSecurityApp({userModel: User});
export const realtime = new RealtimeApp({userModel: User});
export const comms = new CommsApp({userModel: User});
