import {
  AccountSecurityApp,
  BetterAuthApp,
  createAccess,
  type PassportUserModel,
  RealtimeApp,
  rbacRouter,
  TerrenoApp,
} from "@terreno/api";
import {CommsApp} from "@terreno/comms";
import mongoose from "mongoose";

declare const User: PassportUserModel;

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
