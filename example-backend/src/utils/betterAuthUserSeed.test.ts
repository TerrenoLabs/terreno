import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";
import {User} from "../models/user";
import {seedBetterAuthUserInProcess} from "./betterAuthUserSeed";

const PASSWORD = "seed-password-123";

const betterAuthUserFor = async (email: string): Promise<{emailVerified?: boolean} | null> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("The test preload connects mongoose before each test");
  }
  return db.collection<{email: string; emailVerified?: boolean}>("user").findOne({email});
};

describe("seedBetterAuthUserInProcess", () => {
  it("creates the user with a verified email", async () => {
    const email = "seed-verified@example.com";
    const session = await seedBetterAuthUserInProcess({email, name: "Seeded", password: PASSWORD});
    expect(session.token || session.cookie).toBeTruthy();
    expect((await betterAuthUserFor(email))?.emailVerified).toBe(true);
    await User.findExactlyOne({email});
  });

  it("still seeds when AUTH_SIGN_UP=closed", async () => {
    process.env.AUTH_SIGN_UP = "closed";
    const email = "seed-closed@example.com";
    await seedBetterAuthUserInProcess({email, name: "Seeded", password: PASSWORD});
    expect((await betterAuthUserFor(email))?.emailVerified).toBe(true);
    await User.findExactlyOne({email});
  });

  it("signs an already seeded user back in", async () => {
    const email = "seed-twice@example.com";
    await seedBetterAuthUserInProcess({email, name: "Seeded", password: PASSWORD});
    const again = await seedBetterAuthUserInProcess({email, name: "Seeded", password: PASSWORD});
    expect(again.token || again.cookie).toBeTruthy();
    expect(await User.countDocuments({email})).toBe(1);
  });
});
