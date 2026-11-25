import {
  type BetterAuthInstance,
  changeUserPassword,
  modelRouter,
  seedBetterAuthUser,
  syncBetterAuthUser,
} from "@terreno/api";
import mongoose from "mongoose";

interface UserDocument extends mongoose.Document {
  admin: boolean;
  email?: string;
  roles: string[];
  displayName: () => string;
}

interface UserModel extends mongoose.Model<UserDocument> {
  findByEmail: (email: string) => Promise<UserDocument | null>;
}

declare module "@terreno/api" {
  interface TerrenoRegister {
    user: UserDocument;
  }
}

const userSchema = new mongoose.Schema<UserDocument, UserModel>({
  admin: {default: false, type: Boolean},
  email: String,
  roles: [String],
});
userSchema.methods = {
  displayName(this: UserDocument): string {
    return this.email ?? "";
  },
};
userSchema.statics = {
  async findByEmail(this: UserModel, email: string): Promise<UserDocument | null> {
    return this.findById(email);
  },
};

export const User = mongoose.model<UserDocument, UserModel>("FixtureUser", userSchema);

// A user model with custom statics and methods goes to modelRouter without a cast.
export const usersRouter = modelRouter("/users", User, {
  instanceActions: {
    password: {
      handler: async ({doc}) => {
        // The handler's `doc` goes to changeUserPassword without a cast.
        await changeUserPassword(doc, "pw", {adminId: "admin-id"});
        await changeUserPassword(doc, "pw");
        return {ok: true};
      },
      method: "POST",
      permissions: [],
    },
  },
  permissions: {
    create: [],
    delete: [],
    list: [],
    read: [],
    update: [],
  },
});

// @ts-expect-error a bare object is not a user document
export const notAUser = changeUserPassword({}, "pw");

declare const auth: BetterAuthInstance;

export const seed = async (): Promise<void> => {
  const seeded = await seedBetterAuthUser({
    auth,
    user: {email: "a@example.com", name: "A", password: "pw"},
    userModel: User,
  });
  const roles: string[] = seeded.roles;
  seeded.roles = [...roles, "operator"];
  await seeded.save();

  const synced = await syncBetterAuthUser(User, {
    createdAt: new Date(0),
    email: "a@example.com",
    emailVerified: true,
    id: "x",
    image: null,
    name: "A",
    updatedAt: new Date(0),
  });
  const syncedRoles: string[] = synced.roles;
  synced.roles = [...syncedRoles, "operator"];
  await synced.save();

  // @ts-expect-error missingField is not on the registered user
  seeded.missingField;
};
