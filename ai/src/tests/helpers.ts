import {createdUpdatedPlugin} from "@terreno/api";
import {authAsUser as authAsUserWithCredentials} from "@terreno/test";
import type express from "express";
import mongoose, {type Model} from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";
import type TestAgent from "supertest/lib/agent";

type PasswordedUser = {setPassword: (password: string) => Promise<void>};

export interface AiTestUser {
  admin?: boolean;
  email: string;
  name: string;
  password: string;
}

export interface AiTestUserDoc {
  admin?: boolean;
  email: string;
  name?: string;
}

const createTestUserModel = (): Model<AiTestUserDoc> => {
  if (mongoose.models.User) {
    return mongoose.models.User as Model<AiTestUserDoc>;
  }

  const userSchema = new mongoose.Schema({
    admin: {default: false, type: Boolean},
    email: {index: true, type: String},
    name: String,
  });
  userSchema.plugin(
    passportLocalMongoose as unknown as (
      schema: mongoose.Schema,
      options: {usernameField: string}
    ) => void,
    {usernameField: "email"}
  );
  userSchema.plugin(createdUpdatedPlugin);
  return mongoose.model<AiTestUserDoc>("User", userSchema);
};

export const UserModel = createTestUserModel();

const STANDARD_AI_TEST_USERS = {
  admin: {admin: true, email: "admin@example.com", name: "Admin", password: "securePassword"},
  notAdmin: {admin: false, email: "notAdmin@example.com", name: "User", password: "password"},
} as const;

export type StandardAiTestUserRole = keyof typeof STANDARD_AI_TEST_USERS;

export const ensureTestUsers = async (
  users: AiTestUser[] = [STANDARD_AI_TEST_USERS.admin, STANDARD_AI_TEST_USERS.notAdmin]
): Promise<AiTestUserDoc[]> => {
  await UserModel.deleteMany({email: {$in: users.map((user) => user.email)}});

  const createdUsers: AiTestUserDoc[] = [];
  for (const user of users) {
    const doc = await UserModel.create({
      admin: user.admin ?? false,
      email: user.email,
      name: user.name,
    });
    await (doc as unknown as PasswordedUser).setPassword(user.password);
    await doc.save();
    createdUsers.push(doc);
  }

  return createdUsers;
};

/**
 * `app` may also be the URL of a served app (`serveApp`). supertest accepts a URL, though
 * `@terreno/test` types only an app.
 */
export const authAsUser = async (
  app: express.Application | string,
  type: StandardAiTestUserRole
): Promise<TestAgent> => {
  const preset = STANDARD_AI_TEST_USERS[type];
  return authAsUserWithCredentials(app as express.Application, {
    email: preset.email,
    password: preset.password,
  });
};

export {authAsUserWithCredentials};
