import {beforeEach, describe, expect, it} from "bun:test";
import {configureOpenApiValidator, generateTokens, TerrenoApp} from "@terreno/api";
import type express from "express";
import mongoose from "mongoose";
import supertest from "supertest";

import {PhotoLibraryEntry} from "../models/photoLibraryEntry";
import {User as UserModel} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {createPhotoLibraryRouter, type PhotoUrlSigner} from "./photoLibrary";

const signedKeys: string[] = [];

const fakeStorage: PhotoUrlSigner = {
  getSignedUrl: async (gcsKey: string): Promise<string> => {
    signedKeys.push(gcsKey);
    return `https://storage.example.test/${gcsKey}?signature=fake`;
  },
};

const buildApp = ({storage}: {storage?: PhotoUrlSigner | null} = {}): express.Application => {
  const signer = storage === null ? undefined : (storage ?? fakeStorage);
  return new TerrenoApp({skipListen: true, userModel: UserModel as never})
    .register(createPhotoLibraryRouter({getStorage: () => signer}))
    .build();
};

const signIn = async ({admin = false}: {admin?: boolean} = {}): Promise<string> => {
  const email = `photo-library-${crypto.randomUUID()}@example.com`;
  const user = (await UserModel.register(
    {admin, email, name: email} as never,
    "password12345"
  )) as unknown as UserDocument;
  const {token} = await generateTokens(user);
  if (!token) {
    throw new Error("No token generated");
  }
  return token;
};

const seedPhoto = async ({
  deleted = false,
}: {
  deleted?: boolean;
} = {}): Promise<{
  gcsKey: string;
  id: string;
}> => {
  const gcsKey = `photo-library/${crypto.randomUUID()}.png`;
  const entry = await PhotoLibraryEntry.create({
    alt: "A rosemary and garlic roast leg of lamb on a wooden board",
    deleted,
    fileAttachmentId: new mongoose.Types.ObjectId(),
    gcsKey,
    prompt: `A roast leg of lamb ${crypto.randomUUID()}`,
    tags: ["roast", "lamb"],
  });
  return {gcsKey, id: String(entry._id)};
};

describe("photoLibrary router", () => {
  beforeEach(() => {
    signedKeys.length = 0;
    configureOpenApiValidator();
  });

  it("returns a signed URL to a non-admin user", async () => {
    const {gcsKey, id} = await seedPhoto();
    const token = await signIn();

    const res = await supertest(buildApp())
      .get(`/photoLibrary/${id}/url`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({url: `https://storage.example.test/${gcsKey}?signature=fake`});
    expect(signedKeys).toEqual([gcsKey]);
  });

  it("rejects create, update, and delete with 405", async () => {
    const {id} = await seedPhoto();
    const token = await signIn({admin: true});
    const app = buildApp();

    const created = await supertest(app)
      .post("/photoLibrary")
      .set("Authorization", `Bearer ${token}`)
      .send({
        alt: "x",
        fileAttachmentId: String(new mongoose.Types.ObjectId()),
        gcsKey: "k",
        prompt: "p",
        tags: ["t"],
      });
    const updated = await supertest(app)
      .patch(`/photoLibrary/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({alt: "changed"});
    const removed = await supertest(app)
      .delete(`/photoLibrary/${id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(created.status).toBe(405);
    expect(updated.status).toBe(405);
    expect(removed.status).toBe(405);
    expect(await PhotoLibraryEntry.countDocuments({})).toBe(1);
  });

  it("lists and reads entries for an authenticated user", async () => {
    const {id} = await seedPhoto();
    const token = await signIn();
    const app = buildApp();

    const list = await supertest(app).get("/photoLibrary").set("Authorization", `Bearer ${token}`);
    const read = await supertest(app)
      .get(`/photoLibrary/${id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body.data.map((entry: {id: string}) => entry.id)).toEqual([id]);
    expect(read.status).toBe(200);
    expect(read.body.data.alt).toContain("roast leg of lamb");
  });

  it("returns 401 without a signed-in user", async () => {
    const {id} = await seedPhoto();

    const res = await supertest(buildApp()).get(`/photoLibrary/${id}/url`);

    expect(res.status).toBe(401);
    expect(signedKeys).toEqual([]);
  });

  it("returns 404 for an unknown, malformed, or soft-deleted id", async () => {
    const deleted = await seedPhoto({deleted: true});
    const token = await signIn();
    const app = buildApp();

    for (const id of [String(new mongoose.Types.ObjectId()), "roast-lamb", deleted.id]) {
      const res = await supertest(app)
        .get(`/photoLibrary/${id}/url`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404);
    }
    expect(signedKeys).toEqual([]);
  });

  it("returns 503 when file storage is not configured", async () => {
    const {id} = await seedPhoto();
    const token = await signIn();

    const res = await supertest(buildApp({storage: null}))
      .get(`/photoLibrary/${id}/url`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.title).toBe("Photo storage is not configured");
  });
});
